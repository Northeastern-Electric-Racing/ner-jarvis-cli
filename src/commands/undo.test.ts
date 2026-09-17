import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTempEnv, writeShim } from "../../test/helpers";
import { skillsDir, versionsDir } from "../core/paths";
import { hashSkill } from "../core/hash";
import { writeUndoRecord, readUndoIndex, CURRENT_UNDO_SCHEMA_VERSION, type UndoRecordMeta } from "../core/undo";
import { scriptedPrompter, type Prompter } from "../core/prompt";
import { undo } from "./undo";
import type { UndoEntry, UndoRecord } from "../types";

// Same inline shim as uninstall: logs argv to NERJ_LOG, exits 0 for everything.
const SHIM = `import { appendFileSync } from "node:fs";
const a = process.argv.slice(2);
if (process.env.NERJ_LOG) appendFileSync(process.env.NERJ_LOG, JSON.stringify(a) + "\\n");
process.exit(0);
`;

let dir: string;
let shimPath: string;
let logPath: string;
const saved = { bin: process.env.NER_JARVIS_CLAUDE_BIN, log: process.env.NERJ_LOG };

function argvLines(): string[][] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nerj-undo-cmd-"));
  shimPath = join(dir, "shim.ts");
  logPath = join(dir, "argv.log");
  writeShim(shimPath, SHIM);
  process.env.NER_JARVIS_CLAUDE_BIN = `bun "${shimPath}"`;
  process.env.NERJ_LOG = logPath;
});

afterEach(() => {
  if (saved.bin === undefined) delete process.env.NER_JARVIS_CLAUDE_BIN;
  else process.env.NER_JARVIS_CLAUDE_BIN = saved.bin;
  if (saved.log === undefined) delete process.env.NERJ_LOG;
  else process.env.NERJ_LOG = saved.log;
  rmSync(dir, { recursive: true, force: true });
});

const CURRENT = "9.9.9";

function seedSkill(name: string, contents: string): string {
  mkdirSync(join(skillsDir(), name), { recursive: true });
  writeFileSync(join(skillsDir(), name, "SKILL.md"), contents);
  return hashSkill([{ path: "SKILL.md", contents }]);
}

function seedRun(runId: string, version: string, installed: UndoEntry[], command: "setup" | "update" = "setup", meta: UndoRecordMeta = {}) {
  const rec: UndoRecord = { undoSchemaVersion: CURRENT_UNDO_SCHEMA_VERSION, runId, version, command, createdAt: runId, installed };
  writeUndoRecord(rec, meta);
}

// Scenario 1: nothing to undo
test("undo: no runs → skipped 'nothing to undo'", () => {
  withTempEnv(() => {
    const s = undo({ force: false, dryRun: false }, { currentVersion: CURRENT, logDecision: () => {} });
    expect(s.successes).toEqual([]);
    expect(s.skipped.some((k) => /nothing to undo/i.test(k.reason))).toBe(true);
  });
});

// Scenario 2: --list prints the index and changes nothing
test("undo --list prints the stack and makes no changes", () => {
  withTempEnv(() => {
    const h = seedSkill("ner-onboard", "onboard");
    seedRun("R1", CURRENT, [{ kind: "skill", name: "ner-onboard", installedHash: h }]);

    const printed: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => { printed.push(a.map(String).join(" ")); };
    try {
      undo({ force: false, dryRun: false, list: true }, { currentVersion: CURRENT, logDecision: () => {} });
    } finally { console.log = origLog; }

    expect(printed.join("\n")).toContain("R1");
    // nothing removed, run still tracked & not undone
    expect(existsSync(join(skillsDir(), "ner-onboard"))).toBe(true);
    expect(readUndoIndex().entries[0].undone).toBeUndefined();
  });
});

// Scenario 3: default undo reverses the most recent current-version run
test("undo: default reverses the most recent run and marks it undone", () => {
  withTempEnv(() => {
    const h1 = seedSkill("skill-old", "old");
    const h2 = seedSkill("skill-new", "new");
    seedRun("R1", CURRENT, [{ kind: "skill", name: "skill-old", installedHash: h1 }]);
    seedRun("R2", CURRENT, [{ kind: "skill", name: "skill-new", installedHash: h2 }]);

    // minimal mode (no TTY, no --yes): undo the target without prompting
    undo({ force: false, dryRun: false }, { currentVersion: CURRENT, isTTY: false, logDecision: () => {} });

    // most recent (R2) reversed; R1 untouched
    expect(existsSync(join(skillsDir(), "skill-new"))).toBe(false);
    expect(existsSync(join(skillsDir(), "skill-old"))).toBe(true);
    const idx = readUndoIndex();
    expect(idx.entries.find((e) => e.runId === "R2")!.undone).toBe(true);
    expect(idx.entries.find((e) => e.runId === "R1")!.undone).toBeUndefined();
  });
});

// Scenario 4: interactive per-entry prompt; a declined entry stays and the run is NOT marked undone
test("undo: interactive keeps a declined entry and leaves the run tracked", () => {
  withTempEnv(() => {
    const h1 = seedSkill("skill-a", "a");
    const h2 = seedSkill("skill-b", "b");
    seedRun("R1", CURRENT, [
      { kind: "skill", name: "skill-a", installedHash: h1 },
      { kind: "skill", name: "skill-b", installedHash: h2 },
    ]);
    // prompt order: skill-a, skill-b → "" (undo a), "n" (KEEP b)
    const prompter = scriptedPrompter(["", "n"]);
    undo({ force: false, dryRun: false }, { currentVersion: CURRENT, prompter, isTTY: true, logDecision: () => {} });

    expect(existsSync(join(skillsDir(), "skill-a"))).toBe(false); // undone
    expect(existsSync(join(skillsDir(), "skill-b"))).toBe(true);  // kept
    // not fully reversed → run stays tracked (not undone)
    expect(readUndoIndex().entries[0].undone).toBeUndefined();
  });
});

// Scenario 5: --yes undoes every entry without prompting
test("undo: --yes reverses every entry unattended and marks the run undone", () => {
  withTempEnv(() => {
    const h1 = seedSkill("skill-a", "a");
    const h2 = seedSkill("skill-b", "b");
    seedRun("R1", CURRENT, [
      { kind: "skill", name: "skill-a", installedHash: h1 },
      { kind: "skill", name: "skill-b", installedHash: h2 },
    ]);
    const boom: Prompter = {
      confirm: () => { throw new Error("must not prompt under --yes"); },
      askPath: () => { throw new Error("must not prompt under --yes"); },
    };
    undo({ force: false, dryRun: false, yes: true }, { currentVersion: CURRENT, prompter: boom, isTTY: true, logDecision: () => {} });

    expect(existsSync(join(skillsDir(), "skill-a"))).toBe(false);
    expect(existsSync(join(skillsDir(), "skill-b"))).toBe(false);
    expect(readUndoIndex().entries[0].undone).toBe(true);
  });
});

// Scenario 6 (Phase 3): a foreign-version run DELEGATES to the binary that made it
// instead of being reversed in-process; the delegated binary owns markUndone.
test("undo: a foreign-version run delegates to runSelf (not reversed in-process)", () => {
  withTempEnv(() => {
    const h = seedSkill("skill-x", "x");
    seedRun("R1", "0.0.1", [{ kind: "skill", name: "skill-x", installedHash: h }], "setup", { binaryPath: "/v/0.0.1/ner-jarvis" });

    const calls: { target: any; args: string[] }[] = [];
    const runSelf = (target: any, args: string[]) => { calls.push({ target, args }); return 0; };
    const s = undo({ force: false, dryRun: false, yes: true }, { currentVersion: CURRENT, logDecision: () => {}, runSelf });

    // delegated with the run's binaryPath/version and the passthrough flags
    expect(calls.length).toBe(1);
    expect(calls[0].target).toMatchObject({ binaryPath: "/v/0.0.1/ner-jarvis", version: "0.0.1" });
    expect(calls[0].args).toEqual(["undo", "--runId", "R1", "--yes"]);
    // NOT reversed in-process — the skill is left for the delegate to handle
    expect(existsSync(join(skillsDir(), "skill-x"))).toBe(true);
    // exit 0 → surfaced as a success
    expect(s.successes.some((x) => /R1/.test(x))).toBe(true);
  });
});

// Scenario 6b: delegation forwards --dry-run/--force and maps a non-zero exit to a failure.
test("undo: delegation forwards --dry-run/--force and maps a non-zero exit to a failure", () => {
  withTempEnv(() => {
    const h = seedSkill("skill-y", "y");
    seedRun("R1", "0.0.2", [{ kind: "skill", name: "skill-y", installedHash: h }], "setup", { npxVersion: "0.0.2" });

    const calls: { target: any; args: string[] }[] = [];
    const runSelf = (target: any, args: string[]) => { calls.push({ target, args }); return 2; };
    const s = undo({ force: true, dryRun: true }, { currentVersion: CURRENT, logDecision: () => {}, runSelf });

    expect(calls[0].target).toMatchObject({ npxVersion: "0.0.2", version: "0.0.2" });
    expect(calls[0].args).toEqual(["undo", "--runId", "R1", "--dry-run", "--force"]);
    // non-zero exit → failure surfaced
    expect(s.failures.some((f) => /R1/.test(f.item))).toBe(true);
  });
});

// Scenario 6c: a same-version run is still reversed IN-PROCESS (runSelf untouched).
test("undo: a same-version run reverses in-process and never delegates", () => {
  withTempEnv(() => {
    const h = seedSkill("skill-z", "z");
    seedRun("R1", CURRENT, [{ kind: "skill", name: "skill-z", installedHash: h }]);

    const runSelf = () => { throw new Error("must not delegate a same-version run"); };
    undo({ force: false, dryRun: false, yes: true }, { currentVersion: CURRENT, logDecision: () => {}, runSelf });

    expect(existsSync(join(skillsDir(), "skill-z"))).toBe(false); // reversed in-process
    expect(readUndoIndex().entries[0].undone).toBe(true);
  });
});

// Scenario 7: targeting a specific runId reverses that run, not the most recent
test("undo: targeting a runId reverses that run", () => {
  withTempEnv(() => {
    const h1 = seedSkill("skill-a", "a");
    const h2 = seedSkill("skill-b", "b");
    seedRun("R1", CURRENT, [{ kind: "skill", name: "skill-a", installedHash: h1 }]);
    seedRun("R2", CURRENT, [{ kind: "skill", name: "skill-b", installedHash: h2 }]);

    undo({ force: false, dryRun: false, yes: true, runId: "R1" }, { currentVersion: CURRENT, logDecision: () => {} });

    expect(existsSync(join(skillsDir(), "skill-a"))).toBe(false); // R1 reversed
    expect(existsSync(join(skillsDir(), "skill-b"))).toBe(true);  // R2 untouched
    expect(readUndoIndex().entries.find((e) => e.runId === "R1")!.undone).toBe(true);
  });
});

// Scenario 8: --dry-run reverses nothing and marks nothing undone
test("undo: --dry-run issues nothing, removes nothing, marks nothing", () => {
  withTempEnv(() => {
    const h = seedSkill("skill-a", "a");
    seedRun("R1", CURRENT, [
      { kind: "skill", name: "skill-a", installedHash: h },
      { kind: "plugin", name: "slack", plugin: "slack", marketplace: "m", wasInstalledByUs: true },
    ]);
    undo({ force: false, dryRun: true, yes: true }, { currentVersion: CURRENT, logDecision: () => {} });

    expect(existsSync(join(skillsDir(), "skill-a"))).toBe(true);
    expect(argvLines()).toEqual([]);
    expect(readUndoIndex().entries[0].undone).toBeUndefined();
  });
});

// Scenario 9 (Task 3.4): once a version's last live run is undone in-process, its
// archived binary is GC'd; while a live run for that version remains, it is kept.
test("undo: GCs a version's archived binary only after its last live run is undone", () => {
  withTempEnv(() => {
    // Two same-version runs; simulate an archived binary for CURRENT.
    const h1 = seedSkill("skill-a", "a");
    const h2 = seedSkill("skill-b", "b");
    seedRun("R1", CURRENT, [{ kind: "skill", name: "skill-a", installedHash: h1 }]);
    seedRun("R2", CURRENT, [{ kind: "skill", name: "skill-b", installedHash: h2 }]);
    mkdirSync(join(versionsDir(), CURRENT), { recursive: true });
    writeFileSync(join(versionsDir(), CURRENT, "ner-jarvis"), "bytes");

    // Undo only R1 → a live run (R2) for CURRENT remains → binary kept.
    undo({ force: false, dryRun: false, yes: true, runId: "R1" }, { currentVersion: CURRENT, logDecision: () => {} });
    expect(existsSync(join(versionsDir(), CURRENT))).toBe(true);

    // Undo R2 → no live run left for CURRENT → binary GC'd.
    undo({ force: false, dryRun: false, yes: true, runId: "R2" }, { currentVersion: CURRENT, logDecision: () => {} });
    expect(existsSync(join(versionsDir(), CURRENT))).toBe(false);
  });
});

// Scenario 10 (regression): a run whose entries include the shared marketplace
// (a by-design no-op — never removed) must STILL be marked fully undone. The
// marketplace's benign skip must not block completion, else no real setup run
// (which always records its marketplace) could ever be marked undone or GC'd.
test("undo: a marketplace entry (never removed) does not block marking the run undone", () => {
  withTempEnv(() => {
    seedRun("R1", CURRENT, [
      { kind: "marketplace", name: "claude-plugins-official", source: "anthropics/claude-plugins-official", wasAddedByUs: true },
      { kind: "plugin", name: "slack", plugin: "slack", marketplace: "claude-plugins-official", wasInstalledByUs: true },
    ]);
    undo({ force: false, dryRun: false, yes: true }, { currentVersion: CURRENT, logDecision: () => {} });

    const lines = argvLines();
    expect(lines).toContainEqual(["plugin", "uninstall", "slack@claude-plugins-official"]);
    expect(lines.some((a) => a[0] === "plugin" && a[1] === "marketplace")).toBe(false); // safety: never removed
    // fully reversed (the marketplace no-op does not block) → run marked undone
    expect(readUndoIndex().entries[0].undone).toBe(true);
  });
});

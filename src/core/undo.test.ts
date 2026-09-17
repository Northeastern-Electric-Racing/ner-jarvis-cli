import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTempEnv, writeShim } from "../../test/helpers";
import { undoDir, undoIndexFile, skillsDir, globalContextFile, claudeHome } from "./paths";
import {
  writeUndoRecord,
  readUndoIndex,
  markUndone,
  applyUndoEntry,
  CURRENT_UNDO_SCHEMA_VERSION,
  CURRENT_UNDO_INDEX_SCHEMA_VERSION,
} from "./undo";
import { hashSkill } from "./hash";
import { currentSkillFiles } from "./skills";
import { withContextBlock, hasGlobalContext } from "./context";
import type { UndoEntry, UndoRecord } from "../types";

function record(runId: string): UndoRecord {
  return {
    undoSchemaVersion: CURRENT_UNDO_SCHEMA_VERSION,
    runId,
    version: "9.9.9",
    command: "setup",
    createdAt: "t",
    installed: [{ kind: "skill", name: "ner-onboard", installedHash: "h" }],
  };
}

test("writeUndoRecord writes undo/<runId>.json and appends a matching index entry", () => {
  withTempEnv(() => {
    writeUndoRecord(record("R1"));

    // record file exists at undo/<runId>.json
    const recPath = join(undoDir(), "R1.json");
    expect(existsSync(recPath)).toBe(true);
    const rec = JSON.parse(readFileSync(recPath, "utf8"));
    expect(rec.undoSchemaVersion).toBe(CURRENT_UNDO_SCHEMA_VERSION);
    expect(rec.runId).toBe("R1");

    // index exists, stamped, with one entry pointing at the record (relative path)
    expect(existsSync(undoIndexFile())).toBe(true);
    const idx = readUndoIndex();
    expect(idx.indexSchemaVersion).toBe(CURRENT_UNDO_INDEX_SCHEMA_VERSION);
    expect(idx.entries.length).toBe(1);
    expect(idx.entries[0]).toMatchObject({ runId: "R1", version: "9.9.9", command: "setup", recordPath: "R1.json" });
  });
});

test("a second writeUndoRecord appends to the index (never truncates)", () => {
  withTempEnv(() => {
    writeUndoRecord(record("R1"));
    writeUndoRecord(record("R2"));
    const idx = readUndoIndex();
    expect(idx.entries.map((e) => e.runId)).toEqual(["R1", "R2"]);
  });
});

test("readUndoIndex returns an empty (stamped) index when nothing has been written", () => {
  withTempEnv(() => {
    const idx = readUndoIndex();
    expect(idx.indexSchemaVersion).toBe(CURRENT_UNDO_INDEX_SCHEMA_VERSION);
    expect(idx.entries).toEqual([]);
  });
});

test("readUndoIndex surfaces a corrupt index as an empty index rather than throwing", () => {
  withTempEnv(() => {
    mkdirSync(undoDir(), { recursive: true });
    writeFileSync(undoIndexFile(), "{ not json");
    const idx = readUndoIndex();
    expect(idx.entries).toEqual([]);
  });
});

test("markUndone flips only the matching run's undone flag", () => {
  withTempEnv(() => {
    writeUndoRecord(record("R1"));
    writeUndoRecord(record("R2"));
    markUndone("R1");
    const idx = readUndoIndex();
    expect(idx.entries.find((e) => e.runId === "R1")!.undone).toBe(true);
    expect(idx.entries.find((e) => e.runId === "R2")!.undone).toBeUndefined();
  });
});

test("writeUndoRecord accepts index meta (binaryPath / npxVersion) for the entry", () => {
  withTempEnv(() => {
    writeUndoRecord(record("R1"), { binaryPath: "/p/bin", npxVersion: "9.9.9" });
    const e = readUndoIndex().entries[0];
    expect(e.binaryPath).toBe("/p/bin");
    expect(e.npxVersion).toBe("9.9.9");
  });
});

// --- applyUndoEntry (reverse-action application) -------------------------
// Same inline shim as uninstall: logs argv to NERJ_LOG, exits 0 for everything.
// applyUndoEntry only ever issues `plugin uninstall` / `mcp remove` / `mcp add`.
const SHIM = `import { appendFileSync } from "node:fs";
const a = process.argv.slice(2);
if (process.env.NERJ_LOG) appendFileSync(process.env.NERJ_LOG, JSON.stringify(a) + "\\n");
process.exit(0);
`;

let shimDir: string;
let shimPath: string;
let logPath: string;
const savedEnv = { bin: process.env.NER_JARVIS_CLAUDE_BIN, log: process.env.NERJ_LOG };

function argvLines(): string[][] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function seedSkill(name: string, contents: string): string {
  mkdirSync(join(skillsDir(), name), { recursive: true });
  writeFileSync(join(skillsDir(), name, "SKILL.md"), contents);
  return hashSkill([{ path: "SKILL.md", contents }]);
}

beforeEach(() => {
  shimDir = mkdtempSync(join(tmpdir(), "nerj-undo-apply-"));
  shimPath = join(shimDir, "shim.ts");
  logPath = join(shimDir, "argv.log");
  writeShim(shimPath, SHIM);
  process.env.NER_JARVIS_CLAUDE_BIN = `bun "${shimPath}"`;
  process.env.NERJ_LOG = logPath;
});

afterEach(() => {
  if (savedEnv.bin === undefined) delete process.env.NER_JARVIS_CLAUDE_BIN;
  else process.env.NER_JARVIS_CLAUDE_BIN = savedEnv.bin;
  if (savedEnv.log === undefined) delete process.env.NERJ_LOG;
  else process.env.NERJ_LOG = savedEnv.log;
  rmSync(shimDir, { recursive: true, force: true });
});

test("applyUndoEntry: skill without priorFiles removes the dir when the on-disk hash matches", () => {
  withTempEnv(() => {
    const h = seedSkill("ner-onboard", "onboard");
    const r = applyUndoEntry({ kind: "skill", name: "ner-onboard", installedHash: h }, { dryRun: false, force: false });
    expect(r.outcome).toBe("undone");
    expect(existsSync(join(skillsDir(), "ner-onboard"))).toBe(false);
  });
});

test("applyUndoEntry: skill hash-guard skips a user-edited skill (left in place) unless --force", () => {
  withTempEnv(() => {
    seedSkill("ner-onboard", "onboard");
    // record a DIFFERENT installedHash → on-disk no longer matches what we left
    const entry: UndoEntry = { kind: "skill", name: "ner-onboard", installedHash: "deadbeef" };

    const skipped = applyUndoEntry(entry, { dryRun: false, force: false });
    expect(skipped.outcome).toBe("skipped");
    expect(existsSync(join(skillsDir(), "ner-onboard"))).toBe(true); // untouched

    const forced = applyUndoEntry(entry, { dryRun: false, force: true });
    expect(forced.outcome).toBe("undone");
    expect(existsSync(join(skillsDir(), "ner-onboard"))).toBe(false);
  });
});

test("applyUndoEntry: skill removal reversal is a no-op success when the dir is already gone", () => {
  withTempEnv(() => {
    const r = applyUndoEntry({ kind: "skill", name: "gone", installedHash: "h" }, { dryRun: false, force: false });
    expect(r.outcome).toBe("undone");
  });
});

test("applyUndoEntry: skill with priorFiles restores those files (hash-guarded)", () => {
  withTempEnv(() => {
    // Simulate a run that OVERWROTE the skill: on disk is the post-overwrite body,
    // installedHash is that body's hash, priorFiles is the pre-overwrite body.
    const nowContents = "NEW body";
    const h = seedSkill("ner-onboard", nowContents);
    const priorFiles = [{ path: "SKILL.md", contents: "OLD body" }];

    const r = applyUndoEntry({ kind: "skill", name: "ner-onboard", installedHash: h, priorFiles }, { dryRun: false, force: false });
    expect(r.outcome).toBe("undone");
    expect(readFileSync(join(skillsDir(), "ner-onboard", "SKILL.md"), "utf8")).toBe("OLD body");
    // restored content matches the recorded priorFiles exactly
    expect(currentSkillFiles("ner-onboard")).toEqual(priorFiles);
  });
});

test("applyUndoEntry: plugin wasInstalledByUs issues plugin uninstall; foreign plugin is a noop", () => {
  withTempEnv(() => {
    const ours = applyUndoEntry(
      { kind: "plugin", name: "slack", plugin: "slack", marketplace: "claude-plugins-official", wasInstalledByUs: true },
      { dryRun: false, force: false },
    );
    expect(ours.outcome).toBe("undone");
    expect(argvLines()).toContainEqual(["plugin", "uninstall", "slack@claude-plugins-official"]);

    const foreign = applyUndoEntry(
      { kind: "plugin", name: "slack", plugin: "slack", marketplace: "claude-plugins-official", wasInstalledByUs: false },
      { dryRun: false, force: false },
    );
    expect(foreign.outcome).toBe("noop"); // we didn't install it → nothing to reverse
  });
});

test("applyUndoEntry: mcp with prior replaces back to the prior url/transport", () => {
  withTempEnv(() => {
    const r = applyUndoEntry(
      { kind: "mcp", name: "atlassian", transport: "http", url: "https://NEW/mcp", prior: { transport: "http", url: "https://OLD/mcp" } },
      { dryRun: false, force: false },
    );
    expect(r.outcome).toBe("undone");
    const lines = argvLines();
    expect(lines).toContainEqual(["mcp", "remove", "atlassian", "--scope", "user"]);
    const add = lines.find((a) => a[0] === "mcp" && a[1] === "add");
    expect(add).toBeDefined();
    expect(add!).toContain("https://OLD/mcp");
  });
});

test("applyUndoEntry: mcp without prior is removed", () => {
  withTempEnv(() => {
    const r = applyUndoEntry({ kind: "mcp", name: "github", transport: "http", url: "https://NEW/mcp" }, { dryRun: false, force: false });
    expect(r.outcome).toBe("undone");
    const lines = argvLines();
    expect(lines).toContainEqual(["mcp", "remove", "github", "--scope", "user"]);
    expect(lines.some((a) => a[0] === "mcp" && a[1] === "add")).toBe(false);
  });
});

test("applyUndoEntry: marketplace is NEVER removed (safety) — tracking-only noop", () => {
  withTempEnv(() => {
    const r = applyUndoEntry(
      { kind: "marketplace", name: "claude-plugins-official", source: "anthropics/claude-plugins-official", wasAddedByUs: true },
      { dryRun: false, force: false },
    );
    // SAFETY: shared/official marketplace is never `plugin marketplace remove`d.
    expect(argvLines().some((a) => a[0] === "plugin" && a[1] === "marketplace")).toBe(false);
    expect(r.outcome).toBe("noop"); // benign — tracking-only, never a live remnant
  });
});

test("applyUndoEntry: global-note strips the marker block from the global CLAUDE.md", () => {
  withTempEnv(() => {
    mkdirSync(claudeHome(), { recursive: true });
    writeFileSync(globalContextFile(), withContextBlock("# my notes\n"));
    expect(hasGlobalContext()).toBe(true);
    const r = applyUndoEntry({ kind: "global-note" }, { dryRun: false, force: false });
    expect(r.outcome).toBe("undone");
    expect(hasGlobalContext()).toBe(false);
    expect(readFileSync(globalContextFile(), "utf8")).toContain("my notes");
  });
});

test("applyUndoEntry: dry-run issues no commands and writes nothing", () => {
  withTempEnv(() => {
    const h = seedSkill("ner-onboard", "onboard");
    mkdirSync(claudeHome(), { recursive: true });
    writeFileSync(globalContextFile(), withContextBlock("# my notes\n"));

    applyUndoEntry({ kind: "skill", name: "ner-onboard", installedHash: h }, { dryRun: true, force: false });
    applyUndoEntry({ kind: "plugin", name: "slack", plugin: "slack", marketplace: "m", wasInstalledByUs: true }, { dryRun: true, force: false });
    applyUndoEntry({ kind: "mcp", name: "github", transport: "http", url: "u" }, { dryRun: true, force: false });
    applyUndoEntry({ kind: "global-note" }, { dryRun: true, force: false });

    // nothing removed, nothing issued
    expect(existsSync(join(skillsDir(), "ner-onboard"))).toBe(true);
    expect(hasGlobalContext()).toBe(true);
    expect(argvLines()).toEqual([]);
  });
});

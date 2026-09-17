import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTempEnv, writeShim } from "../../test/helpers";
import { globalContextFile, skillsDir, stateFile, undoDir } from "../core/paths";
import { readState, writeState } from "../core/state";
import { hashSkill } from "../core/hash";
import { writeUndoRecord, CURRENT_UNDO_SCHEMA_VERSION } from "../core/undo";
import { uninstall } from "./uninstall";
import { scriptedPrompter, type Prompter } from "../core/prompt";
import { withContextBlock, hasGlobalContext } from "../core/context";
import type { Marketplace, SkillState, Source } from "../types";

// Inline fake shim: logs each argv to NERJ_LOG and exits 0 for EVERYTHING.
// uninstall issues only `plugin uninstall` / `mcp remove` (no probes), so a
// bare log-and-exit-0 shim is enough. Real `claude` is NEVER invoked.
const SHIM = `import { appendFileSync } from "node:fs";
const a = process.argv.slice(2);
if (process.env.NERJ_LOG) appendFileSync(process.env.NERJ_LOG, JSON.stringify(a) + "\\n");
process.exit(0);
`;

let dir: string;
let shimPath: string;
let logPath: string;
const saved = {
  bin: process.env.NER_JARVIS_CLAUDE_BIN,
  log: process.env.NERJ_LOG,
};

/** All argv lines the shim has logged so far, JSON-parsed. */
function argvLines(): string[][] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nerj-uninstall-"));
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

// --- seed helpers (run inside withTempEnv so HOME points at the temp dir) ---
function seedState(skills: SkillState[], sources: Source[], marketplaces: Marketplace[]) {
  writeState({ stateSchemaVersion: 1, migrationLevel: 0, version: "0.1.0", installedAt: "t", updatedAt: "t", skills, marketplaces, sources });
}
function seedSkillOnDisk(name: string, contents: string): string {
  mkdirSync(join(skillsDir(), name), { recursive: true });
  writeFileSync(join(skillsDir(), name, "SKILL.md"), contents);
  return hashSkill([{ path: "SKILL.md", contents }]);
}
function seedUndoRun(runId: string) {
  writeUndoRecord({
    undoSchemaVersion: CURRENT_UNDO_SCHEMA_VERSION, runId, version: "0.1.0",
    command: "setup", createdAt: runId, installed: [{ kind: "global-note" }],
  });
}

// The standard tracked set used across scenarios.
const MARKETPLACE: Marketplace = { name: "claude-plugins-official", source: "anthropics/claude-plugins-official" };
const SOURCES: Source[] = [
  { name: "slack", type: "plugin", marketplace: "claude-plugins-official", plugin: "slack" },
  { name: "atlassian", type: "mcp", transport: "http", url: "https://mcp.atlassian.com/v1/mcp/authv2" },
  { name: "github", type: "mcp", transport: "http", url: "https://api.githubcopilot.com/mcp/" },
];

// Scenario 1: clean full uninstall
test("uninstall: clean full uninstall removes the skill, all sources (no marketplace remove), and forgets state", () => {
  withTempEnv(() => {
    const hash = seedSkillOnDisk("ner-onboard", "onboard");
    seedState([{ name: "ner-onboard", hash }], SOURCES, [MARKETPLACE]);

    uninstall({ targets: [], force: false, dryRun: false });

    // skill dir gone
    expect(existsSync(join(skillsDir(), "ner-onboard"))).toBe(false);

    const lines = argvLines();
    expect(lines).toContainEqual(["plugin", "uninstall", "slack@claude-plugins-official"]);
    expect(lines).toContainEqual(["mcp", "remove", "atlassian", "--scope", "user"]);
    expect(lines).toContainEqual(["mcp", "remove", "github", "--scope", "user"]);
    // SAFETY: never a marketplace remove
    expect(lines.some((a) => a[0] === "plugin" && a[1] === "marketplace")).toBe(false);

    // clean uninstall → state file forgotten entirely
    expect(existsSync(stateFile())).toBe(false);
    expect(readState()).toBeNull();
  });
});

// Scenario 2: user-edited skill preserved (then --force removes it)
test("uninstall: a user-edited skill is left in place and still tracked; --force then removes it", () => {
  withTempEnv(() => {
    const hash = seedSkillOnDisk("ner-onboard", "onboard");
    seedState([{ name: "ner-onboard", hash }], SOURCES, [MARKETPLACE]);
    // user edits the skill after install → on-disk hash no longer matches
    writeFileSync(join(skillsDir(), "ner-onboard", "SKILL.md"), "user edits!");

    const summary = uninstall({ targets: [], force: false, dryRun: false });

    // edited skill left in place
    expect(existsSync(join(skillsDir(), "ner-onboard"))).toBe(true);
    expect(summary.skipped.some((s) => s.item.includes("ner-onboard"))).toBe(true);
    // still tracked → state file remains
    expect(existsSync(stateFile())).toBe(true);
    expect(readState()!.skills.map((s) => s.name)).toContain("ner-onboard");

    // now force it: skill dir removed
    uninstall({ targets: [], force: true, dryRun: false });
    expect(existsSync(join(skillsDir(), "ner-onboard"))).toBe(false);
  });
});

// Scenario 3: foreign same-named skill untouched
test("uninstall: a foreign skill not in state is never touched", () => {
  withTempEnv(() => {
    const hash = seedSkillOnDisk("ner-onboard", "onboard");
    seedState([{ name: "ner-onboard", hash }], SOURCES, [MARKETPLACE]);
    // a foreign skill dir NOT tracked by state
    mkdirSync(join(skillsDir(), "not-ours"), { recursive: true });
    writeFileSync(join(skillsDir(), "not-ours", "SKILL.md"), "someone else's");

    uninstall({ targets: [], force: false, dryRun: false });

    // ours gone, theirs untouched
    expect(existsSync(join(skillsDir(), "ner-onboard"))).toBe(false);
    expect(existsSync(join(skillsDir(), "not-ours"))).toBe(true);
  });
});

// Scenario 4: dry-run removes nothing
test("uninstall: dry-run removes nothing (no skill dir removal, no state change, no claude commands)", () => {
  withTempEnv(() => {
    const hash = seedSkillOnDisk("ner-onboard", "onboard");
    seedState([{ name: "ner-onboard", hash }], SOURCES, [MARKETPLACE]);

    uninstall({ targets: [], force: false, dryRun: true });

    expect(existsSync(join(skillsDir(), "ner-onboard"))).toBe(true);
    expect(existsSync(stateFile())).toBe(true);

    const lines = argvLines();
    expect(lines.some((a) => a[0] === "plugin" && a[1] === "uninstall")).toBe(false);
    expect(lines.some((a) => a[0] === "mcp" && a[1] === "remove")).toBe(false);
  });
});

// Scenario 5: targeted uninstall
test("uninstall: targeted (github) removes only github, keeps everything else tracked", () => {
  withTempEnv(() => {
    const hash = seedSkillOnDisk("ner-onboard", "onboard");
    seedState([{ name: "ner-onboard", hash }], SOURCES, [MARKETPLACE]);

    uninstall({ targets: ["github"], force: false, dryRun: false });

    const lines = argvLines();
    expect(lines).toContainEqual(["mcp", "remove", "github", "--scope", "user"]);
    expect(lines.some((a) => a[0] === "mcp" && a[1] === "remove" && a.includes("atlassian"))).toBe(false);
    expect(lines.some((a) => a[0] === "plugin" && a[1] === "uninstall")).toBe(false);

    // state remains, github dropped, rest tracked
    expect(existsSync(stateFile())).toBe(true);
    const state = readState()!;
    expect(state.sources.map((s) => s.name)).toEqual(["slack", "atlassian"]);
    expect(state.marketplaces.map((m) => m.name)).toEqual(["claude-plugins-official"]);
    expect(state.skills.map((s) => s.name)).toEqual(["ner-onboard"]);
    // skill still on disk
    expect(existsSync(join(skillsDir(), "ner-onboard"))).toBe(true);
  });
});

// Scenario 6: global CLAUDE.md note — full uninstall strips it (keeping user content); targeted leaves it.
test("uninstall: full uninstall removes the global CLAUDE.md note; targeted leaves it", () => {
  withTempEnv(() => {
    const hash = seedSkillOnDisk("ner-onboard", "onboard");
    seedState([{ name: "ner-onboard", hash }], SOURCES, [MARKETPLACE]);
    writeFileSync(globalContextFile(), withContextBlock("# My global notes\n"));
    expect(hasGlobalContext()).toBe(true);

    // targeted uninstall must NOT touch the global note
    uninstall({ targets: ["github"], force: false, dryRun: false });
    expect(hasGlobalContext()).toBe(true);

    // full uninstall strips our block but keeps the user's content
    uninstall({ targets: [], force: false, dryRun: false });
    expect(hasGlobalContext()).toBe(false);
    expect(readFileSync(globalContextFile(), "utf8")).toContain("My global notes");
  });
});

// Scenario 7: interactive — Enter=remove by default, but declining a plugin keeps it tracked.
test("uninstall: interactive keeps a declined plugin and removes the rest", () => {
  withTempEnv(() => {
    const hash = seedSkillOnDisk("ner-onboard", "onboard");
    seedState([{ name: "ner-onboard", hash }], SOURCES, [MARKETPLACE]);
    // prompt order: skills group, slack, atlassian, github → "" (remove), "n" (KEEP slack), "", ""
    const prompter = scriptedPrompter(["", "n", "", ""]);
    uninstall({ targets: [], force: false, dryRun: false, yes: false }, { prompter, isTTY: true, logDecision: () => {} });

    const lines = argvLines();
    // slack declined → never uninstalled
    expect(lines.some((a) => a[0] === "plugin" && a[1] === "uninstall")).toBe(false);
    // atlassian + github removed
    expect(lines).toContainEqual(["mcp", "remove", "atlassian", "--scope", "user"]);
    expect(lines).toContainEqual(["mcp", "remove", "github", "--scope", "user"]);
    // skill removed
    expect(existsSync(join(skillsDir(), "ner-onboard"))).toBe(false);
    // slack survives → still tracked, state retained (with its marketplace)
    expect(existsSync(stateFile())).toBe(true);
    const state = readState()!;
    expect(state.sources.map((s) => s.name)).toEqual(["slack"]);
    expect(state.marketplaces.map((m) => m.name)).toEqual(["claude-plugins-official"]);
  });
});

// Scenario 8: `--yes` removes everything and never consults the injected prompter.
test("uninstall: --yes removes everything without prompting", () => {
  withTempEnv(() => {
    const hash = seedSkillOnDisk("ner-onboard", "onboard");
    seedState([{ name: "ner-onboard", hash }], SOURCES, [MARKETPLACE]);
    const boom: Prompter = {
      confirm: () => { throw new Error("must not prompt under --yes"); },
      askPath: () => { throw new Error("must not prompt under --yes"); },
    };
    uninstall({ targets: [], force: false, dryRun: false, yes: true }, { prompter: boom, isTTY: true, logDecision: () => {} });

    expect(existsSync(join(skillsDir(), "ner-onboard"))).toBe(false);
    expect(argvLines()).toContainEqual(["plugin", "uninstall", "slack@claude-plugins-official"]);
    expect(existsSync(stateFile())).toBe(false); // all removed → state forgotten
  });
});

// Scenario 9: full teardown wipes the undo journal (stale rollback data); partial keeps it.
test("uninstall: a full teardown removes the undo journal; a partial uninstall keeps it", () => {
  withTempEnv(() => {
    const hash = seedSkillOnDisk("ner-onboard", "onboard");
    seedState([{ name: "ner-onboard", hash }], SOURCES, [MARKETPLACE]);
    seedUndoRun("R1");
    expect(existsSync(undoDir())).toBe(true);

    // partial uninstall (github only) → journal untouched, something still tracked
    uninstall({ targets: ["github"], force: false, dryRun: false });
    expect(existsSync(undoDir())).toBe(true);

    // full uninstall of what remains → nothing tracked → journal wiped
    uninstall({ targets: [], force: false, dryRun: false });
    expect(existsSync(stateFile())).toBe(false);
    expect(existsSync(undoDir())).toBe(false);
  });
});

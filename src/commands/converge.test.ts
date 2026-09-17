import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTempEnv, writeShim } from "../../test/helpers";
import { claudeHome, skillsDir, stateFile, legacyStateFile } from "../core/paths";
import { readState, writeState } from "../core/state";
import { CURRENT_MIGRATION_LEVEL } from "../core/migrations";
import { readUndoIndex, readUndoRecord } from "../core/undo";
import { hashSkill } from "../core/hash";
import { converge } from "./converge";
import type { EmbeddedPayload, EmbeddedSkill, UndoEntry } from "../types";

// Inline fake shim: logs each argv to NERJ_LOG and mimics just enough of the
// `claude` surface for planning/applying. Real `claude` is NEVER invoked. It is
// STATEFUL — it replays its own command log so a plugin/mcp installed earlier
// (this run or a prior run sharing the log) reads back as present on later
// probes, like real `claude`. Tests that seed state.json directly (no install
// commands ran) can pre-declare presence via NERJ_FAKE_PLUGINS / NERJ_FAKE_MCPS.
//   mcp get <name>   → exit 0 if <name> is present, else 1
//   plugin list      → prints the installed plugins as JSON, exit 0
//   everything else  → exit 0 (--version, mcp add/remove, plugin install/update/…)
const SHIM = `import { appendFileSync, readFileSync, existsSync } from "node:fs";
const a = process.argv.slice(2);
const LOG = process.env.NERJ_LOG;
const prior = LOG && existsSync(LOG)
  ? readFileSync(LOG, "utf8").trim().split("\\n").filter(Boolean).map((l) => JSON.parse(l))
  : [];
if (LOG) appendFileSync(LOG, JSON.stringify(a) + "\\n");
const plugins = new Set((process.env.NERJ_FAKE_PLUGINS ?? "").split(",").filter(Boolean));
const mcps = new Set((process.env.NERJ_FAKE_MCPS ?? "").split(",").filter(Boolean));
for (const c of prior) {
  if (c[0] === "plugin" && c[1] === "install") plugins.add(c[2]);
  else if (c[0] === "plugin" && (c[1] === "uninstall" || c[1] === "remove")) plugins.delete(c[2]);
  else if (c[0] === "mcp" && c[1] === "add") mcps.add(c[4]);
  else if (c[0] === "mcp" && c[1] === "remove") mcps.delete(c[2]);
}
if (a[0] === "mcp" && a[1] === "get") process.exit(mcps.has(a[2]) ? 0 : 1);
if (a[0] === "plugin" && a[1] === "list") { process.stdout.write(JSON.stringify([...plugins].map((p) => ({ id: p })))); process.exit(0); }
process.exit(0);
`;

// --- fixture payload (do NOT rely on the embedded one) ---
function payloadSkill(name: string, contents: string): EmbeddedSkill {
  return { name, files: [{ path: "SKILL.md", contents }] };
}
function fixturePayload(): EmbeddedPayload {
  return {
    version: "9.9.9",
    skills: [
      payloadSkill("ner-onboard", "onboard"),
      payloadSkill("ner-ask", "ask"),
      payloadSkill("ner-setup", "setup"),
      payloadSkill("ner-repo-explainer", "repo-explainer"),
      payloadSkill("ner-escalation-router", "escalation-router"),
    ],
    marketplaces: [
      { name: "claude-plugins-official", source: "anthropics/claude-plugins-official" },
    ],
    sources: [
      { name: "slack", type: "plugin", marketplace: "claude-plugins-official", plugin: "slack" },
      { name: "atlassian", type: "mcp", transport: "http", url: "https://mcp.atlassian.com/v1/mcp/authv2" },
      { name: "github", type: "mcp", transport: "http", url: "https://api.githubcopilot.com/mcp/" },
    ],
  };
}

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
  dir = mkdtempSync(join(tmpdir(), "nerj-converge-"));
  shimPath = join(dir, "shim.ts");
  logPath = join(dir, "argv.log");
  writeShim(shimPath, SHIM);
  process.env.NER_JARVIS_CLAUDE_BIN = `bun "${shimPath}"`;
  process.env.NERJ_LOG = logPath;
  delete process.env.NERJ_FAKE_PLUGINS;
  delete process.env.NERJ_FAKE_MCPS;
});

afterEach(() => {
  if (saved.bin === undefined) delete process.env.NER_JARVIS_CLAUDE_BIN;
  else process.env.NER_JARVIS_CLAUDE_BIN = saved.bin;
  if (saved.log === undefined) delete process.env.NERJ_LOG;
  else process.env.NERJ_LOG = saved.log;
  rmSync(dir, { recursive: true, force: true });
});

// Scenario 1: fresh full run
test("converge: fresh full run installs all skills, adds marketplace/plugin/mcps, and records state", () => {
  withTempEnv(() => {
    const payload = fixturePayload();
    converge(payload, { targets: [], force: false, full: true, dryRun: false });

    // all 5 skill dirs exist, each with SKILL.md
    for (const name of ["ner-onboard", "ner-ask", "ner-setup", "ner-repo-explainer", "ner-escalation-router"]) {
      expect(existsSync(join(skillsDir(), name, "SKILL.md"))).toBe(true);
    }

    const lines = argvLines();
    expect(lines).toContainEqual(["plugin", "marketplace", "add", "anthropics/claude-plugins-official"]);
    expect(lines).toContainEqual(["plugin", "install", "slack@claude-plugins-official"]);
    // an `mcp add` for atlassian and one for github
    const mcpAdds = lines.filter((a) => a[0] === "mcp" && a[1] === "add");
    expect(mcpAdds.some((a) => a.includes("atlassian"))).toBe(true);
    expect(mcpAdds.some((a) => a.includes("github"))).toBe(true);

    const state = readState();
    expect(state).not.toBeNull();
    expect(state!.version).toBe("9.9.9");
    expect(state!.skills.length).toBe(5);
    for (const s of state!.skills) {
      expect(typeof s.name).toBe("string");
      expect(s.hash.length).toBeGreaterThan(0);
    }
    expect(state!.marketplaces.length).toBe(1);
    expect(state!.sources.length).toBe(3);
  });
});

// Scenario 2: idempotent
test("converge: a second identical run re-installs nothing (no mcp add / plugin install; skills all noop)", () => {
  withTempEnv(() => {
    const payload = fixturePayload();
    converge(payload, { targets: [], force: false, full: true, dryRun: false });
    const afterRun1 = argvLines().length;

    const summary2 = converge(payload, { targets: [], force: false, full: true, dryRun: false });

    const newLines = argvLines().slice(afterRun1);
    expect(newLines.some((a) => a[0] === "mcp" && a[1] === "add")).toBe(false);
    expect(newLines.some((a) => a[0] === "plugin" && a[1] === "install")).toBe(false);
    // a plugin update for slack is expected
    expect(newLines.some((a) => a[0] === "plugin" && a[1] === "update")).toBe(true);
    // skills were all noop → no "skill …" success in run 2
    expect(summary2.successes.some((s) => s.startsWith("skill "))).toBe(false);
  });
});

// Scenario 3: targeted
test("converge: targeted run (slack) touches only slack, writes no skill dirs, records only slack", () => {
  withTempEnv(() => {
    const payload = fixturePayload();
    const summary = converge(payload, { targets: ["slack"], force: false, full: false, dryRun: false });

    const lines = argvLines();
    expect(lines).toContainEqual(["plugin", "marketplace", "add", "anthropics/claude-plugins-official"]);
    expect(lines).toContainEqual(["plugin", "install", "slack@claude-plugins-official"]);
    expect(lines.some((a) => a[0] === "mcp" && a[1] === "add")).toBe(false);

    // no skill is named "slack" → no skill dirs written
    expect(existsSync(skillsDir()) ? readdirSync(skillsDir()) : []).toEqual([]);

    const state = readState();
    expect(state!.sources.map((s) => s.name)).toEqual(["slack"]);

    // targeted runs never remove/uninstall/prune
    const bad = ["remove", "uninstall", "prune"];
    expect(summary.successes.some((s) => bad.some((b) => s.includes(b)))).toBe(false);
  });
});

// Scenario 4: dry-run
test("converge: dry-run writes no skills, no state, and no mutating claude commands", () => {
  withTempEnv(() => {
    const payload = fixturePayload();
    converge(payload, { targets: [], force: false, full: true, dryRun: true });

    // no skill dirs
    expect(existsSync(skillsDir()) ? readdirSync(skillsDir()) : []).toEqual([]);
    // no state file
    expect(readState()).toBeNull();

    const lines = argvLines();
    expect(lines.some((a) => a[0] === "mcp" && a[1] === "add")).toBe(false);
    expect(lines.some((a) => a[0] === "plugin" && a[1] === "install")).toBe(false);
    expect(lines.some((a) => a[0] === "plugin" && a[1] === "update")).toBe(false);
    // only the read-only gatherClaudeView probes remain (plugin list / mcp get)
    for (const a of lines) {
      const isProbe = (a[0] === "plugin" && a[1] === "list") || (a[0] === "mcp" && a[1] === "get");
      expect(isProbe).toBe(true);
    }
  });
});

// Scenario 5: env-migrations run inside converge (setup/update path)
test("converge: relocates a pre-0.x loose dotfile, stamps migrationLevel, and reports the migration", () => {
  withTempEnv(() => {
    // Legacy layout: a prior install as a loose dotfile in ~/.claude.
    mkdirSync(claudeHome(), { recursive: true });
    writeFileSync(
      legacyStateFile(),
      JSON.stringify({ version: "0.0.1", installedAt: "legacy-t", skills: [], marketplaces: [], sources: [] }),
    );

    const payload = fixturePayload();
    const summary = converge(payload, { targets: [], force: false, full: true, dryRun: false });

    // migration #1 relocated the legacy file into ner-jarvis's own dir
    expect(existsSync(stateFile())).toBe(true);
    expect(existsSync(legacyStateFile())).toBe(false);

    const state = readState();
    expect(state!.migrationLevel).toBe(CURRENT_MIGRATION_LEVEL);
    expect(state!.version).toBe("9.9.9");
    // the prior install date survived the relocation → converge planned against it
    expect(state!.installedAt).toBe("legacy-t");

    // the summary reports the migration as a success
    expect(summary.successes.some((s) => /migration legacy-layout/.test(s))).toBe(true);
  });
});

// Scenario 6: dry-run does not run migrations (no relocation) and writes no state
test("converge: dry-run does not relocate a legacy dotfile and writes no state", () => {
  withTempEnv(() => {
    mkdirSync(claudeHome(), { recursive: true });
    writeFileSync(legacyStateFile(), JSON.stringify({ version: "0.0.1", skills: [], marketplaces: [], sources: [] }));

    const payload = fixturePayload();
    converge(payload, { targets: [], force: false, full: true, dryRun: true });

    // legacy file left in place; no new state.json written
    expect(existsSync(legacyStateFile())).toBe(true);
    expect(existsSync(stateFile())).toBe(false);
  });
});

// Scenario 7 (Task 2.3 A): a fresh full install writes an undo record + index entry.
test("converge: a fresh install writes an undo record listing the skills (no priorFiles), plugin (wasInstalledByUs), and mcps (no prior)", () => {
  withTempEnv(() => {
    const payload = fixturePayload();
    converge(payload, { targets: [], force: false, full: true, dryRun: false, command: "setup" });

    const idx = readUndoIndex();
    expect(idx.entries.length).toBe(1);
    const entry = idx.entries[0];
    expect(entry.version).toBe("9.9.9");
    expect(entry.command).toBe("setup");
    expect(entry.runId.endsWith("-setup")).toBe(true);

    const rec = readUndoRecord(entry)!;
    expect(rec).not.toBeNull();
    expect(rec.undoSchemaVersion).toBe(1);
    expect(rec.runId).toBe(entry.runId);

    const byKind = (k: UndoEntry["kind"]) => rec.installed.filter((e) => e.kind === k);
    // all 5 skills recorded, none with priorFiles (fresh install)
    const skills = byKind("skill");
    expect(skills.length).toBe(5);
    for (const s of skills) expect((s as any).priorFiles).toBeUndefined();
    // the slack plugin, marked installed-by-us
    const plugins = byKind("plugin");
    expect(plugins.length).toBe(1);
    expect((plugins[0] as any).name).toBe("slack");
    expect((plugins[0] as any).wasInstalledByUs).toBe(true);
    // the marketplace, marked added-by-us
    const marketplaces = byKind("marketplace");
    expect(marketplaces.length).toBe(1);
    expect((marketplaces[0] as any).wasAddedByUs).toBe(true);
    // the two mcps, no prior (freshly added)
    const mcps = byKind("mcp");
    expect(mcps.map((m) => (m as any).name).sort()).toEqual(["atlassian", "github"]);
    for (const m of mcps) expect((m as any).prior).toBeUndefined();
    // no global-note (that comes from setup, not converge)
    expect(byKind("global-note").length).toBe(0);
  });
});

// Scenario 8 (Task 2.3 B): a --force update over an edited skill records priorFiles;
// an mcp-replace records `prior` = the previous url/transport.
test("converge: --force over an edited skill records priorFiles; mcp-replace records prior url/transport", () => {
  withTempEnv(() => {
    const payload = fixturePayload();

    // Seed a prior install: one skill tracked (with a hash that no longer matches disk),
    // and one mcp tracked at a DIFFERENT url so this run must mcp-replace it.
    const priorContents = "OLD onboard body";
    mkdirSync(join(skillsDir(), "ner-onboard"), { recursive: true });
    writeFileSync(join(skillsDir(), "ner-onboard", "SKILL.md"), priorContents);
    const priorHash = hashSkill([{ path: "SKILL.md", contents: priorContents }]);
    writeState({
      stateSchemaVersion: 1, migrationLevel: CURRENT_MIGRATION_LEVEL, version: "9.9.9",
      installedAt: "t", updatedAt: "t",
      skills: [{ name: "ner-onboard", hash: priorHash }],
      marketplaces: [{ name: "claude-plugins-official", source: "anthropics/claude-plugins-official" }],
      sources: [
        { name: "slack", type: "plugin", marketplace: "claude-plugins-official", plugin: "slack" },
        { name: "atlassian", type: "mcp", transport: "http", url: "https://OLD.example/mcp" },
      ],
    });

    // Nothing was installed via commands (state seeded directly), so tell the shim
    // these are present — else planSources would (correctly) plan a restore instead of
    // the update/mcp-replace this scenario exercises.
    process.env.NERJ_FAKE_PLUGINS = "slack@claude-plugins-official";
    process.env.NERJ_FAKE_MCPS = "atlassian";

    // Now the payload skill differs from disk → --force turns skip-modified into update.
    converge(payload, { targets: [], force: true, full: true, dryRun: false, command: "update" });

    const idx = readUndoIndex();
    const rec = readUndoRecord(idx.entries[idx.entries.length - 1])!;

    // the edited skill was overwritten → its PRIOR files are recorded
    const onboard = rec.installed.find((e) => e.kind === "skill" && (e as any).name === "ner-onboard") as any;
    expect(onboard).toBeDefined();
    expect(onboard.priorFiles).toEqual([{ path: "SKILL.md", contents: priorContents }]);

    // atlassian was mcp-replaced → prior url/transport recorded
    const atlassian = rec.installed.find((e) => e.kind === "mcp" && (e as any).name === "atlassian") as any;
    expect(atlassian).toBeDefined();
    expect(atlassian.prior).toEqual({ transport: "http", url: "https://OLD.example/mcp" });
  });
});

// Scenario 9 (Task 3.1): a fresh install (version changed from none) stamps the index
// entry with the delegation target. In dev/tests the channel is "npm", so the target is
// `npxVersion` (nothing archived) and there is no `binaryPath`.
test("converge: a version-changing install stamps npxVersion on the index entry (npm channel)", () => {
  withTempEnv(() => {
    const payload = fixturePayload();
    converge(payload, { targets: [], force: false, full: true, dryRun: false, command: "setup" });

    const entry = readUndoIndex().entries[0];
    expect(entry.npxVersion).toBe("9.9.9");
    expect(entry.binaryPath).toBeUndefined();
  });
});

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTempEnv, writeShim } from "../../test/helpers";
import { writeState } from "../core/state";
import { claudeHome, skillsDir, stateFile, legacyStateFile } from "../core/paths";
import { hashSkill } from "../core/hash";
import { doctor } from "./doctor";

// Inline fake shim: logs each argv to NERJ_LOG and mimics a *present*/healthy
// `claude` surface for doctor's read-only probes. Real `claude` is NEVER invoked.
//   plugin list …  → NERJ_PLUGIN_LIST, else one installed plugin (slack@…), exit 0
//   mcp get …      → exit 0 (server present)
//   mcp list …     → NERJ_MCP_LIST, else slack(plugin) Connected / atlassian
//                    Connected / github Pending authentication
//   everything else (e.g. --version) → exit 0
// Tests set NERJ_PLUGIN_LIST / NERJ_MCP_LIST to drive the install-vs-auth branches.
const SHIM = `import { appendFileSync } from "node:fs";
const a = process.argv.slice(2);
if (process.env.NERJ_LOG) appendFileSync(process.env.NERJ_LOG, JSON.stringify(a) + "\\n");
if (a[0] === "plugin" && a[1] === "list") { process.stdout.write(process.env.NERJ_PLUGIN_LIST ?? JSON.stringify([{ name: "slack@claude-plugins-official", marketplace: "claude-plugins-official" }])); process.exit(0); }
if (a[0] === "mcp" && a[1] === "get") process.exit(0);   // present
if (a[0] === "mcp" && a[1] === "list") { process.stdout.write(process.env.NERJ_MCP_LIST ?? "plugin:slack:slack  Connected\\natlassian  Connected\\ngithub  Pending authentication\\n"); process.exit(0); }
process.exit(0);
`;

let dir: string;
let shimPath: string;
let logPath: string;
const saved = {
  bin: process.env.NER_JARVIS_CLAUDE_BIN,
  log: process.env.NERJ_LOG,
  gh: process.env.NER_JARVIS_GH_BIN,
  ghAuthed: process.env.NERJ_GH_AUTHED,
  mcpList: process.env.NERJ_MCP_LIST,
  pluginList: process.env.NERJ_PLUGIN_LIST,
};

/** All argv lines the shim has logged so far, JSON-parsed. */
function argvLines(): string[][] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nerj-doctor-"));
  shimPath = join(dir, "shim.ts");
  logPath = join(dir, "argv.log");
  writeShim(shimPath, SHIM);
  // Hermetic fake `gh` (installed + authenticated by default; NERJ_GH_AUTHED=0 → logged out).
  const ghPath = join(dir, "gh.ts");
  writeFileSync(ghPath, `const a=process.argv.slice(2); if(a[0]==="auth"&&a[1]==="status")process.exit(process.env.NERJ_GH_AUTHED==="0"?1:0); process.exit(0);`);
  process.env.NER_JARVIS_CLAUDE_BIN = `bun "${shimPath}"`;
  process.env.NER_JARVIS_GH_BIN = `bun ${ghPath}`;
  process.env.NERJ_GH_AUTHED = "1";
  process.env.NERJ_LOG = logPath;
  delete process.env.NERJ_MCP_LIST;    // default healthy mcp list unless a test overrides
  delete process.env.NERJ_PLUGIN_LIST; // default one installed plugin unless a test overrides
});

afterEach(() => {
  if (saved.bin === undefined) delete process.env.NER_JARVIS_CLAUDE_BIN;
  else process.env.NER_JARVIS_CLAUDE_BIN = saved.bin;
  if (saved.log === undefined) delete process.env.NERJ_LOG;
  else process.env.NERJ_LOG = saved.log;
  if (saved.gh === undefined) delete process.env.NER_JARVIS_GH_BIN;
  else process.env.NER_JARVIS_GH_BIN = saved.gh;
  if (saved.ghAuthed === undefined) delete process.env.NERJ_GH_AUTHED;
  else process.env.NERJ_GH_AUTHED = saved.ghAuthed;
  if (saved.mcpList === undefined) delete process.env.NERJ_MCP_LIST;
  else process.env.NERJ_MCP_LIST = saved.mcpList;
  if (saved.pluginList === undefined) delete process.env.NERJ_PLUGIN_LIST;
  else process.env.NERJ_PLUGIN_LIST = saved.pluginList;
  rmSync(dir, { recursive: true, force: true });
});

/** Seed state + a skill on disk. Returns the skill's hash. */
function seed(skillName: string, skillContents: string) {
  const h = hashSkill([{ path: "SKILL.md", contents: skillContents }]);
  mkdirSync(join(skillsDir(), skillName), { recursive: true });
  writeFileSync(join(skillsDir(), skillName, "SKILL.md"), skillContents);
  writeState({
    stateSchemaVersion: 1, migrationLevel: 0, version: "0.1.0", installedAt: "t", updatedAt: "t",
    skills: [{ name: skillName, hash: h }],
    marketplaces: [{ name: "claude-plugins-official", source: "anthropics/claude-plugins-official" }],
    sources: [
      { name: "slack", type: "plugin", marketplace: "claude-plugins-official", plugin: "slack" },
      { name: "atlassian", type: "mcp", transport: "http", url: "https://mcp.atlassian.com/v1/mcp/authv2" },
      { name: "github", type: "mcp", transport: "http", url: "https://api.githubcopilot.com/mcp/" },
    ],
  });
  return h;
}

// Scenario 1: no state at all
test("doctor: no state → ok:false and a 'not set up' line", () => {
  withTempEnv(() => {
    const r = doctor({ targets: [] });
    expect(r.ok).toBe(false);
    expect(r.lines.some((l) => /not set up/i.test(l))).toBe(true);
  });
});

// Scenario 2: healthy
test("doctor: healthy state → ok:true, skill ✓, plugin ✓, atlassian connected, github needs auth", () => {
  withTempEnv(() => {
    seed("ner-onboard", "BODY");
    const r = doctor({ targets: [] });
    expect(r.ok).toBe(true);

    expect(r.lines).toContain("✓ skill ner-onboard");

    const slackLine = r.lines.find((l) => l.includes("slack"));
    expect(slackLine).toBeDefined();
    expect(slackLine!).toContain("✓");
    expect(slackLine!).toContain("plugin");

    const atlassianLine = r.lines.find((l) => l.includes("atlassian"));
    expect(atlassianLine).toBeDefined();
    expect(atlassianLine!).toContain("connected");

    const githubLine = r.lines.find((l) => l.includes("github"));
    expect(githubLine).toBeDefined();
    expect(githubLine!).toContain("needs auth");
  });
});

// Scenario 3: missing skill dir
test("doctor: missing skill dir → ok:false and a ✗/missing line for the skill", () => {
  withTempEnv(() => {
    seed("ner-onboard", "BODY");
    rmSync(join(skillsDir(), "ner-onboard"), { recursive: true, force: true });
    const r = doctor({ targets: [] });
    expect(r.ok).toBe(false);
    const line = r.lines.find((l) => l.includes("ner-onboard"));
    expect(line).toBeDefined();
    expect(line!).toContain("✗");
    expect(line!).toContain("missing");
  });
});

// Scenario 4: modified skill (warning, does NOT fail)
test("doctor: modified skill → ⚠/modified line, ok stays true", () => {
  withTempEnv(() => {
    seed("ner-onboard", "BODY");
    writeFileSync(join(skillsDir(), "ner-onboard", "SKILL.md"), "DIFFERENT CONTENTS");
    const r = doctor({ targets: [] });
    const line = r.lines.find((l) => l.includes("ner-onboard"));
    expect(line).toBeDefined();
    expect(line!).toContain("⚠");
    expect(line!).toContain("modified");
    // only a modified skill + healthy sources → ok remains true
    expect(r.ok).toBe(true);
  });
});

// Scenario 5: targeted
test("doctor: targeted (github) → lines mention github but not slack/atlassian/skill", () => {
  withTempEnv(() => {
    seed("ner-onboard", "BODY");
    const r = doctor({ targets: ["github"] });
    expect(r.lines.some((l) => l.includes("github"))).toBe(true);
    expect(r.lines.some((l) => l.includes("slack"))).toBe(false);
    expect(r.lines.some((l) => l.includes("atlassian"))).toBe(false);
    expect(r.lines.some((l) => l.includes("ner-onboard"))).toBe(false);
  });
});

// Scenario 7: github is checked via the gh CLI — not authenticated → ✗ and ok:false.
test("doctor: gh installed but not authenticated → github (gh CLI) ✗ and ok:false", () => {
  withTempEnv(() => {
    seed("ner-onboard", "BODY");
    process.env.NERJ_GH_AUTHED = "0"; // fake gh reports logged-out
    const r = doctor({ targets: [] });
    const ghLine = r.lines.find((l) => l.includes("gh CLI"));
    expect(ghLine).toBeDefined();
    expect(ghLine!).toContain("not authenticated");
    expect(r.ok).toBe(false);
  });
});

// Scenario 6: read-only (never writes state)
test("doctor: is read-only — state file is unchanged after running", () => {
  withTempEnv(() => {
    seed("ner-onboard", "BODY");
    const before = readFileSync(stateFile(), "utf8");
    doctor({ targets: [] });
    const after = readFileSync(stateFile(), "utf8");
    expect(after).toBe(before);
  });
});

// Scenario 6b: read-only against a legacy layout — reads the loose dotfile IN PLACE,
// never relocating it (relocation is now a setup/update-only migration, not a read).
test("doctor: on a legacy layout does not create state.json or delete the loose dotfile", () => {
  withTempEnv(() => {
    mkdirSync(claudeHome(), { recursive: true });
    writeFileSync(
      legacyStateFile(),
      JSON.stringify({ stateSchemaVersion: 1, migrationLevel: 0, version: "0.0.1", skills: [], marketplaces: [], sources: [] }),
    );
    doctor({ targets: [] });
    expect(existsSync(stateFile())).toBe(false);       // NOT relocated
    expect(existsSync(legacyStateFile())).toBe(true);  // left in place
  });
});

// --- plugin install-vs-auth states (the cmux "reinstall loop" regression) ------

// Scenario 8: an installed plugin whose MCP server needs OAuth is an AUTH gap —
// doctor must point at /mcp, NOT say "not installed" / recommend a reinstall, and fail.
test("doctor: plugin installed but MCP server needs auth → /mcp, not reinstall, ok:false", () => {
  withTempEnv(() => {
    seed("ner-onboard", "BODY");
    process.env.NERJ_MCP_LIST = "plugin:slack:slack  ! Needs authentication\n";
    const r = doctor({ targets: ["slack"] });
    const line = r.lines.find((l) => l.includes("slack"));
    expect(line).toBeDefined();
    expect(line!).toContain("/mcp");
    expect(line!.toLowerCase()).not.toContain("ner-jarvis setup");
    expect(line!.toLowerCase()).not.toContain("not installed");
    expect(r.ok).toBe(false);
  });
});

// Scenario 9: plugin installed but its server isn't listed yet (e.g. pending a
// Claude Code restart) → soft ⚠ pointing at /mcp, still not a reinstall; ok stays true.
test("doctor: plugin installed but server not listed yet → ⚠ /mcp, ok stays true", () => {
  withTempEnv(() => {
    seed("ner-onboard", "BODY");
    process.env.NERJ_MCP_LIST = "atlassian  Connected\n"; // no slack server line
    const r = doctor({ targets: ["slack"] });
    const line = r.lines.find((l) => l.includes("slack"));
    expect(line).toBeDefined();
    expect(line!).toContain("⚠");
    expect(line!).toContain("/mcp");
    expect(line!.toLowerCase()).not.toContain("ner-jarvis setup");
    expect(r.ok).toBe(true);
  });
});

// Scenario 10: plugin genuinely absent (no server line AND not in `plugin list`) —
// the ONE case that should still recommend `ner-jarvis setup`.
test("doctor: plugin not installed at all → ✗ not installed, run ner-jarvis setup, ok:false", () => {
  withTempEnv(() => {
    seed("ner-onboard", "BODY");
    process.env.NERJ_PLUGIN_LIST = "[]";
    process.env.NERJ_MCP_LIST = "atlassian  Connected\n"; // no slack server line
    const r = doctor({ targets: ["slack"] });
    const line = r.lines.find((l) => l.includes("slack"));
    expect(line).toBeDefined();
    expect(line!).toContain("✗");
    expect(line!).toContain("not installed");
    expect(line!).toContain("ner-jarvis setup");
    expect(r.ok).toBe(false);
  });
});

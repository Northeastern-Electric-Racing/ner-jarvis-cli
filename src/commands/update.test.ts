import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTempEnv, writeShim } from "../../test/helpers";
import { skillsDir } from "../core/paths";
import { readState } from "../core/state";
import { readUndoIndex } from "../core/undo";
import { converge } from "./converge";
import { update, isNewer, newerReleaseNotice } from "./update";
import type { EmbeddedPayload, EmbeddedSkill } from "../types";

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

// --- fixture payloads (do NOT rely on the embedded one) ---
function payloadSkill(name: string, contents: string): EmbeddedSkill {
  return { name, files: [{ path: "SKILL.md", contents }] };
}

const ATLASSIAN_V2 = "https://mcp.atlassian.com/v1/mcp/authv2";
const ATLASSIAN_V3 = "https://mcp.atlassian.com/v1/mcp/authv3";

function payloadA(): EmbeddedPayload {
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
      { name: "atlassian", type: "mcp", transport: "http", url: ATLASSIAN_V2 },
      { name: "github", type: "mcp", transport: "http", url: "https://api.githubcopilot.com/mcp/" },
    ],
  };
}

// payloadB = payloadA + a new skill `ner-new`, atlassian url bumped to authv3,
// and `github` dropped entirely.
function payloadB(): EmbeddedPayload {
  return {
    version: "9.9.9",
    skills: [
      payloadSkill("ner-onboard", "onboard"),
      payloadSkill("ner-ask", "ask"),
      payloadSkill("ner-setup", "setup"),
      payloadSkill("ner-repo-explainer", "repo-explainer"),
      payloadSkill("ner-escalation-router", "escalation-router"),
      payloadSkill("ner-new", "new-skill"),
    ],
    marketplaces: [
      { name: "claude-plugins-official", source: "anthropics/claude-plugins-official" },
    ],
    sources: [
      { name: "slack", type: "plugin", marketplace: "claude-plugins-official", plugin: "slack" },
      { name: "atlassian", type: "mcp", transport: "http", url: ATLASSIAN_V3 },
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
  dir = mkdtempSync(join(tmpdir(), "nerj-update-"));
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

// Scenario 1: pure helpers — no shim / temp env needed.
test("update: isNewer / newerReleaseNotice are pure and correct", () => {
  expect(isNewer("v0.2.0", "0.1.0")).toBe(true);
  expect(isNewer("0.1.0", "0.1.0")).toBe(false);
  expect(isNewer("v1.0.0", "0.9.9")).toBe(true);

  expect(typeof newerReleaseNotice("v0.2.0", "0.1.0")).toBe("string");
  expect(newerReleaseNotice("v0.2.0", "0.1.0")).toBeTruthy();
  expect(newerReleaseNotice("v0.1.0", "0.1.0")).toBeNull();
  expect(newerReleaseNotice(null, "0.1.0")).toBeNull();
});

// Scenario 2: full update reconciles a changed payload.
test("update: full run installs new skill, replaces changed mcp, and drops removed source", () => {
  withTempEnv(() => {
    // Baseline install of payload A.
    converge(payloadA(), { targets: [], force: false, full: true, dryRun: false });
    const beforeUpdate = argvLines().length;

    // Update to payload B (adds ner-new, bumps atlassian url, drops github).
    update(payloadB(), { targets: [], force: false, dryRun: false });

    const newLines = argvLines().slice(beforeUpdate);

    // The new skill is on disk.
    expect(existsSync(join(skillsDir(), "ner-new", "SKILL.md"))).toBe(true);

    // github is dropped on a full run.
    expect(newLines).toContainEqual(["mcp", "remove", "github", "--scope", "user"]);
    // atlassian is replaced: a remove AND an add with the new url.
    expect(newLines).toContainEqual(["mcp", "remove", "atlassian", "--scope", "user"]);
    const atlassianAdd = newLines.find(
      (a) => a[0] === "mcp" && a[1] === "add" && a.includes("atlassian"),
    );
    expect(atlassianAdd).toBeDefined();
    expect(atlassianAdd!).toContain(ATLASSIAN_V3);

    // State reflects the new world: no github; atlassian carries the new url.
    const state = readState();
    expect(state).not.toBeNull();
    const names = state!.sources.map((s) => s.name);
    expect(names).not.toContain("github");
    const atlassian = state!.sources.find((s) => s.name === "atlassian");
    expect(atlassian).toBeDefined();
    expect((atlassian as any).url).toBe(ATLASSIAN_V3);
  });
});

// Scenario 2b: a full update writes an undo record tagged command "update".
test("update: writes an undo record with command \"update\"", () => {
  withTempEnv(() => {
    converge(payloadA(), { targets: [], force: false, full: true, dryRun: false });
    const before = readUndoIndex().entries.length;

    update(payloadB(), { targets: [], force: false, dryRun: false });

    const entries = readUndoIndex().entries;
    expect(entries.length).toBe(before + 1);
    const latest = entries[entries.length - 1];
    expect(latest.command).toBe("update");
    expect(latest.runId.endsWith("-update")).toBe(true);
  });
});

// Scenario 3: targeted update removes nothing.
test("update: targeted run reconciles only the target and never removes", () => {
  withTempEnv(() => {
    converge(payloadA(), { targets: [], force: false, full: true, dryRun: false });
    const beforeUpdate = argvLines().length;

    // Targeted at slack only; payload B drops github, but a targeted run must
    // never prune.
    update(payloadB(), { targets: ["slack"], force: false, dryRun: false });

    const newLines = argvLines().slice(beforeUpdate);

    // github survives because targeted runs never remove.
    const state = readState();
    expect(state!.sources.map((s) => s.name)).toContain("github");

    // No mcp remove for github in the new log lines.
    expect(newLines.some((a) => a[0] === "mcp" && a[1] === "remove" && a.includes("github"))).toBe(false);
  });
});

// Scenario 4: binary channel reports a newer release (mocked), never self-replaces.
test("update: binary channel reports a newer release then still converges", () => {
  withTempEnv(() => {
    const logged: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
    try {
      const summary = update(
        payloadA(),
        { targets: [], force: false, dryRun: false },
        { channel: "binary", getLatestReleaseTag: () => "v99.0.0" },
      );

      // Exactly one release notice was printed.
      const notices = logged.filter((l) => /newer .* release/i.test(l));
      expect(notices.length).toBe(1);

      // The run still returns a RunSummary (converge actually ran).
      expect(summary).toBeDefined();
      expect(Array.isArray(summary.successes)).toBe(true);
    } finally {
      console.log = origLog;
    }

    // converge ran: state was written.
    expect(readState()).not.toBeNull();
  });
});

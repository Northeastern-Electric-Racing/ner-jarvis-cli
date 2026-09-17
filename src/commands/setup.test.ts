import { test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTempEnv, writeShim } from "../../test/helpers";
import { globalContextFile, logFile, skillsDir, stateFile } from "../core/paths";
import { readState } from "../core/state";
import { readUndoIndex, readUndoRecord } from "../core/undo";
import { scriptedPrompter } from "../core/prompt";
import { setup } from "./setup";
import { converge } from "./converge";
import { CONTEXT_BEGIN, addGlobalContext } from "../core/context";
import type { EmbeddedPayload, EmbeddedSkill } from "../types";

const listSkillDirs = () => (existsSync(skillsDir()) ? readdirSync(skillsDir()) : []);
const throwingPrompter = { confirm: () => { throw new Error("must not prompt"); }, askPath: () => { throw new Error("must not prompt"); } };

// Same STATEFUL fake shim as converge/update: logs argv, replays its own log so a
// plugin/mcp installed earlier (this run or a prior setup sharing the log) reads
// back as present on later probes — like real `claude`. Tests that seed state.json
// directly can pre-declare presence via NERJ_FAKE_PLUGINS / NERJ_FAKE_MCPS.
// `claude --version` → exit 0 (preflight passes).
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
if (a[0] === "mcp" && a[1] === "list") {
  const rows = [...plugins].map((p) => "plugin:mp:" + p.split("@")[0] + ": url - Connected").concat([...mcps].map((m) => m + ": url - Connected"));
  process.stdout.write(rows.join("\\n")); process.exit(0);
}
if (a[0] === "plugin" && a[1] === "list") { process.stdout.write(JSON.stringify([...plugins].map((p) => ({ id: p })))); process.exit(0); }
process.exit(0);
`;

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
let logPath: string;

// The shim is written ONCE for the whole file, not per test.
//
// Windows: a script written by writeFileSync and spawned microseconds later is
// visible to existsSync but not yet loadable by a new process (AV / filesystem
// handle latency) — the spawn exits 1 with empty stdout AND stderr, and a retry
// succeeds. That reddened `interactive: declining skills…` on windows-latest,
// because the failed spawn made preflight report "claude not found" and abort
// before any state was written. Writing once and warming the spawn removes the
// race. Only the argv log needs per-test isolation, and it stays in `dir`.
let shimDir: string;
let shimPath: string;
const saved = {
  bin: process.env.NER_JARVIS_CLAUDE_BIN,
  log: process.env.NERJ_LOG,
};

/** Every claude argv the shim has logged so far, JSON-parsed. */
function argvLines(): string[][] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

beforeAll(() => {
  shimDir = mkdtempSync(join(tmpdir(), "nerj-shim-"));
  shimPath = join(shimDir, "shim.ts");
  writeShim(shimPath, SHIM); // writeShim warms the spawn (see its note)
});

afterAll(() => {
  rmSync(shimDir, { recursive: true, force: true });
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nerj-setup-"));
  logPath = join(dir, "argv.log");
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

// Scenario 1: preflight passes → converge runs
test("setup: preflight passes → converge runs, no failures, state written", () => {
  withTempEnv(() => {
    const summary = setup(fixturePayload(), { targets: [], force: false, dryRun: false, yes: false });
    expect(summary.failures).toEqual([]);
    expect(existsSync(stateFile())).toBe(true);
  });
});

// Scenario 2: preflight fails → non-zero summary, no state
test("setup: preflight fails (claude missing) → failures recorded, no state written", () => {
  withTempEnv(() => {
    // Point the claude bin at something that does not exist so `--version` fails.
    process.env.NER_JARVIS_CLAUDE_BIN = "/nonexistent/nope";
    const summary = setup(fixturePayload(), { targets: [], force: false, dryRun: false, yes: false });
    expect(summary.failures.length).toBeGreaterThan(0);
    expect(existsSync(stateFile())).toBe(false);
  });
});

// fixturePayload has no workspace; this adds one for the clone/open tests.
const withWorkspace = (): EmbeddedPayload => ({
  ...fixturePayload(),
  workspace: { repo: "https://example.test/repo.git", dirName: "ner-jarvis" },
});

// Prompts on a full run (no workspace): skills, then one per source (slack, atlassian, github).

// Scenario 3: interactive — declining skills installs none but still connects sources.
test("interactive: declining skills installs none, still connects confirmed sources", () => {
  withTempEnv(() => {
    const prompter = scriptedPrompter(["n", "y", "y", "y", "n"]); // skills=n, sources=y, global-context=n
    const summary = setup(fixturePayload(), { targets: [], force: false, dryRun: false, yes: false }, { prompter, isTTY: true });
    // Assert preflight first: without this, a failed preflight writes no state and
    // the next line dies with an opaque "null is not an object".
    expect(summary.failures).toEqual([]);
    expect(listSkillDirs()).toEqual([]);
    const st = readState()!;
    expect(st.skills.length).toBe(0);
    expect(st.sources.map(s => s.name).sort()).toEqual(["atlassian", "github", "slack"]);
  });
});

// Scenario 4: interactive — declining one source skips only it.
test("interactive: declining one source skips only that source", () => {
  withTempEnv(() => {
    const prompter = scriptedPrompter(["y", "y", "n", "y", "n"]); // skills=y, slack=y, atlassian=n, github=y, global-context=n
    setup(fixturePayload(), { targets: [], force: false, dryRun: false, yes: false }, { prompter, isTTY: true });
    const st = readState()!;
    expect(st.skills.length).toBe(5);
    expect(st.sources.map(s => s.name).sort()).toEqual(["github", "slack"]);
  });
});

// Scenario 5: --yes clones the workspace to cwd and opens Claude Code without prompting.
test("--yes clones workspace to cwd + opens Claude Code; injected prompter never read", () => {
  withTempEnv((home) => {
    const clone: string[][] = [];
    const open: string[] = [];
    let globalAdded = false;
    const baseCwd = join(home, "work");
    setup(withWorkspace(), { targets: [], force: false, dryRun: false, yes: true }, {
      prompter: throwingPrompter as any, // proves --yes uses the auto prompter, not this
      cloneWorkspace: (repo, dest) => { clone.push([repo, dest]); return { ok: true, dest }; },
      openClaude: (dir) => { open.push(dir); return { code: 0, stdout: "", stderr: "" }; },
      addGlobalContext: () => { globalAdded = true; return { changed: true, path: "x" }; },
      cwd: baseCwd,
      isTTY: false,
    });
    expect(globalAdded).toBe(true); // --yes auto-adds the global context note
    expect(clone.length).toBe(1);
    expect(clone[0][1]).toBe(join(baseCwd, "ner-jarvis")); // cloned into <cwd>/<dirName>
    expect(open).toEqual([join(baseCwd, "ner-jarvis")]);
    expect(readState()!.skills.length).toBe(5); // skills+sources still done
  });
});

// Scenario 5b (regression): when the workspace already exists, status drives the
// flow — NEVER re-clone — but setup must STILL offer to open Claude Code in it.
test("--yes with an already-present, up-to-date workspace: no clone, still opens Claude Code", () => {
  withTempEnv((home) => {
    const open: string[] = [];
    let cloneCalled = false;
    const baseCwd = join(home, "work");
    setup(withWorkspace(), { targets: [], force: false, dryRun: false, yes: true }, {
      prompter: throwingPrompter as any,
      cloneWorkspace: () => { cloneCalled = true; return { ok: false, dest: "" }; },
      workspaceStatus: () => ({ state: "up-to-date", behind: 0, ahead: 0, dirty: false }),
      openClaude: (d) => { open.push(d); return { code: 0, stdout: "", stderr: "" }; },
      addGlobalContext: () => ({ changed: false, path: "x", skipped: "already present" }),
      cwd: baseCwd,
      isTTY: false,
    });
    expect(cloneCalled).toBe(false); // present dir → never re-clone
    expect(open).toEqual([join(baseCwd, "ner-jarvis")]); // still opened it
  });
});

// Scenario 5d: a present workspace that is behind origin AND clean → offer a
// fast-forward pull; on yes, pullWorkspace runs and it's recorded as a success.
test("--yes with a behind-but-clean workspace pulls (fast-forward) then opens", () => {
  withTempEnv((home) => {
    const pulled: string[] = [];
    const open: string[] = [];
    const baseCwd = join(home, "work");
    const summary = setup(withWorkspace(), { targets: [], force: false, dryRun: false, yes: true }, {
      prompter: throwingPrompter as any,
      cloneWorkspace: () => ({ ok: false, dest: "" }),
      workspaceStatus: () => ({ state: "behind-clean", behind: 2, ahead: 0, dirty: false }),
      pullWorkspace: (d) => { pulled.push(d); return { ok: true }; },
      openClaude: (d) => { open.push(d); return { code: 0, stdout: "", stderr: "" }; },
      addGlobalContext: () => ({ changed: false, path: "x", skipped: "already present" }),
      cwd: baseCwd,
      isTTY: false,
    });
    expect(pulled).toEqual([join(baseCwd, "ner-jarvis")]);
    expect(open).toEqual([join(baseCwd, "ner-jarvis")]);
    expect(summary.successes.some((s) => s.startsWith("workspace pulled"))).toBe(true);
  });
});

// Scenario 5e: a present workspace behind origin but with local edits → NEVER
// pull (would risk the onboardee's work), even under --yes. Still opens.
test("--yes with a behind-but-DIRTY workspace never pulls, still opens", () => {
  withTempEnv((home) => {
    let pullCalled = false;
    const open: string[] = [];
    const baseCwd = join(home, "work");
    setup(withWorkspace(), { targets: [], force: false, dryRun: false, yes: true }, {
      prompter: throwingPrompter as any,
      cloneWorkspace: () => ({ ok: false, dest: "" }),
      workspaceStatus: () => ({ state: "behind-dirty", behind: 3, ahead: 0, dirty: true }),
      pullWorkspace: () => { pullCalled = true; return { ok: true }; },
      openClaude: (d) => { open.push(d); return { code: 0, stdout: "", stderr: "" }; },
      addGlobalContext: () => ({ changed: false, path: "x", skipped: "already present" }),
      cwd: baseCwd,
      isTTY: false,
    });
    expect(pullCalled).toBe(false); // dirty → left untouched
    expect(open).toEqual([join(baseCwd, "ner-jarvis")]);
  });
});

// Scenario 5c: a hard clone failure leaves no directory → must NOT try to open.
test("--yes with a failed clone does not open Claude Code", () => {
  withTempEnv((home) => {
    const open: string[] = [];
    const baseCwd = join(home, "work");
    const summary = setup(withWorkspace(), { targets: [], force: false, dryRun: false, yes: true }, {
      prompter: throwingPrompter as any,
      cloneWorkspace: (_repo, dest) => ({ ok: false, dest, error: "git clone failed (exit 1)" }),
      openClaude: (d) => { open.push(d); return { code: 0, stdout: "", stderr: "" }; },
      addGlobalContext: () => ({ changed: false, path: "x", skipped: "already present" }),
      cwd: baseCwd,
      isTTY: false,
    });
    expect(open).toEqual([]); // nothing to open
    expect(summary.failures.some((f) => f.item.includes("workspace"))).toBe(true);
  });
});

// Scenario 6: minimal (no TTY, no --yes) keeps the legacy flow — never clones/opens.
test("minimal mode: legacy converge; workspace clone/open never called", () => {
  withTempEnv(() => {
    let cloned = false, opened = false;
    setup(withWorkspace(), { targets: [], force: false, dryRun: false, yes: false }, {
      cloneWorkspace: () => { cloned = true; return { ok: true, dest: "" }; },
      openClaude: () => { opened = true; return { code: 0, stdout: "", stderr: "" }; },
      isTTY: false,
    });
    expect(cloned).toBe(false);
    expect(opened).toBe(false);
    expect(readState()!.skills.length).toBe(5); // but skills+sources still installed
  });
});

// Scenario 7: every run appends decision-log lines.
test("setup appends decision-log records", () => {
  withTempEnv(() => {
    const prompter = scriptedPrompter(["y", "y", "y", "y", "n"]); // skills+sources=y, global-context=n
    setup(fixturePayload(), { targets: [], force: false, dryRun: false, yes: false }, { prompter, isTTY: true });
    const lines = readFileSync(logFile(), "utf8").trim().split("\n").map(l => JSON.parse(l));
    expect(lines.some(l => l.event === "start" && l.mode === "interactive")).toBe(true);
    expect(lines.some(l => l.event === "prompt" && l.step === "skills" && l.answer === "yes")).toBe(true);
    expect(lines.some(l => l.event === "prompt" && l.step === "source:slack")).toBe(true);
  });
});

// Scenario 8: confirming the global-context step writes the marked block.
test("interactive: confirming global-context writes the marked block to ~/.claude/CLAUDE.md", () => {
  withTempEnv(() => {
    const prompter = scriptedPrompter(["y", "y", "y", "y", "y"]); // skills+sources+global all yes
    setup(fixturePayload(), { targets: [], force: false, dryRun: false, yes: false }, { prompter, isTTY: true });
    const txt = readFileSync(globalContextFile(), "utf8");
    expect(txt).toContain(CONTEXT_BEGIN);
    expect(txt).toContain("installed NER skills");
  });
});

// Scenario 9: declining the global-context step writes nothing global.
test("interactive: declining global-context leaves no global CLAUDE.md", () => {
  withTempEnv(() => {
    const prompter = scriptedPrompter(["y", "y", "y", "y", "n"]);
    setup(fixturePayload(), { targets: [], force: false, dryRun: false, yes: false }, { prompter, isTTY: true });
    expect(existsSync(globalContextFile())).toBe(false);
  });
});

// Scenario 10 (Task 2.3 §6): a full interactive setup that adds the global note
// records a `global-note` entry in the run's undo record; declining it does not.
test("interactive: adding the global note records a global-note undo entry", () => {
  withTempEnv(() => {
    const prompter = scriptedPrompter(["y", "y", "y", "y", "y"]); // all yes incl. global-context
    setup(fixturePayload(), { targets: [], force: false, dryRun: false, yes: false }, { prompter, isTTY: true });

    const idx = readUndoIndex();
    expect(idx.entries.length).toBe(1);
    expect(idx.entries[0].command).toBe("setup");
    const rec = readUndoRecord(idx.entries[0])!;
    expect(rec.installed.some((e) => e.kind === "global-note")).toBe(true);
  });
});

test("interactive: declining the global note records no global-note undo entry", () => {
  withTempEnv(() => {
    const prompter = scriptedPrompter(["y", "y", "y", "y", "n"]); // decline global-context
    setup(fixturePayload(), { targets: [], force: false, dryRun: false, yes: false }, { prompter, isTTY: true });

    const rec = readUndoRecord(readUndoIndex().entries[0])!;
    expect(rec.installed.some((e) => e.kind === "global-note")).toBe(false);
  });
});

// --- diff-awareness: the wizard checks what's already there before prompting -----

// Scenario 11: on a re-run where skills AND sources are already installed and
// unchanged, the wizard reports "up to date" and prompts for NOTHING — no reinstall
// commands, no churn. (The core of the reported gap: it used to ask blindly.)
test("re-run with everything up to date: no skill/source prompts, no reinstall commands", () => {
  withTempEnv(() => {
    // Seed a full install: skills on disk + state.json, and the source installs get
    // logged so the stateful shim reads them back as present on the next run.
    converge(fixturePayload(), { targets: [], force: false, full: true, dryRun: false });
    const afterSeed = argvLines().length;

    setup(fixturePayload(), { targets: [], force: false, dryRun: false, yes: true }, {
      addGlobalContext: () => ({ changed: false, path: "x", skipped: "already present" }),
      isTTY: false,
    });

    const events = readFileSync(logFile(), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    // Skills reported up to date, never prompted.
    expect(events.some((e) => e.event === "step" && e.step === "skills" && e.outcome === "up-to-date")).toBe(true);
    expect(events.some((e) => e.event === "prompt" && e.step === "skills")).toBe(false);
    // Already-connected sources are never prompted.
    expect(events.some((e) => e.event === "prompt" && e.step === "source:slack")).toBe(false);
    expect(events.some((e) => e.event === "prompt" && e.step === "source:atlassian")).toBe(false);
    // No reinstall/re-add commands were issued by the re-run.
    const during = argvLines().slice(afterSeed);
    expect(during.some((a) => a[0] === "plugin" && a[1] === "install")).toBe(false);
    expect(during.some((a) => a[0] === "mcp" && a[1] === "add")).toBe(false);
  });
});

// Scenario 12: a re-run that introduces ONE new skill prompts for just that change
// (count === 1) and installs only it, leaving the already-present skills alone.
const withExtraSkill = (): EmbeddedPayload => ({
  ...fixturePayload(),
  skills: [...fixturePayload().skills, payloadSkill("ner-new", "new skill")],
});

test("re-run introducing one new skill prompts for just that change and installs only it", () => {
  withTempEnv(() => {
    converge(fixturePayload(), { targets: [], force: false, full: true, dryRun: false });

    setup(withExtraSkill(), { targets: [], force: false, dryRun: false, yes: true }, {
      addGlobalContext: () => ({ changed: false, path: "x", skipped: "already present" }),
      isTTY: false,
    });

    expect(existsSync(join(skillsDir(), "ner-new", "SKILL.md"))).toBe(true);
    expect(listSkillDirs().sort()).toEqual(
      ["ner-ask", "ner-escalation-router", "ner-new", "ner-onboard", "ner-repo-explainer", "ner-setup"].sort(),
    );
    const events = readFileSync(logFile(), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const skillPrompt = events.find((e) => e.event === "prompt" && e.step === "skills");
    expect(skillPrompt).toBeDefined();
    expect(skillPrompt.count).toBe(1); // only the one new skill was the pending change
  });
});

// Scenario 13: on a re-run where the global CLAUDE.md note is already present and
// current, the wizard reports it up to date and does NOT prompt to add it again.
test("re-run with the global note already present: reports up-to-date, no global-context prompt", () => {
  withTempEnv(() => {
    addGlobalContext(); // seed the current note into ~/.claude/CLAUDE.md

    setup(fixturePayload(), { targets: [], force: false, dryRun: false, yes: true }, { isTTY: false });

    const events = readFileSync(logFile(), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(events.some((e) => e.event === "step" && e.step === "global-context" && e.outcome === "up-to-date")).toBe(true);
    expect(events.some((e) => e.event === "prompt" && e.step === "global-context")).toBe(false);
  });
});

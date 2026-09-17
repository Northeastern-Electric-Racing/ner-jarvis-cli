import { test, expect, afterEach } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { withTempEnv } from "./helpers";
import { installFakeClaude, readInvocations, cleanupFakeClaude } from "./fake-claude";
import { loadPayload } from "../src/core/payload";
import { exitCodeFor } from "../src/core/report";
import { skillsDir, stateFile } from "../src/core/paths";
import { readState } from "../src/core/state";
import { setup } from "../src/commands/setup";
import { update } from "../src/commands/update";
import { doctor } from "../src/commands/doctor";
import { uninstall } from "../src/commands/uninstall";

afterEach(cleanupFakeClaude);

const SKILL_NAMES = ["ner-onboard", "ner-ask", "ner-setup", "ner-repo-explainer", "ner-escalation-router", "ner-flag-stale"];
const skillFile = (name: string) => join(skillsDir(), name, "SKILL.md");
const listSkillDirs = () => (existsSync(skillsDir()) ? readdirSync(skillsDir()) : []);
const hasInvocation = (log: string[][], prefix: string[]) =>
  log.some((argv) => prefix.every((p, i) => argv[i] === p));

// Scenario 1: full install → doctor → idempotent update → clean uninstall.
test("e2e: full lifecycle install → doctor → update (idempotent) → uninstall", () => {
  const { logPath } = installFakeClaude();
  withTempEnv(() => {
    // --- setup (full) ---
    const s = setup(loadPayload(), { targets: [], force: false, dryRun: false, yes: false });
    expect(s.failures).toEqual([]);
    for (const name of SKILL_NAMES) expect(existsSync(join(skillsDir(), name))).toBe(true);
    // ner-roster ships as a data-only "skill" dir (no SKILL.md) — its roster.json lands too.
    expect(existsSync(join(skillsDir(), "ner-roster", "roster.json"))).toBe(true);
    const state = readState();
    expect(state).not.toBeNull();
    expect(state!.skills.length).toBe(7); // 6 invokable skills + ner-roster data dir
    expect(state!.sources.length).toBe(2); // slack + atlassian (github is via gh, not a source)

    // --- doctor (all green) ---
    const d = doctor({ targets: [] });
    expect(d.ok).toBe(true);

    // --- update (full) is idempotent for skills ---
    const u = update(loadPayload(), { targets: [], force: false, dryRun: false });
    expect(u.successes.some((x) => x.startsWith("skill "))).toBe(false);

    // --- uninstall (full) removes everything we installed ---
    const un = uninstall({ targets: [], force: false, dryRun: false });
    expect(un.failures).toEqual([]);
    expect(existsSync(stateFile())).toBe(false);
    for (const name of SKILL_NAMES) expect(existsSync(join(skillsDir(), name))).toBe(false);
    expect(existsSync(join(skillsDir(), "ner-roster"))).toBe(false); // data dir cleaned up too

    const log = readInvocations(logPath);
    expect(hasInvocation(log, ["plugin", "uninstall"])).toBe(true);
    expect(hasInvocation(log, ["mcp", "remove"])).toBe(false); // no MCP sources (slack + atlassian are plugins)
  });
});

// Scenario 2: targeting a single source touches only that source.
test("e2e: targeting one source installs only it (no skills, no other sources)", () => {
  const { logPath } = installFakeClaude();
  withTempEnv(() => {
    setup(loadPayload(), { targets: ["slack"], force: false, dryRun: false, yes: false });

    const log = readInvocations(logPath);
    expect(hasInvocation(log, ["plugin", "install", "slack@claude-plugins-official"])).toBe(true);
    expect(hasInvocation(log, ["mcp", "add"])).toBe(false);

    expect(listSkillDirs()).toEqual([]);
    expect(readState()!.sources.map((s) => s.name)).toEqual(["slack"]);
  });
});

// Scenario 3: a foreign (not-ours) skill dir is left untouched.
// (Foreign-MCP-left-intact is covered by the converge/setup unit fixtures.)
test("e2e: non-destructive — a foreign skill dir is left intact", () => {
  installFakeClaude();
  withTempEnv(() => {
    // Pre-create a foreign skill we did NOT install.
    const foreign = skillFile("ner-onboard");
    mkdirSync(dirname(foreign), { recursive: true });
    writeFileSync(foreign, "FOREIGN");

    const s = setup(loadPayload(), { targets: [], force: false, dryRun: false, yes: false });

    // Foreign skill untouched and reported as skipped.
    expect(readFileSync(foreign, "utf8")).toBe("FOREIGN");
    expect(s.skipped.some((k) => k.item.includes("ner-onboard"))).toBe(true);
  });
});

// Scenario 4: --force restores a user-edited tracked skill to payload contents.
test("e2e: --force overwrites a user-edited tracked skill", () => {
  installFakeClaude();
  withTempEnv(() => {
    setup(loadPayload(), { targets: [], force: false, dryRun: false, yes: false }); // install + track
    const f = skillFile("ner-onboard");
    writeFileSync(f, "EDITED");
    expect(readFileSync(f, "utf8")).toBe("EDITED");

    setup(loadPayload(), { targets: [], force: true, dryRun: false, yes: false });
    expect(readFileSync(f, "utf8")).not.toBe("EDITED");
  });
});

// Scenario 5: a single failing step fails the run (non-zero exit) but the rest succeed.
test("e2e: partial failure → non-zero exit, unaffected steps still succeed", () => {
  installFakeClaude({ failPluginInstall: "atlassian" });
  withTempEnv(() => {
    const s = setup(loadPayload(), { targets: [], force: false, dryRun: false, yes: false });
    expect(s.failures.some((f) => f.item.includes("atlassian"))).toBe(true);
    expect(exitCodeFor(s)).not.toBe(0);
    // Everything else went through: skills on disk, successes recorded.
    for (const name of SKILL_NAMES) expect(existsSync(join(skillsDir(), name))).toBe(true);
    expect(s.successes.length).toBeGreaterThan(0);
  });
});

// Scenario 6: --dry-run performs only read-only probes; nothing is written.
test("e2e: dry-run writes nothing and issues no mutating claude commands", () => {
  const { logPath } = installFakeClaude();
  withTempEnv(() => {
    setup(loadPayload(), { targets: [], force: false, dryRun: true, yes: false });

    expect(listSkillDirs()).toEqual([]);
    expect(readState()).toBeNull();

    const log = readInvocations(logPath);
    expect(hasInvocation(log, ["mcp", "add"])).toBe(false);
    expect(hasInvocation(log, ["plugin", "install"])).toBe(false);
    expect(hasInvocation(log, ["plugin", "update"])).toBe(false);
  });
});

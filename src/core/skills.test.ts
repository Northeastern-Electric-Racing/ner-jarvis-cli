import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withTempEnv } from "../../test/helpers";
import { planSkills, applySkillAction } from "./skills";
import { skillsDir } from "./paths";
import { hashSkill } from "./hash";
import type { EmbeddedPayload, EmbeddedSkill, State, SkillAction } from "../types";

// --- fixtures ---
function skill(name: string, contents: string): EmbeddedSkill {
  return { name, files: [{ path: "SKILL.md", contents }] };
}
function payloadOf(...skills: EmbeddedSkill[]): EmbeddedPayload {
  return { version: "0.1.0", skills, marketplaces: [], sources: [] };
}
function stateOf(skillStates: { name: string; hash: string }[]): State {
  return {
    stateSchemaVersion: 1,
    migrationLevel: 0,
    version: "0.1.0",
    installedAt: "2026-07-06T00:00:00Z",
    updatedAt: "2026-07-06T00:00:00Z",
    skills: skillStates,
    marketplaces: [],
    sources: [],
  };
}
const hashOf = (contents: string) => hashSkill([{ path: "SKILL.md", contents }]);

// Scenario 1: fresh install
test("planSkills: fresh (no state, empty disk) → every payload skill is install", () => {
  const payload = payloadOf(skill("a", "AAA"), skill("b", "BBB"));
  const actions = planSkills(payload, null, {}, { force: false, full: true });
  expect(actions).toEqual([
    { kind: "install", name: "a" },
    { kind: "install", name: "b" },
  ]);
});

// Scenario 2: payload changed → update
test("planSkills: payload changed (tracked, onDisk===recorded but payload hash differs) → update", () => {
  const recorded = hashOf("OLD");
  const payload = payloadOf(skill("a", "NEW"));
  const state = stateOf([{ name: "a", hash: recorded }]);
  const actions = planSkills(payload, state, { a: recorded }, { force: false, full: true });
  expect(actions).toEqual([{ kind: "update", name: "a" }]);
});

// Scenario 3: unchanged → noop
test("planSkills: unchanged (tracked, onDisk===recorded===payloadHash) → noop", () => {
  const h = hashOf("SAME");
  const payload = payloadOf(skill("a", "SAME"));
  const state = stateOf([{ name: "a", hash: h }]);
  const actions = planSkills(payload, state, { a: h }, { force: false, full: true });
  expect(actions).toEqual([{ kind: "noop", name: "a" }]);
});

// Scenario 4: foreign → skip-foreign
test("planSkills: foreign (payload has a, not in state, disk has some hash) → skip-foreign", () => {
  const payload = payloadOf(skill("a", "AAA"));
  const actions = planSkills(payload, null, { a: "somepreexistinghash" }, { force: false, full: true });
  expect(actions.length).toBe(1);
  expect(actions[0].kind).toBe("skip-foreign");
  expect(actions[0].name).toBe("a");
  expect((actions[0] as { reason: string }).reason).toBeTruthy();
});

// Scenario 5: user-edited → skip-modified without --force, update with --force
test("planSkills: user-edited (tracked, onDisk!==recorded), force:false → skip-modified", () => {
  const recorded = hashOf("ORIGINAL");
  const payload = payloadOf(skill("a", "PAYLOAD"));
  const state = stateOf([{ name: "a", hash: recorded }]);
  const actions = planSkills(payload, state, { a: "usereditedhash" }, { force: false, full: true });
  expect(actions.length).toBe(1);
  expect(actions[0].kind).toBe("skip-modified");
  expect(actions[0].name).toBe("a");
  expect((actions[0] as { reason: string }).reason).toBeTruthy();
});

test("planSkills: user-edited (tracked, onDisk!==recorded), force:true → update", () => {
  const recorded = hashOf("ORIGINAL");
  const payload = payloadOf(skill("a", "PAYLOAD"));
  const state = stateOf([{ name: "a", hash: recorded }]);
  const actions = planSkills(payload, state, { a: "usereditedhash" }, { force: true, full: true });
  expect(actions).toEqual([{ kind: "update", name: "a" }]);
});

// Scenario 6: removal semantics
test("planSkills: full untargeted run removes a payload-dropped, unmodified tracked skill", () => {
  const aHash = hashOf("AAA");
  const bHash = hashOf("BBB");
  const payload = payloadOf(skill("a", "AAA")); // b dropped from payload
  const state = stateOf([{ name: "a", hash: aHash }, { name: "b", hash: bHash }]);
  const actions = planSkills(payload, state, { a: aHash, b: bHash }, { force: false, full: true });
  expect(actions).toContainEqual({ kind: "remove", name: "b" });
});

test("planSkills: targeted run never removes and only touches targeted skills", () => {
  const aHash = hashOf("AAA");
  const bHash = hashOf("BBB");
  const payload = payloadOf(skill("a", "AAA"));
  const state = stateOf([{ name: "a", hash: aHash }, { name: "b", hash: bHash }]);
  const actions = planSkills(payload, state, { a: aHash, b: bHash }, {
    force: false,
    full: false,
    targets: ["a"],
  });
  expect(actions.some((x) => x.kind === "remove")).toBe(false);
  expect(actions.every((x) => x.name === "a")).toBe(true);
});

// Scenario 7: applier (filesystem side effects)
test("applySkillAction: install writes skillsDir()/a/SKILL.md with the right contents", () => {
  withTempEnv(() => {
    const payload = payloadOf(skill("a", "HELLO"));
    applySkillAction({ kind: "install", name: "a" }, payload, { dryRun: false });
    const dest = join(skillsDir(), "a", "SKILL.md");
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf8")).toBe("HELLO");
  });
});

test("applySkillAction: dry-run install writes nothing", () => {
  withTempEnv(() => {
    const payload = payloadOf(skill("a", "HELLO"));
    applySkillAction({ kind: "install", name: "a" }, payload, { dryRun: true });
    expect(existsSync(join(skillsDir(), "a"))).toBe(false);
  });
});

test("applySkillAction: remove deletes only skillsDir()/a", () => {
  withTempEnv(() => {
    const payload = payloadOf(skill("a", "AAA"), skill("b", "BBB"));
    applySkillAction({ kind: "install", name: "a" }, payload, { dryRun: false });
    applySkillAction({ kind: "install", name: "b" }, payload, { dryRun: false });
    expect(existsSync(join(skillsDir(), "a"))).toBe(true);
    expect(existsSync(join(skillsDir(), "b"))).toBe(true);

    applySkillAction({ kind: "remove", name: "a" }, payload, { dryRun: false });
    expect(existsSync(join(skillsDir(), "a"))).toBe(false);
    expect(existsSync(join(skillsDir(), "b"))).toBe(true);
  });
});

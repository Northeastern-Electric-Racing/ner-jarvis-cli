import { test, expect } from "bun:test";
import { hashSkill } from "./hash";

test("hashSkill is order-independent", () => {
  const a = [{ path: "SKILL.md", contents: "x" }, { path: "ref.md", contents: "y" }];
  const b = [{ path: "ref.md", contents: "y" }, { path: "SKILL.md", contents: "x" }];
  expect(hashSkill(a)).toBe(hashSkill(b));
});

test("hashSkill is sensitive to contents changes", () => {
  const a = [{ path: "SKILL.md", contents: "x" }, { path: "ref.md", contents: "y" }];
  const changed = [{ path: "SKILL.md", contents: "z" }, { path: "ref.md", contents: "y" }];
  expect(hashSkill(a)).not.toBe(hashSkill(changed));
});

test("hashSkill is sensitive to path changes", () => {
  const a = [{ path: "SKILL.md", contents: "x" }];
  const renamed = [{ path: "OTHER.md", contents: "x" }];
  expect(hashSkill(a)).not.toBe(hashSkill(renamed));
});

test("hashSkill returns a hex sha256 string", () => {
  expect(hashSkill([{ path: "SKILL.md", contents: "x" }])).toMatch(/^[0-9a-f]{64}$/);
});

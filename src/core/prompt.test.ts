import { test, expect } from "bun:test";
import { autoPrompter, scriptedPrompter } from "./prompt";

test("confirm: Enter (empty line) returns the default", () => {
  expect(scriptedPrompter([""]).confirm("go?", true)).toBe(true);
  expect(scriptedPrompter([""]).confirm("go?", false)).toBe(false);
});

test("confirm: default is yes when unspecified", () => {
  expect(scriptedPrompter([""]).confirm("go?")).toBe(true);
});

test("confirm: y/yes → true, n/no → false (case-insensitive)", () => {
  expect(scriptedPrompter(["y"]).confirm("go?")).toBe(true);
  expect(scriptedPrompter(["YES"]).confirm("go?")).toBe(true);
  expect(scriptedPrompter(["n"]).confirm("go?")).toBe(false);
  expect(scriptedPrompter(["No"]).confirm("go?")).toBe(false);
});

test("confirm: unrecognized input re-asks, then honors the next answer", () => {
  expect(scriptedPrompter(["maybe", "n"]).confirm("go?")).toBe(false);
  expect(scriptedPrompter(["huh", "what", "y"]).confirm("go?")).toBe(true);
});

test("confirm: exhausted input (EOF) falls back to the default", () => {
  expect(scriptedPrompter([]).confirm("go?", true)).toBe(true);
  expect(scriptedPrompter([]).confirm("go?", false)).toBe(false);
});

test("askPath: Enter returns the default; a typed path is trimmed", () => {
  expect(scriptedPrompter([""]).askPath("where?", "/tmp/x")).toBe("/tmp/x");
  expect(scriptedPrompter(["  /a/b  "]).askPath("where?", "/tmp/x")).toBe("/a/b");
});

test("askPath: EOF returns the default", () => {
  expect(scriptedPrompter([]).askPath("where?", "/d")).toBe("/d");
});

test("autoPrompter returns defaults and never reads input", () => {
  const p = autoPrompter();
  expect(p.confirm("go?", true)).toBe(true);
  expect(p.confirm("go?", false)).toBe(false);
  expect(p.confirm("go?")).toBe(true);
  expect(p.askPath("where?", "/d")).toBe("/d");
});

test("scriptedPrompter can capture what was written", () => {
  const out: string[] = [];
  const p = scriptedPrompter(["n"], (s) => out.push(s));
  p.confirm("Install skills?");
  expect(out.join("")).toContain("Install skills?");
});

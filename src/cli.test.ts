import { expect, test } from "bun:test";
import { parseArgs } from "./cli";

test("no args → setup default", () => {
  expect(parseArgs([])).toEqual({ command: "setup", targets: [], force: false, dryRun: false, yes: false, list: false, json: false, options: {} });
});

test("--yes / -y sets yes", () => {
  expect(parseArgs(["--yes"]).yes).toBe(true);
  expect(parseArgs(["setup", "-y"]).yes).toBe(true);
  expect(parseArgs([]).yes).toBe(false);
});

test("update command, no targets", () => {
  const r = parseArgs(["update"]);
  expect(r.command).toBe("update");
  expect(r.targets).toEqual([]);
});

test("setup with a target", () => {
  const r = parseArgs(["setup", "slack"]);
  expect(r.command).toBe("setup");
  expect(r.targets).toEqual(["slack"]);
});

test("doctor with target and --dry-run", () => {
  const r = parseArgs(["doctor", "github", "--dry-run"]);
  expect(r.command).toBe("doctor");
  expect(r.targets).toEqual(["github"]);
  expect(r.dryRun).toBe(true);
});

test("--force before command and target", () => {
  const r = parseArgs(["--force", "setup", "ner-onboard"]);
  expect(r.force).toBe(true);
  expect(r.command).toBe("setup");
  expect(r.targets).toEqual(["ner-onboard"]);
});

test("--version", () => {
  expect(parseArgs(["--version"]).command).toBe("version");
});

test("--help", () => {
  expect(parseArgs(["--help"]).command).toBe("help");
});

test("bare non-command token is a target under default setup", () => {
  const r = parseArgs(["slack"]);
  expect(r.command).toBe("setup");
  expect(r.targets).toEqual(["slack"]);
});

test("undo --list → command undo, list true", () => {
  const r = parseArgs(["undo", "--list"]);
  expect(r.command).toBe("undo");
  expect(r.list).toBe(true);
});

test("undo --dry-run → command undo, dryRun true, list false", () => {
  const r = parseArgs(["undo", "--dry-run"]);
  expect(r.command).toBe("undo");
  expect(r.dryRun).toBe(true);
  expect(r.list).toBe(false);
});

test("roster is a known command; extra tokens are query terms", () => {
  const r = parseArgs(["roster", "argos", "lead"]);
  expect(r.command).toBe("roster");
  expect(r.targets).toEqual(["argos", "lead"]);
});

test("--json sets json (default false)", () => {
  expect(parseArgs(["roster", "--json"]).json).toBe(true);
  expect(parseArgs(["roster"]).json).toBe(false);
});

test("stale is a known command and --key=value lands in options", () => {
  const r = parseArgs(["stale", "add", "--url=https://x/1", "--wrong=says ask your lead", "--blocked"]);
  expect(r.command).toBe("stale");
  expect(r.targets).toEqual(["add"]);
  expect(r.options).toEqual({ url: "https://x/1", wrong: "says ask your lead", blocked: "true" });
});

test("an option value containing '=' keeps everything after the first one", () => {
  expect(parseArgs(["stale", "--url=https://x/?a=1&b=2"]).options.url).toBe("https://x/?a=1&b=2");
});

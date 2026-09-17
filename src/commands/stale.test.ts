import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { withTempEnv } from "../../test/helpers";
import { staleFile } from "../core/paths";
import { readStaleReports } from "../core/stale";
import { stale } from "./stale";

const DEPS = { reporter: () => "tester", now: () => new Date("2026-09-05T12:00:00.000Z") };

/** Run `stale <verb>` with flags, non-interactively (as the skill will). */
const run = (targets: string[], options: Record<string, string> = {}, json = false) =>
  stale({ targets, options, json, toolVersion: "0.1.0" }, DEPS);

test("add records a report and reports the unsent count", () => {
  withTempEnv(() => {
    const r = run(["add"], { url: "https://x/1", wrong: "says ask your lead", title: "Punt page" });
    expect(r.ok).toBe(true);
    const all = readStaleReports();
    expect(all).toHaveLength(1);
    expect(all[0]!.target.url).toBe("https://x/1");
    expect(all[0]!.reporter).toBe("tester");
    expect(r.lines.join("\n")).toContain("1 unsent report(s)");
  });
});

test("add infers superseded from a supplied successor, orphan-current without one", () => {
  withTempEnv(() => {
    run(["add"], { url: "https://x/1", wrong: "w" });
    run(["add"], { url: "https://x/2", wrong: "w", successor: "https://x/27" });
    const byUrl = Object.fromEntries(readStaleReports().map((r) => [r.target.url, r.verdict]));
    expect(byUrl["https://x/1"]).toBe("orphan-current");
    expect(byUrl["https://x/2"]).toBe("superseded");
  });
});

test("add refuses a bare link — a URL with no explanation isn't actionable", () => {
  withTempEnv(() => {
    const r = run(["add"], { url: "https://x/1" });
    expect(r.ok).toBe(false);
    expect(r.lines[0]).toContain("--wrong");
    expect(existsSync(staleFile())).toBe(false); // nothing written
  });
});

test("add requires a url", () => {
  withTempEnv(() => {
    expect(run(["add"], { wrong: "w" }).ok).toBe(false);
  });
});

test("an out-of-range dimension falls back rather than failing the report", () => {
  withTempEnv(() => {
    run(["add"], { url: "https://x/1", wrong: "w", dimension: "42" });
    expect(readStaleReports()[0]!.dimension).toBe(3);
  });
});

test("list is the default verb and shows nothing on a clean machine", () => {
  withTempEnv(() => {
    expect(run([]).lines).toEqual(["No stale-doc reports recorded."]);
  });
});

test("list --unsent hides what export already marked", () => {
  withTempEnv(() => {
    run(["add"], { url: "https://x/1", wrong: "w" });
    run(["add"], { url: "https://x/2", wrong: "w" });
    run(["export"], { "mark-sent": "true" });
    run(["add"], { url: "https://x/3", wrong: "w" });
    expect(run(["list"], { unsent: "true" }).lines[0]).toBe("1 report (unsent)");
    expect(run(["list"]).lines[0]).toBe("3 reports");
  });
});

test("export emits markdown and --mark-sent stamps the batch", () => {
  withTempEnv(() => {
    run(["add"], { url: "https://x/1", wrong: "says ask your lead" });
    const r = run(["export"], { "mark-sent": "true" });
    expect(r.ok).toBe(true);
    expect(r.lines[0]).toContain("**Stale docs — 1 report**");
    expect(r.lines.join("\n")).toContain("marked 1 report(s) sent");
    expect(readStaleReports()[0]!.sent!.sink).toBe("manual");
  });
});

test("export without --mark-sent changes nothing on disk", () => {
  withTempEnv(() => {
    run(["add"], { url: "https://x/1", wrong: "w" });
    run(["export"]);
    expect(readStaleReports()[0]!.sent).toBeNull();
  });
});

test("rm drops one report by id, and reports an unknown id", () => {
  withTempEnv(() => {
    run(["add"], { url: "https://x/1", wrong: "w" });
    const id = readStaleReports()[0]!.id;
    expect(run(["rm", "nope"]).ok).toBe(false);
    expect(run(["rm", id]).ok).toBe(true);
    expect(readStaleReports()).toEqual([]);
  });
});

test("rm with no id explains itself instead of deleting something", () => {
  withTempEnv(() => {
    run(["add"], { url: "https://x/1", wrong: "w" });
    expect(run(["rm"]).ok).toBe(false);
    expect(readStaleReports()).toHaveLength(1);
  });
});

test("an unknown verb prints the usage rather than guessing", () => {
  withTempEnv(() => {
    const r = run(["frobnicate"]);
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toContain("ner-jarvis stale add");
  });
});

test("--json emits parseable JSON for list and add", () => {
  withTempEnv(() => {
    const added = JSON.parse(run(["add"], { url: "https://x/1", wrong: "w" }, true).lines.join("\n"));
    expect(added.target.url).toBe("https://x/1");
    const listed = JSON.parse(run(["list"], {}, true).lines.join("\n"));
    expect(listed).toHaveLength(1);
  });
});

test("a report never carries an email address — reporter is a name", () => {
  withTempEnv(() => {
    run(["add"], { url: "https://x/1", wrong: "w" });
    expect(JSON.stringify(readStaleReports())).not.toContain("@");
  });
});

import { test, expect } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { withTempEnv } from "../../test/helpers";
import { nerJarvisHome, staleFile } from "./paths";
import {
  CURRENT_STALE_SCHEMA_VERSION,
  appendStaleReport,
  exportMarkdown,
  markSent,
  migrateStaleReport,
  newReportId,
  readStaleReports,
  triageOrder,
  writeStaleReports,
} from "./stale";
import type { StaleReport } from "../types";

function rep(over: Partial<StaleReport> = {}): StaleReport {
  return {
    staleSchemaVersion: CURRENT_STALE_SCHEMA_VERSION,
    id: over.id ?? newReportId(),
    ts: "2026-09-05T00:00:00.000Z",
    toolVersion: "0.1.0",
    verdict: "orphan-current",
    dimension: 3,
    target: { kind: "confluence", url: "https://x/1", title: "A page" },
    whatIsWrong: "says ask your lead",
    blockedMe: false, // read-back normalizes this to a boolean
    reporter: "tester",
    sent: null,
    ...over,
  };
}

test("append then read round-trips a report", () => {
  withTempEnv(() => {
    const r = rep({ id: "a1" });
    appendStaleReport(r);
    // Compare through JSON: absent optional fields read back as explicit `undefined`,
    // which is the same persisted document either way.
    const json = (v: unknown) => JSON.parse(JSON.stringify(v));
    expect(json(readStaleReports())).toEqual(json([r]));
  });
});

test("readStaleReports skips a corrupt line instead of losing the whole backlog", () => {
  withTempEnv(() => {
    appendStaleReport(rep({ id: "good1" }));
    mkdirSync(nerJarvisHome(), { recursive: true });
    appendFileSync(staleFile(), "{not json\n");
    appendStaleReport(rep({ id: "good2" }));
    expect(readStaleReports().map((r) => r.id)).toEqual(["good1", "good2"]);
  });
});

test("migrateStaleReport coerces an unknown shape without throwing", () => {
  const m = migrateStaleReport({ id: "x", target: { url: "u" }, verdict: "nonsense", dimension: 99 });
  expect(m.staleSchemaVersion).toBe(CURRENT_STALE_SCHEMA_VERSION);
  expect(m.verdict).toBe("orphan-current"); // unknown verdict falls back to the urgent one
  expect(m.dimension).toBe(3);              // out-of-range dimension falls back
  expect(m.target.kind).toBe("other");      // missing kind
  expect(m.sent).toBeNull();
});

test("markSent stamps only the named ids and only once", () => {
  withTempEnv(() => {
    appendStaleReport(rep({ id: "a" }));
    appendStaleReport(rep({ id: "b" }));
    expect(markSent(new Set(["a"]), "manual")).toBe(1);
    const after = readStaleReports();
    expect(after.find((r) => r.id === "a")!.sent!.sink).toBe("manual");
    expect(after.find((r) => r.id === "b")!.sent).toBeNull();
    // already sent → not re-stamped
    expect(markSent(new Set(["a"]), "slack")).toBe(0);
    expect(readStaleReports().find((r) => r.id === "a")!.sent!.sink).toBe("manual");
  });
});

test("triageOrder puts orphan-current first, then blocked, then newest", () => {
  const ordered = triageOrder([
    rep({ id: "sup", verdict: "superseded", ts: "2026-09-09T00:00:00.000Z" }),
    rep({ id: "old", ts: "2026-09-01T00:00:00.000Z" }),
    rep({ id: "blocked", ts: "2026-09-02T00:00:00.000Z", blockedMe: true }),
  ]).map((r) => r.id);
  // superseded sorts last even though it is the newest — it misleads least
  expect(ordered).toEqual(["blocked", "old", "sup"]);
});

test("writeStaleReports on an empty list leaves an empty file, not a stray newline", () => {
  withTempEnv(() => {
    appendStaleReport(rep({ id: "a" }));
    writeStaleReports([]);
    expect(readFileSync(staleFile(), "utf8")).toBe("");
    expect(readStaleReports()).toEqual([]);
  });
});

test("exportMarkdown renders a paste-ready block with the rubric name and successor", () => {
  const md = exportMarkdown([
    rep({ id: "a", blockedMe: true, whatIsTrue: "setup is in the README now" }),
    rep({ id: "b", verdict: "superseded", dimension: 1, successor: "https://x/27", target: { kind: "confluence", url: "https://x/2", title: "Old roster" } }),
  ], "0.1.0");
  expect(md).toContain("**Stale docs — 2 reports** (from tester, ner-jarvis 0.1.0)");
  expect(md).toContain("Doc recency & completeness (rubric 3)");
  expect(md).toContain("_blocked me_");
  expect(md).toContain("True:  setup is in the README now");
  expect(md).toContain("Newer: https://x/27");
  // urgent first, regardless of input order
  expect(md.indexOf("orphan-current")).toBeLessThan(md.indexOf("superseded"));
});

test("exportMarkdown says so plainly when there is nothing to report", () => {
  expect(exportMarkdown([])).toBe("No stale-doc reports recorded.");
});

test("newReportId is sortable by time and collision-resistant", () => {
  const a = newReportId(new Date("2026-01-01T00:00:00Z"));
  const b = newReportId(new Date("2026-06-01T00:00:00Z"));
  expect(a < b).toBe(true);
  expect(newReportId()).not.toBe(newReportId());
});

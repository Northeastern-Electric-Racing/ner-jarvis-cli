import { describe, expect, it } from "bun:test";
import { exitCodeFor, formatSummary, type RunSummary } from "./report";

describe("exitCodeFor", () => {
  it("returns 0 when there are only successes and skips (skips are not failures)", () => {
    const summary: RunSummary = {
      successes: ["skills"],
      skipped: [{ item: "ner-onboard", reason: "user-modified" }],
      failures: [],
    };
    expect(exitCodeFor(summary)).toBe(0);
  });

  it("returns a non-zero code when there is at least one failure", () => {
    const summary: RunSummary = {
      successes: [],
      skipped: [],
      failures: [{ item: "atlassian", error: "network error" }],
    };
    expect(exitCodeFor(summary)).toBeGreaterThan(0);
  });
});

describe("formatSummary", () => {
  it("includes successes, skips with reasons, failures with errors, and a retry hint", () => {
    const summary: RunSummary = {
      successes: ["skills"],
      skipped: [{ item: "ner-onboard", reason: "user-modified" }],
      failures: [{ item: "atlassian", error: "network error" }],
    };
    const out = formatSummary(summary);
    // success item present
    expect(out).toContain("skills");
    // skipped item AND its reason
    expect(out).toContain("ner-onboard");
    expect(out).toContain("user-modified");
    // failed item AND its error
    expect(out).toContain("atlassian");
    expect(out).toContain("network error");
    // some retry hint
    expect(out).toMatch(/retry|update/i);
  });

  it("returns a non-empty string when nothing happened", () => {
    const out = formatSummary({ successes: [], skipped: [], failures: [] });
    expect(out.length).toBeGreaterThan(0);
  });
});

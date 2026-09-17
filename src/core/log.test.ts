import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { withTempEnv } from "../../test/helpers";
import { logFile } from "./paths";
import { logDecision } from "./log";

test("logDecision appends one timestamped JSON line per call and accumulates", () => {
  withTempEnv(() => {
    logDecision({ event: "prompt", step: "skills", answer: "yes" });
    logDecision({ event: "step", step: "clone", outcome: "ok" });

    const lines = readFileSync(logFile(), "utf8").trim().split("\n");
    expect(lines.length).toBe(2);

    const first = JSON.parse(lines[0]);
    expect(first.step).toBe("skills");
    expect(first.answer).toBe("yes");
    expect(first.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const second = JSON.parse(lines[1]);
    expect(second.outcome).toBe("ok");
  });
});

test("logDecision creates ~/.claude if missing and never throws", () => {
  withTempEnv(() => {
    // fresh temp HOME → ~/.claude does not exist yet
    expect(() => logDecision({ event: "x" })).not.toThrow();
    expect(existsSync(logFile())).toBe(true);
  });
});

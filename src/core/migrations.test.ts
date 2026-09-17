import { test, expect } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { withTempEnv } from "../../test/helpers";
import { claudeHome, stateFile, legacyStateFile } from "./paths";
import { runEnvMigrations, CURRENT_MIGRATION_LEVEL } from "./migrations";

test("env migration #1 relocates a pre-0.x loose dotfile into ~/.claude/ner-jarvis/", () => {
  withTempEnv(() => {
    mkdirSync(claudeHome(), { recursive: true });
    writeFileSync(legacyStateFile(), '{"version":"0.0.1"}');
    const { actions, level } = runEnvMigrations(0, { dryRun: false });
    expect(existsSync(stateFile())).toBe(true);
    expect(existsSync(legacyStateFile())).toBe(false);
    expect(level).toBe(CURRENT_MIGRATION_LEVEL);
    expect(actions.some(a => a.id === "legacy-layout" && a.outcome === "applied")).toBe(true);
  });
});

test("runEnvMigrations skips migrations at or below fromLevel and is a dry-run no-op", () => {
  withTempEnv(() => {
    mkdirSync(claudeHome(), { recursive: true });
    writeFileSync(legacyStateFile(), "{}");
    const r = runEnvMigrations(CURRENT_MIGRATION_LEVEL, { dryRun: false });
    expect(existsSync(legacyStateFile())).toBe(true); // nothing ran
    const d = runEnvMigrations(0, { dryRun: true });
    expect(existsSync(legacyStateFile())).toBe(true); // dry-run moved nothing
    expect(d.actions.some(a => a.id === "legacy-layout")).toBe(true); // but reported
  });
});

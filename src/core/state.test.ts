import { test, expect } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { withTempEnv } from "../../test/helpers";
import { readState, writeState, migrateState, CURRENT_STATE_SCHEMA_VERSION } from "./state";
import { claudeHome, nerJarvisHome, stateFile, legacyStateFile } from "./paths";
import type { State } from "../types";

test("migrateState defaults migrationLevel to 0 for pre-field state", () => {
  const s = migrateState({ version: "0.1.0", skills: [], marketplaces: [], sources: [] } as any);
  expect(s.migrationLevel).toBe(0);
});
test("migrateState preserves an existing migrationLevel", () => {
  const s = migrateState({ migrationLevel: 3, skills: [], marketplaces: [], sources: [] } as any);
  expect(s.migrationLevel).toBe(3);
});

test("migrateState coerces unknown/older shapes to the current schema version", () => {
  const s = migrateState({ stateSchemaVersion: 0, skills: "oops" } as any);
  expect(s.stateSchemaVersion).toBe(CURRENT_STATE_SCHEMA_VERSION);
  expect(Array.isArray(s.skills)).toBe(true);
});

test("readState() returns null when the file is absent", () => {
  withTempEnv(() => {
    expect(readState()).toBeNull();
  });
});

test("writeState() then readState() round-trips", () => {
  withTempEnv(() => {
    const s: State = {
      stateSchemaVersion: 1,
      migrationLevel: 0,
      version: "0.1.0",
      installedAt: "2026-07-06T00:00:00Z",
      updatedAt: "2026-07-06T00:00:00Z",
      skills: [{ name: "ner-onboard", hash: "abc" }],
      marketplaces: [{ name: "claude-plugins-official", source: "anthropics/claude-plugins-official" }],
      sources: [{ name: "github", type: "mcp", transport: "http", url: "https://api.githubcopilot.com/mcp/" }],
    };
    writeState(s);
    expect(readState()).toEqual(s);
  });
});

test("readState() migrates an older raw file, preserving sources and defaulting missing fields", () => {
  withTempEnv(() => {
    mkdirSync(nerJarvisHome(), { recursive: true });
    writeFileSync(
      stateFile(),
      JSON.stringify({ stateSchemaVersion: 0, sources: [{ name: "x", type: "mcp", transport: "http", url: "u" }] }),
    );
    const migrated = readState();
    expect(migrated).not.toBeNull();
    expect(migrated!.stateSchemaVersion).toBe(CURRENT_STATE_SCHEMA_VERSION);
    expect(CURRENT_STATE_SCHEMA_VERSION).toBe(1);
    expect(migrated!.sources).toEqual([{ name: "x", type: "mcp", transport: "http", url: "u" }]);
    expect(migrated!.skills).toEqual([]);
  });
});

test("readState reads a pre-0.x loose dotfile IN PLACE without moving it", () => {
  withTempEnv(() => {
    mkdirSync(claudeHome(), { recursive: true });
    writeFileSync(legacyStateFile(), JSON.stringify({ version: "0.0.1", skills: [] }));
    const s = readState();
    expect(s?.version).toBe("0.0.1");
    expect(existsSync(legacyStateFile())).toBe(true);   // NOT moved
    expect(existsSync(stateFile())).toBe(false);
  });
});

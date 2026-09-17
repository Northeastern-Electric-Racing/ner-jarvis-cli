import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrateState, CURRENT_STATE_SCHEMA_VERSION } from "../src/core/state";

/** Recursive structural signature: objects → sorted `key:typeof`; arrays → `[elemSig]`. */
function sig(v: any): any {
  if (Array.isArray(v)) return [v.length ? sig(v[0]) : "any"];
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, sig(v[k])]));
  return typeof v;
}

// One representative sample per persisted type, at its CURRENT shape.
const SAMPLES: Record<string, any> = {
  state: { stateSchemaVersion: 1, migrationLevel: 1, version: "0.1.0", installedAt: "t", updatedAt: "t",
           skills: [{ name: "x", hash: "h" }], marketplaces: [{ name: "m", source: "s" }],
           sources: [{ name: "slack", type: "plugin", marketplace: "m", plugin: "slack" }] },
  undoRecord: {
    undoSchemaVersion: 1, runId: "2026-07-08T00-00-00.000Z-setup", version: "0.1.0",
    command: "setup", createdAt: "t",
    installed: [{ kind: "skill", name: "x", installedHash: "h", priorFiles: [{ path: "SKILL.md", contents: "c" }] }],
  },
  staleReport: {
    staleSchemaVersion: 1, id: "20260905T000000-abc123", ts: "t", toolVersion: "0.1.0",
    verdict: "orphan-current", dimension: 3,
    target: { kind: "confluence", url: "u", title: "t" },
    successor: "u2", whatIsWrong: "w", whatIsTrue: "t", blockedMe: true,
    reporter: "someone", sent: { sink: "manual", at: "t", ref: "r" },
  },
  undoIndex: {
    indexSchemaVersion: 1,
    entries: [{ runId: "2026-07-08T00-00-00.000Z-setup", version: "0.1.0", command: "setup",
                createdAt: "t", recordPath: "2026-07-08T00-00-00.000Z-setup.json", undone: true,
                binaryPath: "p", npxVersion: "v" }],
  },
};

test("persisted schemas match the committed golden signatures", () => {
  const golden = JSON.parse(readFileSync(join(import.meta.dir, "schema/golden.json"), "utf8"));
  for (const [name, sample] of Object.entries(SAMPLES)) {
    expect({ name, sig: sig(sample) }).toEqual({ name, sig: golden[name]?.sig });
    // If this fails: you changed a persisted shape. Bump its schemaVersion, ADD a
    // fixtured migration, then update test/schema/golden.json to match.
  }
});

test("migrateState upgrades a pre-schemaVersion, pre-migrationLevel fixture to the current schema", () => {
  const raw = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/legacy/state-v0.json"), "utf8"));
  const s = migrateState(raw);
  expect(s.stateSchemaVersion).toBe(CURRENT_STATE_SCHEMA_VERSION);
  expect(s.migrationLevel).toBe(0); // pre-field install → level 0 until converge stamps it
  // data survives the migration
  expect(s.version).toBe("0.0.3");
  expect(s.skills).toEqual([{ name: "ner-onboard", hash: "deadbeef" }]);
});

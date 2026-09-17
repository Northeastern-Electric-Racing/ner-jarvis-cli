import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { nerJarvisHome, stateFile, legacyStateFile } from "./paths";
import type { State } from "../types";

export const CURRENT_STATE_SCHEMA_VERSION = 1;

/**
 * Ordered, pure schema transforms indexed by from-version: `SCHEMA_MIGRATIONS[n]`
 * takes a shape at `stateSchemaVersion === n` and returns a shape at version `n+1`.
 * No filesystem, no side effects — just reshaping the parsed object. Applied in a
 * loop by `migrateState` until the raw reaches `CURRENT_STATE_SCHEMA_VERSION`.
 *
 *   [0]: v0 (or absent) → v1 — coerce any prior/unknown shape without dropping data.
 */
const SCHEMA_MIGRATIONS: ((raw: any) => any)[] = [
  (raw) => ({
    ...raw,
    version: raw?.version ?? "",
    installedAt: raw?.installedAt ?? "",
    updatedAt: raw?.updatedAt ?? "",
    skills: Array.isArray(raw?.skills) ? raw.skills : [],
    marketplaces: Array.isArray(raw?.marketplaces) ? raw.marketplaces : [],
    sources: Array.isArray(raw?.sources) ? raw.sources : [],
  }),
];

/** Coerce any prior/unknown-shaped state to the current schema without dropping data. */
export function migrateState(raw: any): State {
  // Apply each pending schema transform in order (absent version → 0).
  let cur: any = raw ?? {};
  let from = typeof cur.stateSchemaVersion === "number" ? cur.stateSchemaVersion : 0;
  while (from < CURRENT_STATE_SCHEMA_VERSION) {
    const step = SCHEMA_MIGRATIONS[from];
    if (!step) break; // no transform registered — stop and normalize with what we have
    cur = step(cur);
    from += 1;
  }
  // Final normalize: stamp the current schema version + guarantee typed fields.
  return {
    stateSchemaVersion: CURRENT_STATE_SCHEMA_VERSION,
    migrationLevel: typeof cur?.migrationLevel === "number" ? cur.migrationLevel : 0,
    version: cur?.version ?? "",
    installedAt: cur?.installedAt ?? "",
    updatedAt: cur?.updatedAt ?? "",
    skills: Array.isArray(cur?.skills) ? cur.skills : [],
    marketplaces: Array.isArray(cur?.marketplaces) ? cur.marketplaces : [],
    sources: Array.isArray(cur?.sources) ? cur.sources : [],
  };
}

/**
 * Read-only, location-tolerant load of the persisted state. Prefers the current
 * `~/.claude/ner-jarvis/state.json`, then falls back to reading a pre-0.x loose
 * dotfile IN PLACE. Relocating the legacy file is a side-effect and now lives in
 * the environment-migration ladder (`migrations.ts`, migration #1), run only under
 * `setup`/`update` — so `readState` (and thus `doctor`) never mutates the disk.
 */
export function readState(): State | null {
  const f = existsSync(stateFile()) ? stateFile() : existsSync(legacyStateFile()) ? legacyStateFile() : null;
  if (!f) return null;
  return migrateState(JSON.parse(readFileSync(f, "utf8")));
}

export function writeState(s: State): void {
  mkdirSync(nerJarvisHome(), { recursive: true });
  writeFileSync(stateFile(), JSON.stringify(s, null, 2) + "\n");
}

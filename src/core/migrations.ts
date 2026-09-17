import { existsSync, mkdirSync, renameSync } from "node:fs";
import { nerJarvisHome, stateFile, logFile, legacyStateFile, legacyLogFile } from "./paths";

export interface MigrationDeps { dryRun: boolean; }
export interface MigrationAction { id: string; outcome: "applied" | "noop"; detail?: string; }
export interface EnvMigration { level: number; id: string; apply(deps: MigrationDeps): MigrationAction[]; }

/**
 * Environment migration #1: one-time move of the pre-0.x loose dotfiles
 * (`~/.claude/.ner-jarvis.{json,log}`) into ner-jarvis's own directory
 * (`~/.claude/ner-jarvis/{state.json,log.jsonl}`). Idempotent and side-effecting;
 * runs only under `setup`/`update` (never in a read path), so `doctor`/`readState`
 * stay honestly read-only.
 */
const legacyLayout: EnvMigration = {
  level: 1, id: "legacy-layout",
  apply({ dryRun }) {
    const moves: [string, string][] = [[legacyStateFile(), stateFile()], [legacyLogFile(), logFile()]];
    const pending = moves.filter(([from, to]) => existsSync(from) && !existsSync(to));
    if (!pending.length) return [{ id: "legacy-layout", outcome: "noop" }];
    if (dryRun) return [{ id: "legacy-layout", outcome: "applied", detail: `would relocate ${pending.length} legacy file(s)` }];
    mkdirSync(nerJarvisHome(), { recursive: true });
    for (const [from, to] of pending) renameSync(from, to);
    return [{ id: "legacy-layout", outcome: "applied", detail: `relocated ${pending.length} legacy file(s)` }];
  },
};

export const ENV_MIGRATIONS: EnvMigration[] = [legacyLayout].sort((a, b) => a.level - b.level);
export const CURRENT_MIGRATION_LEVEL = ENV_MIGRATIONS.reduce((m, x) => Math.max(m, x.level), 0);

/** Run every migration with level > fromLevel, in order. Returns actions + the level to stamp. */
export function runEnvMigrations(fromLevel: number, deps: MigrationDeps): { actions: MigrationAction[]; level: number } {
  const actions: MigrationAction[] = [];
  for (const m of ENV_MIGRATIONS) {
    if (m.level <= fromLevel) continue;
    for (const a of m.apply(deps)) actions.push(a);
  }
  return { actions, level: CURRENT_MIGRATION_LEVEL };
}

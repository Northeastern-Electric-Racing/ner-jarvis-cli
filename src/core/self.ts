import { spawnSync } from "node:child_process";

/**
 * Where a recorded run's binary lives. Exactly one of these is normally set:
 *  - `binaryPath` — an archived per-version executable (binary channel), or
 *  - `npxVersion` — the pinned published version to fetch via `npx` (npm channel).
 * `version` is the run's version, used as the `npx` fallback when `npxVersion` is absent.
 */
export interface SelfTarget {
  binaryPath?: string;
  npxVersion?: string;
  version: string;
}

/**
 * Resolve the argv used to invoke a copy of ner-jarvis for a recorded run. PURE — no
 * spawning, no fs — so it can be unit-tested directly.
 *
 * Precedence:
 *  1. `NER_JARVIS_SELF_BIN` (test seam) — split on spaces, then the args. Always wins.
 *  2. `binaryPath` — run the archived exe directly.
 *  3. otherwise `npx -y ner-jarvis@<npxVersion ?? version>`.
 *
 * SAFETY (docs/adr/0004): this only ever targets a locally-archived, already-trusted
 * binary or a pinned published version — never a freshly-fetched arbitrary artifact.
 */
export function buildSelfArgv(target: SelfTarget, args: string[]): string[] {
  const override = process.env.NER_JARVIS_SELF_BIN;
  if (override) return [...override.split(" "), ...args];
  if (target.binaryPath) return [target.binaryPath, ...args];
  return ["npx", "-y", `ner-jarvis@${target.npxVersion ?? target.version}`, ...args];
}

/**
 * Invoke a copy of ner-jarvis (the archived binary that made a run, or the pinned npm
 * version) with the given args, inheriting stdio so interactive prompts pass straight
 * through. Returns the child's exit code (1 if it produced none). `node:` only.
 */
export function runSelf(target: SelfTarget, args: string[]): number {
  const [bin, ...rest] = buildSelfArgv(target, args);
  // Pass `env` explicitly (see core/claude.ts): Bun's spawnSync otherwise snapshots the
  // env at process start and ignores runtime changes, breaking the test seam.
  const r = spawnSync(bin, rest, { stdio: "inherit", env: process.env });
  return r.status ?? 1;
}

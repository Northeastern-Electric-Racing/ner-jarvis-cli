import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Run `fn` with HOME/USERPROFILE pointed at a fresh temp dir; restore after. */
export function withTempEnv<T>(fn: (home: string) => T): T {
  const home = mkdtempSync(join(tmpdir(), "nerj-"));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home; process.env.USERPROFILE = home;
  try { return fn(home); }
  finally {
    process.env.HOME = saved.HOME; process.env.USERPROFILE = saved.USERPROFILE;
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * Write a test shim and prove it can actually be executed before returning.
 *
 * **Windows:** a file written by `writeFileSync` is immediately visible to
 * `existsSync`, but is not yet loadable by a *new* process (AV scan / filesystem
 * handle latency). The first `bun <shim>` spawn exits **1 with empty stdout AND
 * stderr**; a retry succeeds. Tests that spawn a shim right after writing it were
 * therefore flaky on `windows-latest` in ways that looked like product bugs —
 * a failed `--version` probe surfaces as "claude not found", which aborts setup at
 * preflight and leaves no state, which then dies as "null is not an object".
 *
 * Spawning until it loads (bounded) makes every shim-based test deterministic.
 * All `NERJ_*` vars are stripped for the warm-up so the shim takes its default
 * exit-0 path and never pollutes a test's argv log.
 */
export function writeShim(shimPath: string, contents: string): void {
  writeFileSync(shimPath, contents);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("NERJ_")),
  );
  for (let i = 0; i < 30; i++) {
    try {
      execFileSync("bun", [shimPath, "--warmup"], { stdio: "ignore", env });
      return;
    } catch {
      // not loadable yet — retry
    }
  }
}

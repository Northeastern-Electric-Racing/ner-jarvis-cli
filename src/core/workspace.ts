import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { baseCmd, type RunResult } from "./claude";

export interface CloneResult {
  ok: boolean;
  dest: string;
  skipped?: string; // reason it was left untouched (e.g. already exists)
  error?: string;   // reason git failed (never contains secrets)
}

/** Where the workspace repo lands: `<baseDir>/<dirName>`. Pure. */
export function resolveWorkspaceDest(baseDir: string, dirName: string): string {
  return join(baseDir, dirName);
}

/**
 * Clone `repo` into `dest` with `git clone`. **Non-destructive:** if `dest` already
 * exists it is left untouched (no git runs) and reported as skipped. Never throws;
 * a git failure is returned as `{ ok:false, error }` with no secret-bearing output.
 */
export function cloneWorkspace(repo: string, dest: string): CloneResult {
  if (existsSync(dest)) {
    return { ok: false, dest, skipped: `${dest} already exists — left untouched` };
  }
  try {
    // stdio inherited so the user sees clone progress; env passed explicitly (Bun).
    execFileSync("git", ["clone", repo, dest], { stdio: "inherit", env: process.env });
    return { ok: true, dest };
  } catch (e: any) {
    return { ok: false, dest, error: `git clone failed (exit ${e?.status ?? 1})` };
  }
}

export type WorkspaceState =
  | "absent"        // dest doesn't exist → clone
  | "not-git"       // exists but isn't a git repo → leave alone, report
  | "up-to-date"    // git repo, nothing new upstream
  | "behind-clean"  // behind origin AND working tree clean → safe to fast-forward
  | "behind-dirty"  // behind origin but has local edits → report, never pull
  | "diverged"      // local commits diverge from origin → report, never pull
  | "no-upstream"   // no tracking branch to compare against → report
  | "unknown";      // a git command failed unexpectedly → report

export interface WorkspaceStatus {
  state: WorkspaceState;
  behind?: number;
  ahead?: number;
  dirty?: boolean;
}

/** Run a git command in `dest`, capturing stdout. Never throws — returns ok:false on failure. */
function git(dest: string, args: string[]): { ok: boolean; out: string } {
  try {
    const out = execFileSync("git", ["-C", dest, ...args], {
      env: process.env,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    return { ok: true, out };
  } catch {
    return { ok: false, out: "" };
  }
}

/**
 * Inspect an existing workspace clone against its upstream — the "check the diff,
 * not just whether it's there" the setup wizard needs. Best-effort `git fetch`
 * (offline-tolerant), then compares HEAD to its tracking branch and reports whether
 * a fast-forward pull is safe. Read-only; never mutates the checkout. `node:` only.
 */
export function workspaceStatus(dest: string): WorkspaceStatus {
  if (!existsSync(dest)) return { state: "absent" };
  if (!existsSync(join(dest, ".git"))) return { state: "not-git" };

  git(dest, ["fetch", "--quiet"]); // refresh remote-tracking refs; ignore network failure
  const dirty = git(dest, ["status", "--porcelain"]).out.length > 0;

  const upstream = git(dest, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (!upstream.ok) return { state: "no-upstream", dirty };

  // "<ahead>\t<behind>": commits in HEAD-not-upstream, then upstream-not-HEAD.
  const counts = git(dest, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]);
  if (!counts.ok) return { state: "unknown", dirty };
  const [aheadStr, behindStr] = counts.out.split(/\s+/);
  const ahead = Number.parseInt(aheadStr ?? "0", 10) || 0;
  const behind = Number.parseInt(behindStr ?? "0", 10) || 0;

  if (behind === 0) return { state: "up-to-date", ahead, behind, dirty };
  if (ahead > 0) return { state: "diverged", ahead, behind, dirty };
  return { state: dirty ? "behind-dirty" : "behind-clean", ahead, behind, dirty };
}

/**
 * Fast-forward the workspace to its upstream with `git pull --ff-only`. The `--ff-only`
 * guarantees this never creates a merge commit or clobbers local work: if it can't
 * fast-forward it fails cleanly. Only call when `workspaceStatus` reported `behind-clean`.
 */
export function pullWorkspace(dest: string): { ok: boolean; error?: string } {
  try {
    execFileSync("git", ["-C", dest, "pull", "--ff-only"], { stdio: "inherit", env: process.env });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: `git pull failed (exit ${e?.status ?? 1})` };
  }
}

/**
 * Launch Claude Code with its working directory set to `dir` (an interactive
 * session that takes over the terminal). Uses the same `NER_JARVIS_CLAUDE_BIN` seam
 * as the rest of the tool, so tests can point it at a shim.
 */
export function openClaude(dir: string): RunResult {
  const [bin, ...prefix] = baseCmd();
  const r = spawnSync(bin, [...prefix], { cwd: dir, stdio: "inherit", env: process.env });
  return { code: r.status ?? 0, stdout: "", stderr: "" };
}

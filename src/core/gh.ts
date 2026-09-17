import { execFileSync } from "node:child_process";

/**
 * GitHub access in the NER skills goes through the **`gh` CLI** (Claude Code has a
 * shell), not a connected MCP — `gh` is more capable for what the skills need
 * (READMEs, recent committers, CODEOWNERS, code/commit search, issues/PRs) and uses
 * the user's own `gh auth`. ner-jarvis doesn't install or authenticate `gh` (it's a
 * system tool + the user's OAuth); it only *checks* and *guides*, like it does for
 * `git`. The base command is overridable via `NER_JARVIS_GH_BIN` for tests.
 */
export function baseGhCmd(): string[] {
  const override = process.env.NER_JARVIS_GH_BIN;
  return override ? override.split(" ") : ["gh"];
}

function runGh(args: string[]): { code: number } {
  const [bin, ...prefix] = baseGhCmd();
  try {
    execFileSync(bin, [...prefix, ...args], { stdio: "ignore", env: process.env });
    return { code: 0 };
  } catch (e: any) {
    return { code: e?.status ?? 1 };
  }
}

/** `gh` is on PATH (or the test seam resolves). */
export const ghAvailable = (): boolean => runGh(["--version"]).code === 0;
/** `gh auth status` succeeds — the user is logged in. */
export const ghAuthed = (): boolean => runGh(["auth", "status"]).code === 0;

export interface GhStatus { installed: boolean; authed: boolean; }

/** One read-only probe of the local `gh` install. Never throws. */
export function ghStatus(): GhStatus {
  const installed = ghAvailable();
  return { installed, authed: installed && ghAuthed() };
}

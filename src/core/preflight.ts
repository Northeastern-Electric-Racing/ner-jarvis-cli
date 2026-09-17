import { accessSync, constants, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { claudeHome } from "./paths";
import { isClaudeAvailable } from "./claude";

export interface PreflightResult { ok: boolean; problems: string[]; }

function isGitAvailable(): boolean {
  try { execFileSync("git", ["--version"], { stdio: "ignore", env: process.env }); return true; }
  catch { return false; }
}

export function preflight(): PreflightResult {
  const problems: string[] = [];
  if (!isClaudeAvailable()) {
    problems.push("Claude Code CLI (`claude`) was not found on your PATH. Install Claude Code, then re-run: https://docs.claude.com/en/docs/claude-code");
  }
  if (!isGitAvailable()) {
    problems.push("`git` was not found on your PATH. Install git, then re-run.");
  }
  try {
    mkdirSync(claudeHome(), { recursive: true });
    accessSync(claudeHome(), constants.W_OK);
  } catch {
    problems.push(`Cannot create or write to ${claudeHome()}. Check directory permissions and re-run.`);
  }
  return { ok: problems.length === 0, problems };
}

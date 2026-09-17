import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve the user's home directory, preferring HOME/USERPROFILE so tests
 * (and users overriding the env) are honored. `os.homedir()` reads the OS
 * user database and ignores those env vars on macOS/Linux, so we can't rely
 * on it alone for the temp-env test harness.
 */
function home(): string { return process.env.HOME || process.env.USERPROFILE || homedir(); }

export function claudeHome(): string { return join(home(), ".claude"); }
export function skillsDir(): string { return join(claudeHome(), "skills"); }
/** ner-jarvis's own directory for its bookkeeping — `~/.claude/ner-jarvis/`. */
export function nerJarvisHome(): string { return join(claudeHome(), "ner-jarvis"); }
export function stateFile(): string { return join(nerJarvisHome(), "state.json"); }
export function logFile(): string { return join(nerJarvisHome(), "log.jsonl"); }
/**
 * Member-filed stale-doc reports: `~/.claude/ner-jarvis/stale.jsonl`.
 *
 * Deliberately NOT the decision log. That one is spec'd append-only and "never read
 * back" — a debug artifact. These are read back, listed, exported, and marked sent,
 * so they get their own file and their own versioned schema.
 */
export function staleFile(): string { return join(nerJarvisHome(), "stale.jsonl"); }
/** Per-run undo journal: `~/.claude/ner-jarvis/undo/` (records) + `undo/index.json` (frozen stack). */
export function undoDir(): string { return join(nerJarvisHome(), "undo"); }
export function undoIndexFile(): string { return join(undoDir(), "index.json"); }
/** Per-version archived binaries: `~/.claude/ner-jarvis/versions/<version>/` (Phase 3). */
export function versionsDir(): string { return join(nerJarvisHome(), "versions"); }
/** Pre-0.x layout: loose dotfiles in ~/.claude, kept only for one-time migration into nerJarvisHome(). */
export function legacyStateFile(): string { return join(claudeHome(), ".ner-jarvis.json"); }
export function legacyLogFile(): string { return join(claudeHome(), ".ner-jarvis.log"); }
/** The user's *global* Claude instructions file, `~/.claude/CLAUDE.md`. */
export function globalContextFile(): string { return join(claudeHome(), "CLAUDE.md"); }

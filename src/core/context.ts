import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { globalContextFile } from "./paths";

/**
 * ner-jarvis can add one marker-delimited note to the user's *global*
 * `~/.claude/CLAUDE.md` so their everyday Claude reaches for the NER skills.
 *
 * The HTML-comment markers make the edit **idempotent** (never added twice), let us
 * **diff and refresh** the note in place when a version bump changes its text (without
 * moving it or disturbing anything around it), and keep it cleanly **removable** on
 * uninstall. The write is **append-only** w.r.t. the user's own instructions — those are
 * never rewritten. `node:` builtins only.
 */
export const CONTEXT_BEGIN = "<!-- ner-jarvis:begin -->";
export const CONTEXT_END = "<!-- ner-jarvis:end -->";

/** The single line offered for the global CLAUDE.md — *when* to reach for the skills. */
export const CONTEXT_LINE =
  "When working on Northeastern Electric Racing (NER) software — onboarding, " +
  "dev-environment setup, understanding a repo or its code, NER conventions/docs, " +
  "or figuring out who owns what and how to escalate — consider reaching for the " +
  "installed NER skills, and resolve people/ownership live rather than assuming. " +
  "Use the `gh` CLI for GitHub.";

/** The full marker-delimited block. */
export function contextBlock(): string {
  return `${CONTEXT_BEGIN}\n${CONTEXT_LINE}\n${CONTEXT_END}`;
}

/** True if `text` already contains our block. */
export function hasContextBlock(text: string): boolean {
  return text.includes(CONTEXT_BEGIN) && text.includes(CONTEXT_END);
}

/** Pure: `text` with our block appended. Idempotent (unchanged if present) and append-only. */
export function withContextBlock(text: string): string {
  if (hasContextBlock(text)) return text;
  const body = text.replace(/\s+$/, "");
  return body.length === 0 ? contextBlock() + "\n" : `${body}\n\n${contextBlock()}\n`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// Match the block plus any blank separator before it and one trailing newline,
// so removal cleanly reverses `withContextBlock`.
const BLOCK_RE = new RegExp(`\\n*${escapeRegExp(CONTEXT_BEGIN)}[\\s\\S]*?${escapeRegExp(CONTEXT_END)}\\n?`);
// Match exactly our marked region (begin…end) with NO surrounding whitespace, so we can
// swap the block's content *in place* — same position, the user's text on either side intact.
const SYNC_RE = new RegExp(`${escapeRegExp(CONTEXT_BEGIN)}[\\s\\S]*?${escapeRegExp(CONTEXT_END)}`);

/** Pure: `text` with our block removed. Idempotent (unchanged if absent). */
export function withoutContextBlock(text: string): string {
  const out = text.replace(BLOCK_RE, "");
  return out.trim().length === 0 ? "" : out.replace(/\n*$/, "\n");
}

/**
 * Pure: `text` converged to the *current* block — appends it when our markers are absent,
 * refreshes the content in place when the markers are present but stale (a version bump
 * changed the note), and is a no-op when the current block is already there. Append-only
 * w.r.t. the user's own text: on a refresh the block keeps its position and everything
 * around it is preserved.
 */
export function withSyncedBlock(text: string): string {
  if (!hasContextBlock(text)) return withContextBlock(text); // absent → append
  if (text.includes(contextBlock())) return text;            // present & current → no-op
  return text.replace(SYNC_RE, contextBlock());              // present & stale → refresh in place
}

export interface ContextResult {
  changed: boolean;
  path: string;
  created?: boolean;  // the file didn't exist and we created it
  updated?: boolean;  // our markers were present but stale — we refreshed the content in place
  skipped?: string;
}

/** True if the on-disk global CLAUDE.md currently carries our block. */
export function hasGlobalContext(): boolean {
  const path = globalContextFile();
  return existsSync(path) && hasContextBlock(readFileSync(path, "utf8"));
}

export type GlobalContextState =
  | "absent"   // file missing, or present without our markers → would add
  | "stale"    // our markers present but the note text differs → would refresh in place
  | "current"; // the current block is already there → no-op

/**
 * Read-only: what would `addGlobalContext` do? Lets the setup wizard show the note's
 * status and prompt only when there's a real change — instead of asking "add a line?"
 * every run even when it's already present. Mirrors `workspaceStatus` / the planners.
 */
export function globalContextStatus(): GlobalContextState {
  const path = globalContextFile();
  if (!existsSync(path)) return "absent";
  const cur = readFileSync(path, "utf8");
  if (cur.includes(contextBlock())) return "current";
  if (hasContextBlock(cur)) return "stale";
  return "absent";
}

/**
 * Ensure the global CLAUDE.md carries our *current* block, creating the file if needed.
 * Idempotent and non-destructive: appends when absent, refreshes the content in place when
 * our markers are present but stale (a version bump changed the note), and no-ops when the
 * current block is already there. Never rewrites the user's own instructions.
 */
export function addGlobalContext(): ContextResult {
  const path = globalContextFile();
  const existed = existsSync(path);
  const cur = existed ? readFileSync(path, "utf8") : "";
  if (cur.includes(contextBlock())) return { changed: false, path, skipped: "already present" };
  const stale = hasContextBlock(cur); // markers present but content differs → refresh in place
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, withSyncedBlock(cur));
  return { changed: true, path, created: !existed, updated: stale };
}

/**
 * Remove our block from the global CLAUDE.md. If nothing but whitespace remains
 * (the file existed only for our block), delete it to leave no trace.
 */
export function removeGlobalContext(): ContextResult {
  const path = globalContextFile();
  if (!existsSync(path)) return { changed: false, path, skipped: "no global CLAUDE.md" };
  const cur = readFileSync(path, "utf8");
  if (!hasContextBlock(cur)) return { changed: false, path, skipped: "not present" };
  const next = withoutContextBlock(cur);
  if (next.length === 0) rmSync(path);
  else writeFileSync(path, next);
  return { changed: true, path };
}

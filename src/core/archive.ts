import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { versionsDir } from "./paths";
import { readUndoIndex } from "./undo";
import { CHANNEL } from "../channel";

/** Injectable seams so tests can archive without being built on a given channel. */
export interface ArchiveDeps {
  /** Distribution channel; defaults to the build-time `CHANNEL`. */
  channel?: "binary" | "npm";
  /** The running executable to archive; defaults to `process.execPath`. */
  execPath?: string;
}

/**
 * Snapshot the running binary under `~/.claude/ner-jarvis/versions/<version>/` so a
 * future `undo` can delegate rollback to the exact binary that made a run (see
 * docs/adr/0004). Only the **binary** channel archives anything — on **npm** the
 * pinned registry version is reachable via `npx`, so nothing is stored.
 *
 * SAFETY: this only ever copies the already-running, trusted executable — it never
 * fetches anything. Dedupe: if this version is already archived, keep the existing
 * copy (a no-op) so re-runs don't churn ~50-100 MB.
 *
 * @returns the archived binary's path (binary channel), or `null` (npm channel).
 */
export function archiveCurrentBinary(version: string, deps: ArchiveDeps = {}): string | null {
  const channel = deps.channel ?? CHANNEL;
  if (channel !== "binary") return null;
  const execPath = deps.execPath ?? process.execPath;
  const dest = join(versionsDir(), version, basename(execPath));
  if (existsSync(dest)) return dest; // dedupe: already archived
  mkdirSync(join(versionsDir(), version), { recursive: true });
  copyFileSync(execPath, dest);
  return dest;
}

/**
 * Remove a version's archived binary (`versions/<version>/`) — but ONLY when the undo
 * index has no *live* (`!undone`) entry for that version, i.e. all of that version's
 * runs have been reversed (or none were ever recorded). A version that still owns a
 * live run keeps its binary so `undo` can still delegate to it. Since the index is
 * append-only (undone runs stay, flagged), the guard is "no reversible run left needs
 * this binary" rather than "no trace of the version at all". Best-effort and safe.
 */
export function gcVersion(version: string): void {
  const hasLiveRun = readUndoIndex().entries.some((e) => e.version === version && !e.undone);
  if (hasLiveRun) return;
  rmSync(join(versionsDir(), version), { recursive: true, force: true });
}

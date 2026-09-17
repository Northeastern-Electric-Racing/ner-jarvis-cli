import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { skillsDir, undoDir, undoIndexFile } from "./paths";
import { applySkillAction, currentSkillFiles } from "./skills";
import { pluginUninstall, mcpRemove, mcpAdd } from "./claude";
import { removeGlobalContext } from "./context";
import { hashSkill } from "./hash";
import type { EmbeddedPayload, UndoEntry, UndoIndex, UndoIndexEntry, UndoRecord } from "../types";

export const CURRENT_UNDO_SCHEMA_VERSION = 1;
export const CURRENT_UNDO_INDEX_SCHEMA_VERSION = 1;

/** Path of a run's record file, `undo/<runId>.json`. */
function recordFile(runId: string): string {
  return join(undoDir(), `${runId}.json`);
}

/**
 * Read the frozen undo index. Location-tolerant and *best-effort*: unlike the
 * append-only decision log this file is read back to drive rollback, so a missing
 * or corrupt index degrades to an empty (but correctly-stamped) index rather than
 * throwing — a garbled journal must never wedge `undo`.
 */
export function readUndoIndex(): UndoIndex {
  const empty: UndoIndex = { indexSchemaVersion: CURRENT_UNDO_INDEX_SCHEMA_VERSION, entries: [] };
  if (!existsSync(undoIndexFile())) return empty;
  try {
    const raw = JSON.parse(readFileSync(undoIndexFile(), "utf8"));
    return {
      indexSchemaVersion: typeof raw?.indexSchemaVersion === "number" ? raw.indexSchemaVersion : CURRENT_UNDO_INDEX_SCHEMA_VERSION,
      entries: Array.isArray(raw?.entries) ? raw.entries : [],
    };
  } catch {
    return empty; // corrupt index → treat as empty, never throw
  }
}

function writeUndoIndex(idx: UndoIndex): void {
  mkdirSync(undoDir(), { recursive: true });
  writeFileSync(undoIndexFile(), JSON.stringify(idx, null, 2) + "\n");
}

/** Optional index-entry metadata filled in by later phases (per-version binary archival). */
export interface UndoRecordMeta {
  binaryPath?: string;
  npxVersion?: string;
}

/**
 * Persist one run's undo record (`undo/<runId>.json`) and APPEND a matching entry
 * to the frozen index (`undo/index.json`) — the index is append-only, never
 * truncated. `recordPath` is stored relative to `undoDir()` so the journal is
 * relocatable. The record is stamped with the current undo-schema version.
 */
export function writeUndoRecord(record: UndoRecord, meta: UndoRecordMeta = {}): void {
  mkdirSync(undoDir(), { recursive: true });
  const stamped: UndoRecord = { ...record, undoSchemaVersion: CURRENT_UNDO_SCHEMA_VERSION };
  writeFileSync(recordFile(record.runId), JSON.stringify(stamped, null, 2) + "\n");

  const idx = readUndoIndex();
  const entry: UndoIndexEntry = {
    runId: record.runId,
    version: record.version,
    command: record.command,
    createdAt: record.createdAt,
    recordPath: basename(recordFile(record.runId)),
    ...(meta.binaryPath ? { binaryPath: meta.binaryPath } : {}),
    ...(meta.npxVersion ? { npxVersion: meta.npxVersion } : {}),
  };
  idx.entries.push(entry);
  writeUndoIndex(idx);
}

/** Read back one run's record from the index entry's (relative) `recordPath`. */
export function readUndoRecord(entry: UndoIndexEntry): UndoRecord | null {
  const f = join(undoDir(), entry.recordPath);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Append one entry to an already-written run's record (`undo/<runId>.json`).
 * Used when a run adds something AFTER `converge` returns — e.g. `setup` adds the
 * global CLAUDE.md note only later in its gated flow, so it can't be in the record
 * at converge time. Best-effort: a no-op if the record doesn't exist.
 */
export function appendUndoEntry(runId: string, entry: UndoEntry): void {
  const f = recordFile(runId);
  if (!existsSync(f)) return;
  let rec: UndoRecord;
  try {
    rec = JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return;
  }
  rec.installed = [...(rec.installed ?? []), entry];
  writeFileSync(f, JSON.stringify(rec, null, 2) + "\n");
}

/** Mark a run undone in the index (idempotent; no-op if the run isn't present). */
export function markUndone(runId: string): void {
  const idx = readUndoIndex();
  const e = idx.entries.find((x) => x.runId === runId);
  if (!e) return;
  e.undone = true;
  writeUndoIndex(idx);
}

// --- Reverse-action application ------------------------------------------

export interface ApplyUndoOpts { dryRun: boolean; force: boolean; }
export interface UndoOutcome {
  // "undone": actively reversed (or already gone) — progress, no remnant.
  // "noop":   intentionally nothing to reverse (shared marketplace, a plugin we didn't
  //           install, an already-absent note) — benign, leaves no remnant, non-blocking.
  // "skipped":a reversible remnant deliberately left (edited skill w/o --force) — a later
  //           undo could still finish it, so it blocks marking the run fully undone.
  // "failed": an error; remnant remains.
  outcome: "undone" | "noop" | "skipped" | "failed";
  label: string;
  reason?: string;
}

const EMPTY_PAYLOAD: EmbeddedPayload = { version: "", skills: [], marketplaces: [], sources: [] };

/** Hash of a skill dir's current on-disk contents, or "" if it isn't present. */
function onDiskHash(name: string): string {
  const files = currentSkillFiles(name);
  return files ? hashSkill(files) : "";
}

/** Overwrite a skill dir with exactly the recorded prior files (clean restore). */
function restoreSkillFiles(name: string, files: { path: string; contents: string }[]): void {
  applySkillAction({ kind: "remove", name }, EMPTY_PAYLOAD, { dryRun: false }); // clear any current contents
  for (const f of files) {
    const dest = join(skillsDir(), name, f.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, f.contents);
  }
}

/**
 * Reverse ONE recorded action. Pure-ish: never throws (failures are returned).
 * Reuses the same primitives converge/uninstall use. Honors `dryRun` (issues no
 * commands, writes nothing) and `force` (overrides the skill hash-guard).
 *
 * SAFETY: a `marketplace` entry is tracking-only — it NEVER issues
 * `plugin marketplace remove` (shared/official), matching `uninstall`.
 */
export function applyUndoEntry(entry: UndoEntry, opts: ApplyUndoOpts): UndoOutcome {
  switch (entry.kind) {
    case "skill": {
      const label = `skill ${entry.name}`;
      const restore = !!entry.priorFiles;
      const onDisk = onDiskHash(entry.name);
      if (!restore && onDisk === "") return { outcome: "undone", label, reason: "already removed" };
      // Hash-guard: only touch it if what's on disk is what we left (or --force).
      if (onDisk !== entry.installedHash && !opts.force) {
        return { outcome: "skipped", label, reason: "edited since install; left in place (use --force)" };
      }
      if (opts.dryRun) return { outcome: "undone", label };
      try {
        if (restore) restoreSkillFiles(entry.name, entry.priorFiles!);
        else applySkillAction({ kind: "remove", name: entry.name }, EMPTY_PAYLOAD, { dryRun: false });
        return { outcome: "undone", label };
      } catch {
        return { outcome: "failed", label, reason: restore ? "restore failed" : "remove failed" };
      }
    }
    case "plugin": {
      const label = `plugin ${entry.name}`;
      if (!entry.wasInstalledByUs) return { outcome: "noop", label, reason: "not installed by ner-jarvis" };
      if (opts.dryRun) return { outcome: "undone", label };
      const r = pluginUninstall(entry.plugin, entry.marketplace);
      return r.code === 0 ? { outcome: "undone", label } : { outcome: "failed", label, reason: `command failed (exit ${r.code})` };
    }
    case "mcp": {
      const label = `mcp ${entry.name}`;
      if (opts.dryRun) return { outcome: "undone", label };
      if (entry.prior) {
        const rm = mcpRemove(entry.name);
        if (rm.code !== 0) return { outcome: "failed", label, reason: `command failed (exit ${rm.code})` };
        const add = mcpAdd(entry.name, entry.prior.transport, entry.prior.url);
        return add.code === 0 ? { outcome: "undone", label } : { outcome: "failed", label, reason: `command failed (exit ${add.code})` };
      }
      const rm = mcpRemove(entry.name);
      return rm.code === 0 ? { outcome: "undone", label } : { outcome: "failed", label, reason: `command failed (exit ${rm.code})` };
    }
    case "marketplace":
      // SAFETY: shared/official marketplace — tracking-only, never removed. A benign
      // no-op (not a live remnant), so it never blocks marking a run fully undone.
      return { outcome: "noop", label: `marketplace ${entry.name}`, reason: "shared marketplace left in place (never removed)" };
    case "global-note": {
      const label = "global CLAUDE.md note";
      if (opts.dryRun) return { outcome: "undone", label };
      const r = removeGlobalContext();
      // Already gone (user removed it themselves) → benign no-op, doesn't block.
      return r.changed ? { outcome: "undone", label } : { outcome: "noop", label, reason: r.skipped ?? "not present" };
    }
  }
}

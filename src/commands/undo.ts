import { readUndoIndex, readUndoRecord, applyUndoEntry, markUndone } from "../core/undo";
import { gcVersion } from "../core/archive";
import { runSelf as realRunSelf, type SelfTarget } from "../core/self";
import { loadPayload } from "../core/payload";
import type { RunSummary } from "../core/report";
import { autoPrompter, type Prompter } from "../core/prompt";
import { logDecision as realLog, type DecisionEvent } from "../core/log";
import type { UndoEntry, UndoIndexEntry } from "../types";

export interface UndoOpts {
  force: boolean;
  dryRun: boolean;
  yes?: boolean;
  list?: boolean;
  /** Reverse this specific run instead of the most recent live one. */
  runId?: string;
}

/** Side-effecting collaborators, injectable for tests. */
export interface UndoDeps {
  prompter?: Prompter;
  logDecision?: (event: DecisionEvent) => void;
  isTTY?: boolean;
  /** The version this binary ships — runs made by a different version are delegated. */
  currentVersion?: string;
  /** Spawn a copy of ner-jarvis for a foreign-version run (injected in tests). */
  runSelf?: (target: SelfTarget, args: string[]) => number;
}

/** A human label for one undo entry, used in the interactive prompt + the summary. */
function labelFor(entry: UndoEntry): string {
  switch (entry.kind) {
    case "skill": return `skill ${entry.name}`;
    case "plugin": return `plugin ${entry.name}`;
    case "mcp": return `mcp ${entry.name}`;
    case "marketplace": return `marketplace ${entry.name}`;
    case "global-note": return "global CLAUDE.md note";
  }
}

/** Print the undo stack (most recent last), newest first for readability. */
function printStack(entries: UndoIndexEntry[]): void {
  if (!entries.length) { console.log("No ner-jarvis runs recorded — nothing to undo."); return; }
  console.log("Recorded ner-jarvis runs (most recent last):");
  for (const e of entries) {
    const state = e.undone ? " [undone]" : "";
    console.log(`  ${e.runId}  (${e.command}, v${e.version})${state}`);
  }
}

/**
 * Reverse a recorded run. Mirrors `uninstall`'s three modes:
 *  - **interactive** (TTY, no `--yes`): confirm each entry (Enter=undo / `n`=keep).
 *  - **assume-yes** (`--yes`): reverse every entry unattended.
 *  - **minimal** (no TTY, no `--yes`; CI / pipes / tests): reverse every entry, no prompts.
 *
 * `--list` short-circuits to printing the stack. The target run is the most recent
 * not-yet-undone run (or a named `runId`). A run is marked `undone` when every entry
 * was reversed or was a benign no-op (a shared marketplace is never removed and does
 * not block); a declined or genuinely-skipped entry leaves the run tracked so a
 * later `undo` can finish it. A run made by THIS version is reversed in-process; a
 * foreign-version run is **delegated** to the binary that made it (the archived exe
 * or the pinned `npx` version — see docs/adr/0004), which owns its own `markUndone`.
 */
export function undo(opts: UndoOpts, deps: UndoDeps = {}): RunSummary {
  const log = deps.logDecision ?? realLog;
  const isTTY = deps.isTTY ?? false;
  const currentVersion = deps.currentVersion ?? loadPayload().version;
  const runSelf = deps.runSelf ?? realRunSelf;
  const minimal = !opts.yes && !isTTY;
  const mode = minimal ? "minimal" : opts.yes ? "assume-yes" : "interactive";
  const prompter: Prompter = opts.yes || opts.dryRun ? autoPrompter() : (deps.prompter ?? autoPrompter());

  const summary: RunSummary = { successes: [], skipped: [], failures: [] };
  const index = readUndoIndex();

  if (opts.list) {
    printStack(index.entries);
    return summary;
  }

  log({ event: "start", command: "undo", mode, runId: opts.runId, dryRun: opts.dryRun });

  // Pick the target: a named runId, else the most recent live (not-undone) run.
  const target = opts.runId
    ? index.entries.find((e) => e.runId === opts.runId)
    : [...index.entries].reverse().find((e) => !e.undone);

  if (!target) {
    summary.skipped.push({ item: "ner-jarvis", reason: "nothing to undo (no recorded runs to reverse)" });
    log({ event: "done", command: "undo", mode, reason: "nothing to undo" });
    return summary;
  }

  // A foreign-version run is reversed by the binary that MADE it, not this one — the
  // current binary never has to understand an old version's undo logic (docs/adr/0004).
  // Delegate to the archived exe (binaryPath) or the pinned npm version, forwarding the
  // run id + the pass-through flags; that binary does its own `markUndone`/GC.
  if (target.version !== currentVersion) {
    const passthrough = [
      ...(opts.yes ? ["--yes"] : []),
      ...(opts.dryRun ? ["--dry-run"] : []),
      ...(opts.force ? ["--force"] : []),
    ];
    const selfTarget: SelfTarget = { binaryPath: target.binaryPath, npxVersion: target.npxVersion, version: target.version };
    log({ event: "delegate", command: "undo", runId: target.runId, version: target.version });
    const code = runSelf(selfTarget, ["undo", "--runId", target.runId, ...passthrough]);
    if (code === 0) summary.successes.push(`run ${target.runId} (delegated to v${target.version})`);
    else summary.failures.push({ item: `run ${target.runId}`, error: `delegated undo failed (exit ${code})` });
    log({ event: "done", command: "undo", mode, runId: target.runId, outcome: code === 0 ? "delegated" : "delegate-failed" });
    return summary;
  }

  const record = readUndoRecord(target);
  if (!record) {
    summary.failures.push({ item: `run ${target.runId}`, error: "undo record missing or unreadable" });
    log({ event: "done", command: "undo", mode, reason: "record unreadable" });
    return summary;
  }

  // Walk the recorded entries and reverse each (order is presentation-only — the
  // recorded entries are independent, so any order yields the same end state).
  let allReversed = true;
  for (const entry of record.installed) {
    const label = labelFor(entry);
    if (!minimal && !opts.yes) {
      const ans = prompter.confirm(`Undo ${label}?`);
      log({ event: "prompt", command: "undo", step: label, answer: ans ? "yes" : "no" });
      if (!ans) { summary.skipped.push({ item: label, reason: "kept (declined)" }); allReversed = false; continue; }
    }
    const res = applyUndoEntry(entry, { dryRun: opts.dryRun, force: opts.force });
    if (res.outcome === "undone") summary.successes.push(res.label);
    // A benign no-op (e.g. the shared marketplace we never remove) is reported but
    // does NOT block the run from being marked fully undone.
    else if (res.outcome === "noop") summary.skipped.push({ item: res.label, reason: res.reason ?? "nothing to undo" });
    else if (res.outcome === "skipped") { summary.skipped.push({ item: res.label, reason: res.reason ?? "skipped" }); allReversed = false; }
    else { summary.failures.push({ item: res.label, error: res.reason ?? "failed" }); allReversed = false; }
  }

  // Mark the run undone only when fully reversed (and not a dry-run).
  if (allReversed && !opts.dryRun) {
    markUndone(target.runId);
    // GC this version's archived binary once none of its runs still need reversing
    // (gcVersion is a no-op while any live run for the version remains).
    gcVersion(target.version);
    log({ event: "done", command: "undo", mode, runId: target.runId, outcome: "undone" });
  } else {
    log({ event: "done", command: "undo", mode, runId: target.runId, outcome: opts.dryRun ? "dry-run" : "partial" });
  }
  return summary;
}

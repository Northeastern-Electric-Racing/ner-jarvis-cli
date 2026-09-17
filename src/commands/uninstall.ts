import { existsSync, readdirSync, rmSync } from "node:fs";
import { readState, writeState } from "../core/state";
import { nerJarvisHome, staleFile, stateFile, undoDir, versionsDir } from "../core/paths";
import { currentSkillHash } from "./converge";
import { applySkillAction } from "../core/skills";
import { pluginUninstall, mcpRemove } from "../core/claude";
import type { EmbeddedPayload, PluginSource } from "../types";
import type { RunSummary } from "../core/report";
import { removeGlobalContext, hasGlobalContext } from "../core/context";
import { autoPrompter, type Prompter } from "../core/prompt";
import { logDecision as realLog, type DecisionEvent } from "../core/log";

const EMPTY_PAYLOAD: EmbeddedPayload = { version: "", skills: [], marketplaces: [], sources: [] };

export interface UninstallOpts { targets: string[]; force: boolean; dryRun: boolean; yes?: boolean; }

/** Side-effecting collaborators, injectable for tests. Real defaults used in prod. */
export interface UninstallDeps {
  prompter?: Prompter;
  logDecision?: (event: DecisionEvent) => void;
  isTTY?: boolean;
}

/**
 * Remove what ner-jarvis installed. Mirrors setup's three modes:
 *  - **interactive** (TTY, no `--yes`): confirm each removal (Enter=yes → remove / `n` → keep).
 *  - **assume-yes** (`--yes`): remove everything unattended.
 *  - **minimal** (no TTY, no `--yes`; CI / pipes / tests): remove everything tracked, no prompts.
 *
 * Only ever touches items recorded in state, hash-guards user-edited skills, and
 * never removes shared marketplaces. A targeted run (`uninstall <name…>`) scopes to
 * the named items and leaves the global note alone.
 */
export function uninstall(opts: UninstallOpts, deps: UninstallDeps = {}): RunSummary {
  const log = deps.logDecision ?? realLog;
  const isTTY = deps.isTTY ?? false;
  const minimal = !opts.yes && !isTTY;
  const mode = minimal ? "minimal" : opts.yes ? "assume-yes" : "interactive";
  // `--yes` and `--dry-run` never block on input; both use the auto (all-default = remove) prompter.
  const prompter: Prompter = opts.yes || opts.dryRun ? autoPrompter() : (deps.prompter ?? autoPrompter());

  const summary: RunSummary = { successes: [], skipped: [], failures: [] };
  const state = readState();
  if (!state) { summary.skipped.push({ item: "ner-jarvis", reason: "not set up here (nothing to uninstall)" }); return summary; }

  log({ event: "start", command: "uninstall", mode, targets: opts.targets, dryRun: opts.dryRun });

  const targets = opts.targets.length ? new Set(opts.targets) : null;
  const inScope = (n: string) => !targets || targets.has(n);

  // In minimal mode we remove everything tracked without prompting (legacy behavior);
  // otherwise ask, defaulting to yes (Enter = remove).
  const shouldRemove = (question: string, step: string): boolean => {
    if (minimal) return true;
    const ans = prompter.confirm(question);
    log({ event: "prompt", step, answer: ans ? "yes" : "no" });
    return ans;
  };

  // skills — one group prompt, then a per-skill hash-guard (edited skills need --force)
  const removedSkills = new Set<string>();
  const skillsInScope = state.skills.filter((s) => inScope(s.name));
  const doSkills = skillsInScope.length > 0 &&
    shouldRemove(`Remove ${skillsInScope.length} NER skill${skillsInScope.length === 1 ? "" : "s"} from ~/.claude/skills/?`, "skills");
  for (const s of skillsInScope) {
    if (!doSkills) { summary.skipped.push({ item: `skill ${s.name}`, reason: "kept (declined)" }); continue; }
    const onDisk = currentSkillHash(s.name);
    if (onDisk === undefined) { removedSkills.add(s.name); continue; } // already gone → stop tracking
    if (onDisk === s.hash || opts.force) {
      try {
        applySkillAction({ kind: "remove", name: s.name }, EMPTY_PAYLOAD, { dryRun: opts.dryRun });
        if (!opts.dryRun) removedSkills.add(s.name);
        summary.successes.push(`skill ${s.name} (removed)`);
      } catch { summary.failures.push({ item: `skill ${s.name}`, error: "remove failed" }); }
    } else {
      summary.skipped.push({ item: `skill ${s.name}`, reason: "edited since install; left in place (use --force to remove)" });
    }
  }

  // sources — per-source prompt (this is the plugin choice the user asked for)
  const removedSources = new Set<string>();
  for (const src of state.sources) {
    if (!inScope(src.name)) continue;
    const q = src.type === "plugin" ? `Uninstall the ${src.name} plugin?` : `Remove the ${src.name} MCP server?`;
    if (!shouldRemove(q, `source:${src.name}`)) { summary.skipped.push({ item: `source ${src.name}`, reason: "kept (declined)" }); continue; }
    const results = opts.dryRun ? [] : (src.type === "plugin" ? [pluginUninstall(src.plugin, src.marketplace)] : [mcpRemove(src.name)]);
    const failed = results.find((r) => r.code !== 0);
    if (failed) { summary.failures.push({ item: `source ${src.name}`, error: `command failed (exit ${failed.code})` }); continue; }
    if (!opts.dryRun) removedSources.add(src.name);
    summary.successes.push(`source ${src.name} (removed)`);
  }

  // Global context note — remove ours (marker-delimited) on a full uninstall only.
  if (opts.targets.length === 0) {
    if (opts.dryRun) {
      if (hasGlobalContext()) summary.successes.push("global CLAUDE.md note (would remove)");
    } else if (hasGlobalContext() && shouldRemove("Remove the NER note from your global ~/.claude/CLAUDE.md?", "global-context")) {
      if (removeGlobalContext().changed) summary.successes.push("global CLAUDE.md note (removed)");
    }
  }

  // Marketplaces: never issue `marketplace remove` (shared/official — see SAFETY RULE).
  // Only stop tracking marketplaces our remaining sources no longer need.
  if (opts.dryRun) { log({ event: "done", mode, dryRun: true, removed: summary.successes.length }); return summary; }

  const remainingSkills = state.skills.filter((s) => !removedSkills.has(s.name));
  const remainingSources = state.sources.filter((s) => !removedSources.has(s.name));
  const needed = new Set(remainingSources.filter((s) => s.type === "plugin").map((s) => (s as PluginSource).marketplace));
  const remainingMarketplaces = state.marketplaces.filter((m) => needed.has(m.name));

  if (remainingSkills.length === 0 && remainingSources.length === 0 && remainingMarketplaces.length === 0) {
    if (existsSync(stateFile())) rmSync(stateFile()); // clean uninstall → forget everything
    // Nothing remains → clear stale rollback data too: the per-run undo journal and any
    // archived per-version binaries. Best-effort (never wedge a teardown on fs errors).
    // The append-only decision log (log.jsonl) is intentionally left in place.
    rmSync(undoDir(), { recursive: true, force: true });
    rmSync(versionsDir(), { recursive: true, force: true });
    // Stale-doc reports are the member's own notes about NER's wiki, so a full
    // uninstall clears them too rather than leaving personal observations behind.
    rmSync(staleFile(), { force: true });
    // tidy: drop our directory if nothing else remains (the append-only log, if any, is left in place)
    try { if (existsSync(nerJarvisHome()) && readdirSync(nerJarvisHome()).length === 0) rmSync(nerJarvisHome(), { recursive: true }); } catch { /* leave the dir if it isn't empty */ }
  } else {
    writeState({ ...state, updatedAt: new Date().toISOString(), skills: remainingSkills, sources: remainingSources, marketplaces: remainingMarketplaces });
  }
  log({ event: "done", mode, removedSkills: [...removedSkills], removedSources: [...removedSources] });
  return summary;
}

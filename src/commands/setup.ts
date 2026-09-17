import type { EmbeddedPayload, UndoEntry } from "../types";
import { preflight } from "../core/preflight";
import { converge, makeRunId, currentSkillHash } from "./converge";
import { appendUndoEntry, writeUndoRecord, readUndoRecord, readUndoIndex, CURRENT_UNDO_SCHEMA_VERSION } from "../core/undo";
import type { RunSummary } from "../core/report";
import { autoPrompter, type Prompter } from "../core/prompt";
import { readState } from "../core/state";
import { planSkills } from "../core/skills";
import { planSources, gatherClaudeView } from "../core/sources";
import { previewSkills, previewSources } from "../core/preview";
import {
  cloneWorkspace as realClone,
  openClaude as realOpen,
  resolveWorkspaceDest,
  workspaceStatus as realWsStatus,
  pullWorkspace as realPull,
  type CloneResult,
  type WorkspaceStatus,
} from "../core/workspace";
import { mcpListText, mcpServerStatus, type RunResult } from "../core/claude";
import { logDecision as realLog, type DecisionEvent } from "../core/log";
import { addGlobalContext as realAddContext, globalContextStatus, type ContextResult } from "../core/context";
import { globalContextFile } from "../core/paths";
import { ghStatus } from "../core/gh";

export interface SetupOpts {
  targets: string[];
  force: boolean;
  dryRun: boolean;
  yes: boolean;
}

/** Side-effecting collaborators, injectable for tests. Real defaults used in prod. */
export interface SetupDeps {
  prompter?: Prompter;
  cloneWorkspace?: (repo: string, dest: string) => CloneResult;
  workspaceStatus?: (dest: string) => WorkspaceStatus;
  pullWorkspace?: (dest: string) => { ok: boolean; error?: string };
  openClaude?: (dir: string) => RunResult;
  logDecision?: (event: DecisionEvent) => void;
  addGlobalContext?: () => ContextResult;
  cwd?: string;
  isTTY?: boolean;
}

/** One-line status for an already-present workspace, mirroring doctor's glyphs. */
function workspaceStatusLine(s: WorkspaceStatus): string {
  switch (s.state) {
    case "up-to-date":   return "✓ up to date with origin";
    case "behind-clean": return `↑ ${s.behind} commit${s.behind === 1 ? "" : "s"} behind origin`;
    case "behind-dirty": return `⚠ ${s.behind} behind origin, but you have uncommitted changes — skipping pull (run \`git pull\` yourself)`;
    case "diverged":     return "⚠ diverged from origin — leaving as-is";
    case "no-upstream":  return "⚠ no upstream branch configured — leaving as-is";
    case "not-git":      return "⚠ not a git repository — leaving as-is";
    default:             return "⚠ couldn't determine git status — leaving as-is";
  }
}

function preflightFailure(problems: string[]): RunSummary {
  for (const p of problems) console.error(`✗ ${p}`);
  return { successes: [], skipped: [], failures: problems.map(p => ({ item: "preflight", error: p })) };
}

function printAuthGuidance(payload: EmbeddedPayload, sourceNames: Set<string> | null, includeGithub: boolean): void {
  const lines: string[] = [];
  // Read live auth state once so we only nag about sources that actually need it, and
  // reassure about the ones already connected. Auth itself is Claude Code's `/mcp` flow.
  const listText = mcpListText();
  for (const s of payload.sources) {
    if (sourceNames && !sourceNames.has(s.name)) continue;
    const st = mcpServerStatus(s.name, listText);
    if (st === "connected") lines.push(`  • ${s.name}: connected ✓`);
    else lines.push(`  • ${s.name}: open Claude Code and run \`/mcp\` to log in.`);
  }
  if (includeGithub) {
    // GitHub is used via the `gh` CLI, not a connected source — check + guide.
    const gh = ghStatus();
    if (!gh.installed) lines.push("  • github: install the GitHub CLI (https://cli.github.com), then run `gh auth login`.");
    else if (!gh.authed) lines.push("  • github: run `gh auth login` to authenticate the GitHub CLI.");
    else lines.push("  • github: gh CLI authenticated ✓");
  }
  if (lines.length) {
    console.log("\nAuthenticate your sources:");
    for (const l of lines) console.log(l);
  }
}

function nextStep(): void {
  console.log("\nNext: open Claude Code and try the `ner-onboard` skill. Run `ner-jarvis doctor` to verify.");
}

/**
 * Journal the global-note add on this run's undo record. `converge` writes the
 * record (using the shared `runId`) when it applied anything; append the note to
 * it. If the user approved nothing else so no record exists yet, write a minimal
 * one carrying just the note — no secrets, no CLAUDE.md body (reversal strips the
 * marker block via `removeGlobalContext`).
 */
function recordGlobalNote(runId: string, version: string): void {
  const entry: UndoEntry = { kind: "global-note" };
  const existing = readUndoIndex().entries.find((e) => e.runId === runId);
  if (existing && readUndoRecord(existing)) {
    appendUndoEntry(runId, entry);
  } else {
    writeUndoRecord({
      undoSchemaVersion: CURRENT_UNDO_SCHEMA_VERSION,
      runId, version, command: "setup",
      createdAt: new Date().toISOString(),
      installed: [entry],
    });
  }
}

/**
 * Install NER skills + connect sources, and (on a full interactive/`--yes` run)
 * clone the NER workspace and open Claude Code in it.
 *
 * Three modes:
 *  - **interactive** (TTY, no `--yes`): confirm each step (Enter=yes / n).
 *  - **assume-yes** (`--yes`): auto-yes everything, including the workspace steps.
 *  - **minimal** (no TTY, no `--yes`; CI / pipes / tests): the legacy skills+sources
 *    converge, with NO workspace steps.
 *
 * The reconciliation engine (`converge`) is reused unchanged — the prompts just
 * decide which items it's asked to act on. Every run appends to the decision log.
 */
export function setup(payload: EmbeddedPayload, opts: SetupOpts, deps: SetupDeps = {}): RunSummary {
  const log = deps.logDecision ?? realLog;
  const cloneFn = deps.cloneWorkspace ?? realClone;
  const wsStatusFn = deps.workspaceStatus ?? realWsStatus;
  const pullFn = deps.pullWorkspace ?? realPull;
  const openFn = deps.openClaude ?? realOpen;
  const addContext = deps.addGlobalContext ?? realAddContext;
  const cwd = deps.cwd ?? process.cwd();
  const isTTY = deps.isTTY ?? false;
  const wantGithub = opts.targets.length === 0 || opts.targets.includes("github");

  const minimal = !opts.yes && !isTTY;
  const mode = minimal ? "minimal" : opts.yes ? "assume-yes" : "interactive";
  // `--yes` and `--dry-run` never block on input; both use the auto (all-default) prompter.
  const prompter: Prompter = opts.yes || opts.dryRun ? autoPrompter() : (deps.prompter ?? autoPrompter());

  const pf = preflight();
  if (!pf.ok) {
    log({ event: "preflight", ok: false, problems: pf.problems });
    return preflightFailure(pf.problems);
  }
  log({ event: "start", command: "setup", mode, targets: opts.targets, dryRun: opts.dryRun });

  // --- Minimal (legacy) path: full-or-targeted converge, no workspace steps. ---
  if (minimal) {
    const full = opts.targets.length === 0;
    const summary = converge(payload, { targets: opts.targets, force: opts.force, full, dryRun: opts.dryRun });
    log({ event: "converge", mode, successes: summary.successes.length, skipped: summary.skipped.length, failures: summary.failures.length });
    printAuthGuidance(payload, opts.targets.length ? new Set(opts.targets) : null, wantGithub);
    nextStep();
    return summary;
  }

  // --- Gated path (interactive or --yes): confirm each step. ---
  // One run id for the whole gated flow: converge stamps it on the undo record, and
  // the global-note (added later, below) is appended to that same record. Generating
  // it up front is what lets the note — which converge can't see at write time —
  // land on the run's record.
  const runId = makeRunId("setup");
  const scope = new Set(opts.targets);
  const inScope = (n: string) => scope.size === 0 || scope.has(n);
  const full = opts.targets.length === 0;
  const approved: string[] = [];

  // Compute the diff up front (the same planners converge uses) so prompts reflect
  // what actually differs — new / update / already-installed — instead of blindly
  // asking "install everything?". We only ask about, and only converge on, real changes.
  const state = readState();
  const planOpts = { targets: opts.targets, force: opts.force, full: false };

  // Skills: content-hash diff vs on-disk + state. Prompt once for the changed set.
  const skillsInScope = payload.skills.filter(s => inScope(s.name));
  if (skillsInScope.length) {
    const onDisk: Record<string, string | undefined> = {};
    for (const s of payload.skills) onDisk[s.name] = currentSkillHash(s.name);
    for (const s of state?.skills ?? []) if (!(s.name in onDisk)) onDisk[s.name] = currentSkillHash(s.name);
    const pv = previewSkills(planSkills(payload, state, onDisk, planOpts));
    console.log("\nNER skills (~/.claude/skills):");
    for (const l of pv.lines) console.log("  " + l);
    if (pv.hasChanges) {
      const n = pv.changed.length;
      const ans = prompter.confirm(`Apply ${n} skill change${n === 1 ? "" : "s"}?`);
      log({ event: "prompt", step: "skills", answer: ans ? "yes" : "no", count: n });
      if (ans) approved.push(...pv.changed);
    } else {
      console.log("  (nothing to do)");
      log({ event: "step", step: "skills", outcome: "up-to-date" });
    }
  }

  // Sources: live status from `claude`. Prompt only for those needing a change;
  // an already-installed source is shown with its auth state (✓ connected, or ⚠ needs
  // auth + a /mcp hint) and left untouched — installing ≠ authenticated, and only Claude
  // Code's /mcp flow can complete the OAuth, so we flag + guide rather than reinstall.
  const view = gatherClaudeView(payload);
  const listText = mcpListText();
  const authOf = (name: string) => mcpServerStatus(name, listText);
  const spv = previewSources(planSources(payload, state, view, planOpts), authOf);
  if (spv.items.length) {
    console.log("\nSources:");
    for (const item of spv.items) {
      console.log("  " + item.line);
      if (item.hint) console.log("      " + item.hint);
      if (item.isChange) {
        const ans = prompter.confirm(`  ${item.verb} ${item.name}?`);
        log({ event: "prompt", step: `source:${item.name}`, answer: ans ? "yes" : "no" });
        if (ans) approved.push(item.name);
      } else {
        log({ event: "step", step: `source:${item.name}`, outcome: item.hint ? "needs-auth" : "ok" });
      }
    }
  }

  // Converge only on the approved subset. Empty targets would mean "all", so skip
  // the call entirely when nothing was approved.
  const summary: RunSummary = approved.length
    ? converge(payload, { targets: approved, force: opts.force, full: false, dryRun: opts.dryRun, command: "setup", runId })
    : { successes: [], skipped: [], failures: [] };
  const approvedSources = new Set(payload.sources.filter(s => approved.includes(s.name)).map(s => s.name));
  log({ event: "converge", mode, approved, successes: summary.successes.length, failures: summary.failures.length });

  // Global context: offer to nudge the user's everyday Claude toward the NER skills.
  // Full (untargeted) runs only; edits ~/.claude/CLAUDE.md, append-only & idempotent.
  if (full && !opts.dryRun) {
    // Check the note's status first; prompt only when it would actually change
    // (absent → add, stale → refresh). Already-present-and-current → ✓, no prompt.
    const st = globalContextStatus();
    console.log("\nGlobal ~/.claude/CLAUDE.md:");
    if (st === "current") {
      console.log("  ✓ NER usage note — present");
      log({ event: "step", step: "global-context", outcome: "up-to-date" });
    } else {
      console.log("  " + (st === "stale" ? "↑ NER usage note — update available" : "⊕ NER usage note — not added"));
      const verb = st === "stale" ? "Refresh" : "Add";
      const ans = prompter.confirm(`${verb} the NER usage note in your global ~/.claude/CLAUDE.md (so Claude reaches for the NER skills)?`);
      log({ event: "prompt", step: "global-context", answer: ans ? "yes" : "no" });
      if (ans) {
        const r = addContext();
        if (r.changed) {
          summary.successes.push(`global CLAUDE.md (${r.created ? "created" : r.updated ? "refreshed" : "updated"})`);
          log({ event: "step", step: "global-context", outcome: "added", created: !!r.created });
          recordGlobalNote(runId, payload.version);
        } else {
          summary.skipped.push({ item: "global CLAUDE.md", reason: r.skipped ?? "already present" });
          log({ event: "step", step: "global-context", outcome: "skipped", reason: r.skipped });
        }
      }
    }
  } else if (full && opts.dryRun) {
    console.log(`\n[dry-run] would check the NER usage note in ${globalContextFile()} and add or refresh it if needed.`);
  }

  // Workspace steps: full (untargeted) runs only, and only if a workspace is declared.
  if (full && payload.workspace) {
    const ws = payload.workspace;
    if (opts.dryRun) {
      console.log(`\n[dry-run] would clone ${ws.repo} into ${resolveWorkspaceDest(cwd, ws.dirName)} (or, if it already exists, report its git status and offer a fast-forward pull) and offer to open Claude Code.`);
    } else {
      // Neutral wording: on first run we clone here; on a re-run the dir already
      // exists and we report/update it instead. Either way this picks the parent dir.
      const base = prompter.askPath(`Set up the ${ws.repo} workspace — which directory?`, cwd);
      const dest = resolveWorkspaceDest(base, ws.dirName);
      log({ event: "prompt", step: "clone-path", answer: dest });

      // Check the diff, not just whether it's there: absent → clone; present → report
      // its git status and (only if behind AND clean) offer a safe --ff-only pull.
      const status = wsStatusFn(dest);
      let haveDir = false;
      if (status.state === "absent") {
        const clone = cloneFn(ws.repo, dest);
        if (clone.ok) {
          summary.successes.push(`workspace cloned → ${dest}`);
          log({ event: "step", step: "clone", outcome: "ok", dest });
          haveDir = true;
        } else if (clone.skipped) {
          summary.skipped.push({ item: `workspace ${dest}`, reason: clone.skipped });
          log({ event: "step", step: "clone", outcome: "skipped", reason: clone.skipped });
          haveDir = true;
        } else {
          summary.failures.push({ item: `workspace ${dest}`, error: clone.error ?? "clone failed" });
          log({ event: "step", step: "clone", outcome: "failed" });
        }
      } else {
        // Already present — never re-clone; report status and maybe fast-forward.
        haveDir = true;
        console.log(`\nWorkspace (${dest}):`);
        console.log("  " + workspaceStatusLine(status));
        log({ event: "step", step: "workspace", outcome: status.state, behind: status.behind ?? 0 });
        if (status.state === "behind-clean") {
          const n = status.behind ?? 0;
          const ans = prompter.confirm(`Pull ${n} new commit${n === 1 ? "" : "s"} from origin?`);
          log({ event: "prompt", step: "workspace-pull", answer: ans ? "yes" : "no" });
          if (ans) {
            const r = pullFn(dest);
            if (r.ok) { summary.successes.push(`workspace pulled → ${dest}`); log({ event: "step", step: "workspace-pull", outcome: "ok" }); }
            else { summary.failures.push({ item: `workspace ${dest}`, error: r.error ?? "pull failed" }); log({ event: "step", step: "workspace-pull", outcome: "failed" }); }
          }
        }
      }

      // Offer to open Claude Code whenever there's a usable workspace dir — freshly
      // cloned OR already present. Only a hard clone failure leaves nothing to open.
      if (haveDir) {
        const openAns = prompter.confirm(`Open Claude Code in ${dest}?`);
        log({ event: "prompt", step: "open", answer: openAns ? "yes" : "no" });
        if (openAns) {
          printAuthGuidance(payload, approvedSources, wantGithub); // print before Claude takes over
          openFn(dest);
          log({ event: "step", step: "open", outcome: "launched", dest });
          return summary;
        }
      }
    }
  }

  printAuthGuidance(payload, approvedSources, wantGithub);
  nextStep();
  return summary;
}

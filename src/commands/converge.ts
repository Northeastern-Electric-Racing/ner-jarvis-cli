import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { EmbeddedPayload, State, SkillAction, SourceAction, ReconcileOpts, Marketplace, Source, McpSource, UndoEntry } from "../types";
import { skillsDir } from "../core/paths";
import { hashSkill } from "../core/hash";
import { readState, writeState, CURRENT_STATE_SCHEMA_VERSION } from "../core/state";
import { runEnvMigrations } from "../core/migrations";
import { planSkills, applySkillAction, currentSkillFiles } from "../core/skills";
import { planSources, applySourceAction, gatherClaudeView } from "../core/sources";
import { writeUndoRecord, CURRENT_UNDO_SCHEMA_VERSION } from "../core/undo";
import { archiveCurrentBinary } from "../core/archive";
import type { RunSummary } from "../core/report";

export type ConvergeOpts = ReconcileOpts & {
  dryRun: boolean;
  /** Which top-level command drove this converge — recorded on the undo record. Defaults to "setup". */
  command?: "setup" | "update";
  /**
   * Run id to stamp on the undo record. `setup` generates one up front (so it can
   * append a `global-note` entry after converge returns); the `update` path leaves
   * this undefined and converge generates its own.
   */
  runId?: string;
};

/** A run id: an ISO timestamp with `:` → `-` (path-safe), suffixed with the command. */
export function makeRunId(command: "setup" | "update", now = new Date()): string {
  return `${now.toISOString().replace(/:/g, "-")}-${command}`;
}

/** Hash of a skill dir's current on-disk contents (paths relative to the dir, matching the embed script). */
export function currentSkillHash(name: string): string | undefined {
  const dir = join(skillsDir(), name);
  if (!existsSync(dir)) return undefined;
  const files: { path: string; contents: string }[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else files.push({ path: relative(dir, full), contents: readFileSync(full, "utf8") });
    }
  };
  walk(dir);
  return hashSkill(files);
}

function sourceActionLabel(a: SourceAction): string {
  if (a.kind === "marketplace-add" || a.kind === "marketplace-prune") return `marketplace ${a.marketplace.name} (${a.kind})`;
  if (a.kind === "skip-foreign" || a.kind === "noop") return a.name;
  return `source ${a.source.name} (${a.kind})`;
}

export function converge(payload: EmbeddedPayload, opts: ConvergeOpts): RunSummary {
  const summary: RunSummary = { successes: [], skipped: [], failures: [] };

  // Run pending environment migrations FIRST (side-effecting; e.g. migration #1
  // relocates a pre-0.x loose dotfile into ner-jarvis's own dir), then read the
  // now-canonical state for planning. Dry-run reports what would run but moves nothing.
  const fromLevel = readState()?.migrationLevel ?? 0;
  const mig = runEnvMigrations(fromLevel, { dryRun: opts.dryRun });
  for (const a of mig.actions) if (a.outcome === "applied") summary.successes.push(`migration ${a.id}${a.detail ? ` — ${a.detail}` : ""}`);

  const prev = readState();

  const skillHashes = new Map((prev?.skills ?? []).map(s => [s.name, s.hash]));
  const marketplaces = new Map<string, Marketplace>((prev?.marketplaces ?? []).map(m => [m.name, m]));
  const sources = new Map<string, Source>((prev?.sources ?? []).map(s => [s.name, s]));
  const payloadSkillHash = new Map(payload.skills.map(s => [s.name, hashSkill(s.files)]));
  const prevSources = new Map<string, Source>((prev?.sources ?? []).map(s => [s.name, s]));

  // Undo journal: what this run installs + the prior content of anything it overwrites.
  // Populated as actions apply; written as one per-run record after writeState.
  const installed: UndoEntry[] = [];

  // skills
  const onDisk: Record<string, string | undefined> = {};
  for (const s of payload.skills) onDisk[s.name] = currentSkillHash(s.name);
  for (const s of prev?.skills ?? []) if (!(s.name in onDisk)) onDisk[s.name] = currentSkillHash(s.name);
  for (const action of planSkills(payload, prev, onDisk, opts)) {
    if (action.kind === "skip-foreign" || action.kind === "skip-modified") { summary.skipped.push({ item: `skill ${action.name}`, reason: action.reason }); continue; }
    if (action.kind === "noop") continue;
    // Capture prior on-disk files BEFORE an overwrite/removal so undo can restore them.
    const priorFiles = (action.kind === "update" || action.kind === "remove") ? currentSkillFiles(action.name) : undefined;
    try {
      applySkillAction(action, payload, { dryRun: opts.dryRun });
      if (!opts.dryRun) {
        if (action.kind === "remove") skillHashes.delete(action.name); else skillHashes.set(action.name, payloadSkillHash.get(action.name)!);
        // installedHash = what we left on disk (payload hash for install/update; "" for a removal).
        const installedHash = action.kind === "remove" ? "" : payloadSkillHash.get(action.name)!;
        installed.push({ kind: "skill", name: action.name, installedHash, ...(priorFiles ? { priorFiles } : {}) });
      }
      summary.successes.push(`skill ${action.name} (${action.kind})`);
    } catch { summary.failures.push({ item: `skill ${action.name}`, error: "write failed" }); }
  }

  // sources
  const view = gatherClaudeView(payload); // read-only; safe in dryRun
  for (const action of planSources(payload, prev, view, opts)) {
    if (action.kind === "skip-foreign") { summary.skipped.push({ item: action.name, reason: action.reason }); continue; }
    if (action.kind === "noop") continue;
    const results = applySourceAction(action, { dryRun: opts.dryRun });
    const failed = results.find(r => r.code !== 0);
    const label = sourceActionLabel(action);
    if (failed) { summary.failures.push({ item: label, error: `command failed (exit ${failed.code})` }); continue; } // no secrets: never include stderr
    summary.successes.push(label);
    if (!opts.dryRun) {
      switch (action.kind) {
        case "marketplace-add":
          marketplaces.set(action.marketplace.name, action.marketplace);
          installed.push({ kind: "marketplace", name: action.marketplace.name, source: action.marketplace.source, wasAddedByUs: true });
          break;
        case "marketplace-prune": marketplaces.delete(action.marketplace.name); break;
        case "plugin-install":
          sources.set(action.source.name, action.source);
          installed.push({ kind: "plugin", name: action.source.name, plugin: action.source.plugin, marketplace: action.source.marketplace, wasInstalledByUs: true });
          break;
        case "plugin-update": sources.set(action.source.name, action.source); break; // already ours from a prior run — not a new install
        case "mcp-add":
          sources.set(action.source.name, action.source);
          installed.push({ kind: "mcp", name: action.source.name, transport: action.source.transport, url: action.source.url });
          break;
        case "mcp-replace": {
          const before = prevSources.get(action.source.name) as McpSource | undefined;
          sources.set(action.source.name, action.source);
          installed.push({
            kind: "mcp", name: action.source.name, transport: action.source.transport, url: action.source.url,
            ...(before ? { prior: { transport: before.transport, url: before.url } } : {}),
          });
          break;
        }
        case "plugin-uninstall": case "mcp-remove": sources.delete(action.source.name); break;
      }
    }
  }

  if (!opts.dryRun) {
    const now = new Date().toISOString();
    writeState({
      stateSchemaVersion: CURRENT_STATE_SCHEMA_VERSION,
      migrationLevel: mig.level,
      version: payload.version,
      installedAt: prev?.installedAt || now,
      updatedAt: now,
      skills: [...skillHashes].map(([name, hash]) => ({ name, hash })),
      marketplaces: [...marketplaces.values()],
      sources: [...sources.values()],
    });
    // Journal this run so `ner-jarvis undo` can reverse exactly what it did.
    // `setup` may pass a runId (so it can append a global-note entry afterward);
    // the `update` path lets converge generate its own.
    if (installed.length) {
      const command = opts.command ?? "setup";
      // Version delegation target (docs/adr/0004): when this run bumps the installed
      // version, snapshot the binary that made it so a future `undo` delegates rollback
      // to it. Binary channel → archived exe path; npm channel → the pinned version for
      // `npx ner-jarvis@<version>` (archiveCurrentBinary returns null there).
      const versionChanged = prev?.version !== payload.version;
      const binaryPath = versionChanged ? archiveCurrentBinary(payload.version) : null;
      const meta = binaryPath ? { binaryPath } : versionChanged ? { npxVersion: payload.version } : {};
      writeUndoRecord({
        undoSchemaVersion: CURRENT_UNDO_SCHEMA_VERSION,
        runId: opts.runId ?? makeRunId(command, new Date(now)),
        version: payload.version,
        command,
        createdAt: now,
        installed,
      }, meta);
    }
  }
  return summary;
}

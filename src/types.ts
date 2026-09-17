export interface Marketplace {
  name: string;
  source: string;
}

export interface PluginSource {
  name: string;
  type: "plugin";
  marketplace: string;
  plugin: string;
}

export interface McpSource {
  name: string;
  type: "mcp";
  transport: "http" | "sse";
  url: string;
}

export type Source = PluginSource | McpSource;

export interface EmbeddedSkill {
  name: string;
  files: { path: string; contents: string }[];
}

export interface Workspace {
  repo: string;    // git URL to clone (non-secret)
  dirName: string; // directory name to clone into under the chosen base dir
}

export interface EmbeddedPayload {
  version: string;
  skills: EmbeddedSkill[];
  marketplaces: Marketplace[];
  sources: Source[];
  workspace?: Workspace; // optional: a repo to clone + open in Claude Code during setup
}

// loader returns the validated embedded payload
export type Payload = EmbeddedPayload;

export interface SkillState { name: string; hash: string; }
export interface State {
  stateSchemaVersion: number;            // CURRENT = 1
  migrationLevel: number;                // monotonic env-migration level applied to this install
  version: string;
  installedAt: string; updatedAt: string;
  skills: SkillState[];
  marketplaces: Marketplace[];
  sources: Source[];
}

export type SkillAction =
  | { kind: "install" | "update" | "remove"; name: string }
  | { kind: "skip-foreign" | "skip-modified"; name: string; reason: string }
  | { kind: "noop"; name: string };
export interface ReconcileOpts { targets?: string[]; force: boolean; full: boolean; }

export type SourceAction =
  | { kind: "marketplace-add"; marketplace: Marketplace }
  | { kind: "plugin-install" | "plugin-update" | "plugin-uninstall"; source: PluginSource }
  | { kind: "mcp-add" | "mcp-replace" | "mcp-remove"; source: McpSource }
  | { kind: "marketplace-prune"; marketplace: Marketplace }
  | { kind: "skip-foreign"; name: string; reason: string }
  | { kind: "noop"; name: string };

/** What the live system currently shows, gathered read-only before planning. */
export interface ClaudeView {
  installedPlugins: { name: string; marketplace?: string }[]; // from `claude plugin list --json` (name = bare plugin name)
  presentMcp: Record<string, { transport?: string; url?: string } | undefined>; // from `claude mcp get`
}

export interface ParsedArgs {
  command: "setup" | "update" | "doctor" | "uninstall" | "undo" | "roster" | "stale" | "version" | "help";
  targets: string[]; force: boolean; dryRun: boolean; yes: boolean; list: boolean;
  json: boolean;
  /** Free-form `--key=value` / bare `--key` flags, for commands that need values. */
  options: Record<string, string>;
}

// --- Undo journal --------------------------------------------------------
// Every setup/update writes one UndoRecord (what it installed + where, plus the
// prior content of anything it overwrote) and appends an index entry. Rollback
// walks the record and reverses each entry. No secrets — footprint + shipped
// skill content only (the global-note entry carries no body; reversal strips
// the marker block). See docs/adr/0004.

/** A file's path (relative to its skill dir) + contents — used to restore an overwritten skill. */
export type FileBlob = { path: string; contents: string };

export type UndoEntry =
  | { kind: "skill"; name: string; installedHash: string; priorFiles?: FileBlob[] }
  | { kind: "plugin"; name: string; plugin: string; marketplace: string; wasInstalledByUs: boolean }
  | { kind: "mcp"; name: string; transport: "http" | "sse"; url: string; prior?: { transport: "http" | "sse"; url: string } }
  | { kind: "marketplace"; name: string; source: string; wasAddedByUs: boolean }
  | { kind: "global-note" };

export interface UndoRecord {
  undoSchemaVersion: number;   // CURRENT = 1
  runId: string;
  version: string;
  command: "setup" | "update";
  createdAt: string;
  installed: UndoEntry[];
}

export interface UndoIndexEntry {
  runId: string;
  version: string;
  command: string;
  createdAt: string;
  recordPath: string;          // relative to undoDir()
  undone?: boolean;
  binaryPath?: string;         // Phase 3: archived binary that made this run
  npxVersion?: string;         // Phase 3: pinned npm version that made this run
}

export interface UndoIndex {
  indexSchemaVersion: number;  // CURRENT = 1
  entries: UndoIndexEntry[];
}

// --- Stale-doc reports ---------------------------------------------------
// A member's record of a doc that misled them. Local-first: the file never leaves
// the machine unless they run `stale export`. See core/stale.ts for the definition
// of "stale" (relational, not chronological) and docs/onboarding-staleness.md for
// the 8-dimension rubric the `dimension` field indexes.

/** Where the misleading content lives. */
export type StaleTargetKind = "confluence" | "github" | "slack" | "repo" | "skill" | "other";

/**
 * How badly it misleads. A purely historical record is neither of these — it reads as
 * past, so it is not stale and is never recorded.
 */
export type StaleVerdict = "orphan-current" | "superseded";

/** Set once a report has been handed off to a sink (Phase 1: copy-paste to Slack). */
export type StaleSent = { sink: string; at: string; ref?: string };

export interface StaleReport {
  staleSchemaVersion: number;
  id: string;
  ts: string;
  toolVersion: string;
  verdict: StaleVerdict;
  /** 1-8, indexing the rubric in docs/onboarding-staleness.md. */
  dimension: number;
  target: { kind: StaleTargetKind; url: string; title: string };
  /** The newer page that supersedes this one. Only meaningful when verdict is "superseded". */
  successor?: string;
  whatIsWrong: string;
  whatIsTrue?: string;
  /** The member could not proceed. Triage signal, distinct from how wrong the page is. */
  blockedMe?: boolean;
  /** Local git user.name — never an email address. */
  reporter: string;
  sent: StaleSent | null;
}

# ner-jarvis — behavior contract

Language-agnostic behavior contract for `ner-jarvis`. The design spec is
`docs/superpowers/specs/2026-06-28-ner-jarvis-cli-design.md`; the implementation
plan is `docs/superpowers/plans/2026-06-28-ner-jarvis.md`.

This file records the **verified `claude` CLI surface** the tool depends on and
the **source facts** it ships, followed by ner-jarvis's own contract: its command
surface, the setup wizard steps, the state shape, reconciliation rules, and exit
codes. A conforming re-implementation in any language should behave as described
here.

## Supported platforms

macOS, Linux, and **Windows** — all three are first-class: CI tests every commit on
`ubuntu-latest`, `macos-latest`, and `windows-latest`, and `release.yml` ships
`bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-x64`, `bun-linux-arm64`, and
`bun-windows-x64`. Implementations must not assume POSIX path separators, and must not
assume a command string can be split on plain spaces — Windows paths routinely contain
them (see `baseCmd`, which honors `"quoted segments"`).

## Verified `claude` CLI surface

Verified against **Claude Code `claude` v2.1.201** (2026-07-06) via `--help`.

### MCP (`claude mcp …`)

- `claude mcp add [options] <name> <commandOrUrl> [args...]`
  - `-t, --transport <stdio|sse|http>` — default **stdio**; remote HTTP servers
    require an explicit `--transport http`.
  - `-s, --scope <local|user|project>` — default **local**; ner-jarvis uses
    `--scope user`.
  - also `-H/--header`, `-e/--env`, `--client-id`, `--client-secret`,
    `--callback-port` (unused by ner-jarvis — auth is the user's via OAuth).
  - **ner-jarvis runs:** `claude mcp add --transport <transport> <name> <url> --scope user`
- `claude mcp get <name>` — details for one server. **No `--json`.** Unapproved
  `.mcp.json` servers show as `⏸ Pending approval`; approved servers are
  health-checked. → `doctor` uses a zero/non-zero exit as the presence probe.
- `claude mcp list` — one line per server + connection health. **No `--json`.**
  → `doctor` parses this text best-effort.
- `claude mcp remove [options] <name>` — supports `--scope`.
  - **ner-jarvis runs:** `claude mcp remove <name> --scope user`
- `claude mcp login <name>` — **exists**: authenticate with an HTTP/SSE/connector
  server (OAuth). Setup's guide-auth step can point users at
  `claude mcp login <name>` (or the in-app `/mcp`).
- `claude mcp logout <name>` — clears stored OAuth credentials.

### Plugins (`claude plugin …`)

- `claude plugin marketplace add <source>` — `<source>` is a URL, a path, or a
  GitHub `owner/repo`.
  - **ner-jarvis runs:** `claude plugin marketplace add anthropics/claude-plugins-official`
  - also `marketplace list | remove <name> | update [name]`.
- `claude plugin install <plugin>` — "use `plugin@marketplace` for a specific
  marketplace".
  - **ner-jarvis runs:** `claude plugin install slack@claude-plugins-official`
- `claude plugin update <plugin>` — restart required to apply.
- `claude plugin uninstall <plugin>` (alias `remove`).
- `claude plugin list [--json] [--available]` — **`--json` exists** (machine
  readable). → `doctor`'s plugin-presence check parses this.

### Status markers (verbatim, for best-effort parsing)

- `⏸ Pending approval` — an unapproved `.mcp.json` server (not connected).
- `mcp get` / `mcp list` health-check approved servers; capture the exact
  connected/failed (✓/✗) wording live in `doctor` and degrade to "open Claude
  Code and run `/mcp` to confirm" when the parse is inconclusive.
- **`! Needs authentication` (a `plugin:<mp>:<name>` line in `claude mcp list`)** —
  the server is installed but the user hasn't finished OAuth. `doctor` treats this
  as an **auth gap** for plugin sources: it reports "installed but not authenticated
  — run `/mcp`", never "not installed" / a reinstall. Only a server **absent** from
  `mcp list` *and* from `plugin list` is reported as not-installed (→ `ner-jarvis
  setup <name>`). OAuth tokens are stored per endpoint and survive reinstall, so a
  reinstall can't close an auth gap — `/mcp` does.

## Source facts (what `sources.json` ships)

The sources ner-jarvis connects are both marketplace plugins; **GitHub is accessed
via the `gh` CLI, not a connected source**:

| source | mechanism | details |
|---|---|---|
| slack | `plugin` | `slack@claude-plugins-official` — marketplace source `anthropics/claude-plugins-official` |
| atlassian | `plugin` | `atlassian@claude-plugins-official` — bundles the Atlassian MCP (`https://mcp.atlassian.com/v1/mcp/authv2`) plus Atlassian's Jira/Confluence skills |

**GitHub** is deliberately *not* in `sources.json`. Claude Code has a shell, and `gh`
(via `gh api`) is more capable than the GitHub MCP for what the skills need — READMEs,
recent committers, CODEOWNERS, code/commit search, issues/PRs — and uses the user's
own `gh auth`. ner-jarvis doesn't install or authenticate `gh` (a system tool + the
user's OAuth); it **checks** it and **guides** (`gh auth login`), like it does for
`git`. The `mcp` source type stays supported and unit-tested for future sources,
though none currently ship. `sources.json` holds only non-secret references; plugin
sources (slack, atlassian) authenticate on first use.

## Command surface

- `ner-jarvis [setup] [name…]` — the default command. Installs the NER skills,
  connects the sources, and (on a full, interactive run) offers a one-line note for
  the user's global `~/.claude/CLAUDE.md`, clones the NER workspace, and opens Claude
  Code in it. **Interactive by default on a TTY**: it confirms each step (see "Setup
  wizard"). With `name…` it operates only on those skills/sources (targeted) and
  skips the global-context and workspace steps. Idempotent and non-destructive.
- `ner-jarvis update [name…]` — re-applies the latest embedded payload, reusing the
  same convergence engine as `setup`. Non-interactive. On the binary channel it
  *reports* a newer release if one exists but never rewrites the running executable
  (auto-replace is deferred).
- `ner-jarvis doctor [name…]` — read-only health check; exits non-zero if any
  tracked skill/source is missing, not installed, or **installed but not
  authenticated** (for plugin sources it reads the MCP server's auth state from
  `claude mcp list`, pointing an auth gap at `/mcp` rather than a reinstall).
- `ner-jarvis uninstall [name…]` — removes only what ner-jarvis installed.
  **Interactive by default on a TTY** (the same three modes as `setup`): it confirms
  each removal — the skills as a group, **each source individually** (so a plugin
  like Slack/Atlassian you use outside NER can be kept), and the global note — with
  **Enter = yes → remove**, `n` = keep. `--yes` removes everything unattended;
  non-TTY/minimal removes everything tracked without prompts. Declined items stay
  tracked. A full uninstall also strips the global-context note from
  `~/.claude/CLAUDE.md` and clears the undo journal + archived binaries (see "Undo
  journal"); the decision log is kept.
- `ner-jarvis undo [--list]` — reverse a recorded run (see "Undo journal"). With no
  flags it reverses the **most recent** not-yet-undone run: **interactive by default
  on a TTY** (the same three modes as `setup`), confirming each recorded item
  (**Enter = yes → undo**, `n` = keep); `--yes` reverses every item unattended;
  non-TTY/minimal reverses everything without prompts. A run is marked `undone` only
  when *all* its items are reversed — a declined/skipped item leaves the run tracked
  so a later `undo` can finish it. Skills are hash-guarded (an item edited since the
  run is left in place unless `--force`); shared marketplaces are never removed; the
  global note is reversed by stripping its marker block. `--list` just prints the
  recorded run stack and changes nothing. `--dry-run` previews and reverses nothing.
  **Per-version rollback:** a run made by the *current* binary version is reversed
  in-process; a run recorded by a *different* version is **delegated** to the binary
  that made it — the archived per-version executable (binary channel) or
  `npx ner-jarvis@<version>` (npm channel) — so the current binary never has to
  understand an old version's undo logic (see "Per-version archival & delegation").
- `ner-jarvis stale [add|list|export|rm]` — record and review NER docs that misled
  the member. **Local-only**: reports append to `~/.claude/ner-jarvis/stale.jsonl`
  and are never transmitted; `export` renders paste-ready markdown that the member
  shares themselves. Verbs: `add` (flags below; interactive on a TTY for anything
  missing), `list [--unsent]`, `export [--unsent] [--mark-sent]`, `rm <id>`. All
  accept `--json`. Exits non-zero when a report can't be built or an id is unknown.
  - `add` flags: `--url` (required), `--title`, `--kind` (`confluence|github|slack|
    repo|skill|other`), `--wrong` (required — a bare link is rejected), `--true`,
    `--dimension` (1–8, the rubric in `docs/onboarding-staleness.md`; out-of-range
    falls back to 3), `--successor`, `--verdict`, `--blocked`.
  - **Verdict is inferred from the successor check** unless `--verdict` overrides:
    a supplied `--successor` means `superseded`, its absence means `orphan-current`.
    Purely historical content is not stale and is never recorded — see "Stale-doc
    reports" below.
- Flags: `--yes`/`-y` (assume "yes" to every prompt — a non-interactive full run),
  `--force` (overwrite items we installed but the user has since edited),
  `--dry-run` (preview; write nothing), `--list` (`undo`: list recorded runs instead
  of reversing one), `--version`, `--help`.

## Setup wizard (sequence)

`setup` runs in one of three modes:

- **Interactive** (default when stdin is a TTY and `--yes` is absent) — confirms
  **each step** before doing it. A prompt takes **Enter = yes** (the default) or
  **`n` = no/skip** (`y`/`yes`/`no` also accepted; any other input re-asks).
  Declining a step skips exactly that step, so the prompts double as "choose what
  gets installed."
- **Assume-yes** (`--yes`/`-y`) — auto-answers yes to every step (including the
  global-context note and workspace clone + open); no prompts. A full unattended run.
- **Non-interactive minimal** (no TTY and no `--yes`, e.g. CI or a pipe) — installs
  skills + connects sources exactly as the legacy flow did and **skips the
  global-context, workspace clone, and open steps** (never edit the user's global
  CLAUDE.md, clone into an arbitrary CWD, or launch an interactive REPL unattended).

Steps (each gated by a confirm in interactive mode; auto-yes under `--yes`):

1. **Preflight** — require `claude` and `git` on PATH and `~/.claude` writable;
   stop with a non-zero exit and guidance on failure. Not prompted.
2. **Install skills** — "Install N NER skills into `~/.claude/skills/`?" → copy each
   embedded skill dir and record a content hash. One confirm for the whole set.
   Non-destructive (see reconciliation).
3. **Connect each source** — one confirm per source ("Connect `<name>` (`<type>`)?"):
   `plugin` → `claude plugin marketplace add <source>` then
   `claude plugin install <plugin>@<marketplace>`; `mcp` →
   `claude mcp add --transport <t> <name> <url> --scope user`.
4. **Offer the global context note** (full run only) — "Add a line to your global
   `~/.claude/CLAUDE.md` so Claude reaches for the NER skills?" → on yes, ensure a
   marker-delimited block (`<!-- ner-jarvis:begin -->` … `<!-- ner-jarvis:end -->`)
   holding one sentence on *when* to reach for the skills. **Append-only** w.r.t. the
   user's own instructions (never rewrites them) and **convergent**: appends when
   absent, and when the markers are already present it **diffs the content** — a no-op
   ("already present") if it matches the current note, or an in-place **refresh** (same
   position, surrounding text intact) if a version bump has left it stale. Creates the
   file if absent; removed on a full `uninstall`.
5. **Clone the workspace** (full run only; requires `payload.workspace`) — "Clone
   `<repo>` — where to?" The answer is a **path, or Enter for the current working
   directory**; the repo is cloned into `<dir>/<dirName>` (git's normal behavior).
   If that target already exists, stop and report rather than clobber.
6. **Open Claude Code** (full run only, after a successful clone) — "Open Claude
   Code there?" → launch `claude` with its working directory set to the freshly
   cloned repo.
7. **Guide auth** — the tool cannot perform OAuth; it prints the exact next step:
   plugin sources (slack, atlassian) prompt on first use; any `mcp` source uses
   `claude mcp login <name>` or `/mcp`; **GitHub uses the `gh` CLI** — it checks `gh`
   and, if it's missing or logged out, guides installing it + `gh auth login`.
8. **Record state** (see below), **write an undo record** (see "Undo journal"), and
   **append the decision log** (see "Decision log"). State records only
   skills/sources — never the workspace or the global note; the undo record also
   captures the global note (as a bodiless `global-note` item) and the prior content
   of anything overwritten.

Targeting (`setup <name…>`) scopes to the named skills/sources and **never** runs
the global-context, workspace clone, or open steps.

## State file

Path: `~/.claude/ner-jarvis/state.json`. Shape:

```
{
  stateSchemaVersion: 1,
  migrationLevel: 1,
  version,
  installedAt,
  updatedAt,
  skills: [{ name, hash }],
  marketplaces: [{ name, source }],
  sources: [ PluginSource | McpSource ]
}
```

where `PluginSource = { name, type: "plugin", marketplace, plugin }` and
`McpSource = { name, type: "mcp", transport, url }`. It records exactly what
ner-jarvis added, so reconciliation and uninstall only ever touch our own
additions. `stateSchemaVersion` versions the file *format* independently of the
payload `version`; `migrationLevel` is a monotonic count of the *environment*
migrations that have been applied to this install (see below).

## Versioning & migrations

Every persisted shape is versioned, and structural change is migration-governed —
a schema-snapshot guard test (`test/schema-guard.test.ts`, comparing against
`test/schema/golden.json`) fails CI if any persisted shape changes without a
version bump plus an added, fixtured migration. There are two independent ladders:

- **Schema migrations (pure, at read).** `stateSchemaVersion` numbers the
  `state.json` *format*. `readState` applies an ordered chain of pure transforms
  (`state.ts` `SCHEMA_MIGRATIONS`, indexed by from-version) to reshape any older
  parsed object up to the current version, then normalizes. No filesystem, no
  side effects — safe to run on every read.
- **Environment migrations (side-effecting, in `converge` only).**
  `migrationLevel` numbers the on-*disk*/environment state. An ordered ladder
  (`migrations.ts` `ENV_MIGRATIONS`) runs only under `setup`/`update` (inside
  `converge`, honoring `--dry-run`), applies each migration whose level exceeds
  the recorded `migrationLevel`, and `converge` then stamps the new level into
  state. Migration #1 (`legacy-layout`) relocates the pre-0.x loose dotfiles
  (`~/.claude/.ner-jarvis.json` / `.ner-jarvis.log`) into `~/.claude/ner-jarvis/`.

**`readState` and `doctor` are read-only.** Environment migrations never run in a
read path, so `doctor` reads a pre-0.x loose dotfile *in place* and never
relocates it or writes `state.json`; only `setup`/`update` perform the relocation.

ner-jarvis keeps its own files under `~/.claude/ner-jarvis/` (`state.json` above,
`log.jsonl` and `undo/` below, and `versions/<version>/` holding per-version
archived binaries — see "Per-version archival & delegation").

## Decision log

Every `setup` run appends newline-delimited JSON to `~/.claude/ner-jarvis/log.jsonl`
(one object per line) for later debugging. Each record is timestamped and captures
either a prompt/answer or a step outcome — the run's mode, each step's question and
the Enter/`n` answer (or the auto-yes), the chosen clone path, and per-step
success/skip/failure. **No secrets are ever written** — no tokens, no `claude`
stdout/stderr — consistent with the auth rule. The log is append-only and is never
read back by the tool; it is purely a human/debug artifact, separate from the state
file.

## Stale-doc reports

`~/.claude/ner-jarvis/stale.jsonl` — newline-delimited JSON, one report per line,
schema-versioned (`staleSchemaVersion`) under the same migration guard as every other
persisted shape. Distinct from the decision log, which is spec'd append-only and never
read back; these are read, listed, exported, and marked sent.

**Definition.** Staleness is relational, not chronological: a page is stale iff (a) a
reader could mistake it for current — nothing in its title, location, or surroundings
marks it superseded — and (b) acting on it would be wrong. Two verdicts are recorded:
`orphan-current` (wrong, no findable successor — a member will follow it) and
`superseded` (wrong, but a newer version is discoverable). Content that reads as a
record of the past is *historical*, not stale, and is never recorded.

**Privacy.** URL and title only — never page bodies, which may sit behind a Confluence
restriction while an exported report gets pasted into a public channel. `reporter` is
the local git `user.name`, never an email address. Nothing leaves the machine without
an explicit `export`. A full `uninstall` deletes the file.

**Sinks.** Phase 1 is copy-paste. The record shape is the payload a Slack or FinishLine
sink will carry later; `sent` records which sink took it and when.

## Undo journal

Every `setup`/`update` that changes anything writes one **undo record** to
`~/.claude/ner-jarvis/undo/<runId>.json` and appends a matching entry to a frozen,
append-only index at `~/.claude/ner-jarvis/undo/index.json`. `ner-jarvis undo` reads
the journal to reverse a run precisely (see the command surface). Both shapes are
versioned (`undoSchemaVersion` / `indexSchemaVersion`, currently `1`) and covered by
the schema-snapshot guard, like `state.json`.

- **`runId`** — an ISO timestamp with `:` replaced by `-`, suffixed with the command
  (`…-setup` / `…-update`). `setup` generates it up front so it can append the
  global-note item after the note is actually added; `update` lets `converge`
  generate one.
- **Record** (`{ undoSchemaVersion, runId, version, command, createdAt, installed }`)
  — `installed` is the list of `UndoEntry` the run applied, plus the **prior content
  of anything it overwrote** so the exact previous state can be restored:
  - `skill` — `{ name, installedHash, priorFiles? }`. `installedHash` is what the run
    left on disk (`""` for a removal); `priorFiles` (present for an overwrite/removal)
    are the pre-change files. Reversal removes the skill (install) or restores
    `priorFiles` (overwrite/removal), **hash-guarded** against `installedHash`.
  - `plugin` — `{ name, plugin, marketplace, wasInstalledByUs }`. Reversed with
    `plugin uninstall` only when we installed it.
  - `mcp` — `{ name, transport, url, prior? }`. Reversal removes it, or replaces it
    back to `prior` when the run had replaced an existing server.
  - `marketplace` — `{ name, source, wasAddedByUs }`. **Tracking-only:** reversal
    never runs `plugin marketplace remove` (same SAFETY rule as `uninstall`).
  - `global-note` — carries **no body** (no CLAUDE.md content is snapshotted);
    reversal strips the marker block via `removeGlobalContext()`. This holds even when
    a run *refreshed* a stale block in place: the region is ner-jarvis's own
    marker-delimited area, so stripping it cleanly reverses both an add and a refresh.
- **Index entry** — `{ runId, version, command, createdAt, recordPath, undone?,
  binaryPath?, npxVersion? }`. `recordPath` is relative to the undo dir; `undone`
  flips true only when a run is fully reversed; `binaryPath`/`npxVersion` record the
  run's per-version delegation target (see below). The index is read best-effort —
  a missing/corrupt index degrades to empty rather than wedging `undo`.

**No secrets** land in the journal — footprint + shipped skill content only.

A **full `uninstall`** (nothing left tracked) clears stale rollback data: it removes
the whole `undo/` journal and any archived `versions/` binaries along with
`state.json`, then tidies `~/.claude/ner-jarvis/` if empty. The append-only decision
log (`log.jsonl`) is intentionally kept. A **partial** uninstall (some items
declined/kept) leaves the journal untouched.

## Per-version archival & delegation

Rollback is performed by the binary that *made* a run, so a newer binary never carries
an obligation to understand an older version's undo logic (see
`docs/adr/0004-versioned-rollback-and-migrations.md`).

- **Archival (binary channel only).** When a `setup`/`update` bumps the installed
  version, the running executable is copied to
  `~/.claude/ner-jarvis/versions/<version>/<binName>` and its path is stored as
  `binaryPath` on the run's index entry. Copies are **deduped** per version (a re-run
  at the same version is a no-op) and cost ~50–100 MB each.
- **npm channel.** Nothing is archived; the index entry instead records
  `npxVersion` = the run's version, and delegation runs `npx -y ner-jarvis@<version>`.
- **Delegation.** `undo` of a foreign-version run spawns the recorded target
  (archived exe or `npx`) as `… undo --runId <id>` with the run's pass-through flags
  (`--yes`/`--dry-run`/`--force`), inheriting stdio so prompts pass through, and maps
  its exit code into the summary; the delegated binary owns its own `undone`
  bookkeeping. **SAFETY:** delegation only ever runs a locally-archived, already-trusted
  binary or a pinned published version — never a freshly-fetched arbitrary artifact.
  A test seam (`NER_JARVIS_SELF_BIN`) overrides the spawn target in tests.
- **GC.** After a version's *last* live (not-yet-undone) run is reversed in-process,
  its archived `versions/<version>/` directory is removed; while any live run for that
  version remains, the binary is kept so `undo` can still delegate to it. A full
  `uninstall` also clears all archived binaries.

## Reconciliation rules

- Reconciliation compares the embedded payload against the recorded state
  (out-of-band user changes aren't auto-detected).
- **Non-destructive by default:** only writes/removes artifacts ner-jarvis created
  and still owns (tracked with a content hash). Never overwrites a skill/source it
  didn't install, and never silently discards user edits — on conflict it skips and
  warns. `--force` overrides; `--dry-run` previews.
- **Targeting:** `setup`/`update`/`doctor` accept `name…`; a targeted run acts only
  on the named items and never removes anything. Removal of payload-dropped items
  happens only on a full, un-targeted `setup`/`update`.
- **Skills:** install missing; update ones we installed whose on-disk hash still
  matches the recorded hash; a full run removes ours that are gone from the payload;
  skip foreign or user-edited (unless `--force`).
- **Sources (by `type`):** plugin → add missing marketplaces, install/update
  plugins, uninstall on full-run drop; mcp → add missing, replace when
  `transport`/`url` differ, remove on full-run drop. Never touches a same-named
  plugin/mcp the tool didn't add (reported, not clobbered).
- **Marketplaces:** added when a plugin source needs one not yet in state.
  **`uninstall` never runs `claude plugin marketplace remove`** — shared/official
  marketplaces (e.g. `claude-plugins-official`) are used by the user's other
  plugins; uninstall only stops *tracking* marketplaces the remaining state no
  longer needs.

## Exit codes

- `0` — success. Skips (foreign / user-edited / noop) are not failures.
- non-zero — a hard error (missing `claude`, unwritable `~/.claude`) exits
  immediately; a run that *completes* but with ≥1 skill/source failure also exits
  non-zero (so CI and the npx path can detect it), after printing a summary.
  Secrets are never printed, even on error.
- `undo` follows the same rule: reversing with no failures exits `0` (a declined or
  hash-guarded item is a skip, not a failure); a failed reversal exits non-zero.
  `undo --list` and "nothing to undo" are `0`.

## Implementation notes (cross-runtime — for re-implementers)

Three non-obvious things a port must handle (found while building the
TypeScript/Bun v1):

- **Home resolution:** resolve the home dir env-first (`$HOME` / `$USERPROFILE`,
  then the OS default). Bun's `os.homedir()` ignores `$HOME` on macOS/Linux while
  Node honors it — resolving env-first keeps both runtimes consistent and lets
  tests redirect `HOME`.
- **Subprocess environment:** pass the current environment explicitly when shelling
  out to `claude`. Bun's `execFileSync` otherwise uses a stale env snapshot taken at
  process start and ignores later `process.env` changes (Node inherits the live
  env).
- **Build-time channel injection (Bun):** use the two-argument form
  `bun build --define NERJ_CHANNEL='"binary"'`. Bun 1.3.2 silently ignores the
  esbuild-style `--define:NAME=value` colon syntax.
- **Delegation spawn:** invoke the archived/pinned binary with inherited stdio
  (`spawnSync(bin, args, { stdio: "inherit", env: process.env })`) so the delegate's
  interactive prompts reach the user, and pass the env explicitly (same Bun caveat as
  above). Return the child's exit status (defaulting to `1` when absent).

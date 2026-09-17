# Versioned rollback via per-version binaries; every persisted schema is migration-governed

ner-jarvis mutates the user's `~/.claude`: it installs skills, connects sources, and
edits the global `CLAUDE.md`. Until now the only way to reverse that was `uninstall`,
which works off the *current* `state.json` — so anything that drifted out of state
(a skill renamed across versions, an artifact a newer binary no longer knows about)
was orphaned, and the binary carried an unbounded obligation to understand every
past version's footprint. We need clean, precise rollback that does **not** grow a
back-compatibility tax on the binary as the tool evolves.

## Decision

**1. Per-run undo journal.** Every `setup`/`update` writes a small, human-legible
undo record to `~/.claude/ner-jarvis/undo/` — a list of *what was installed and where*
(`skill`/`plugin`/`mcp`/`global-note`), plus the prior content of anything it
overwrote. Rollback walks that list and reverses each entry. A frozen top-level
`index.json` maps `runId → { version, recordPath, binaryPath | npxVersion }`.

**2. Version-based rollback.** `ner-jarvis undo` is interactive: it finds the run,
reads which version produced it, and delegates the actual rollback to **that version's
own binary** (run in-process when it's the current version; otherwise the archived
binary on the release channel, or `npx ner-jarvis@<version>` on npm). The binary that
made a change is the binary that reverses it — so a new binary in development never
has to understand an old version's undo logic.

**3. Every persisted schema is versioned and migration-governed.** `state.json`, the
undo `index.json`, each undo record, and the on-disk layout each carry a schema/level
number. Changing any persisted shape **requires** a written, fixtured migration; a
schema-snapshot guard test fails CI if a persisted shape changes without a version
bump + migration. Migrations keep shared files forward-*readable*; the per-version
binary guarantees rollback even if a migration were ever missing or wrong
(belt-and-suspenders). The pre-0.x loose-dotfile relocation (`migrateLegacyLayout`)
becomes migration #1 of the environment ladder.

**4. `readState` is pure; `doctor` is honestly read-only.** The environment ladder
runs only under `setup`/`update` (never inside `readState`), so `doctor` stops
silently moving files on a legacy layout — it reads the legacy location without
relocating it.

## Rejected: a hardcoded "everything ever shipped" manifest

An earlier sketch cleaned up orphans by hardcoding a manifest of every artifact
ner-jarvis had ever shipped and sweeping for strays. The per-run undo record
supersedes it: rollback is *precise* (the run that installed a now-retired skill
recorded it) instead of *guessed*, and there's no central list to keep in sync with
reality. A manifest survives only as an optional fallback for installs that predate
journaling (e.g. a machine set up before this feature existed) — not part of the
core design.

## Trade-offs accepted

- **Disk.** Archiving a Bun standalone binary per version costs ~50–100 MB each.
  Bounded by deduping per distinct version and GC'ing a version's binary once its
  runs are all undone or superseded (≈1 in steady state); npx stores nothing and
  delegates to the pinned registry version.
- **A subprocess-of-self seam.** `undo` may spawn a copy of ner-jarvis (archived
  binary or `npx`), a new pattern with its own test seam (`NER_JARVIS_SELF_BIN`).
  Delegation only ever runs a locally-archived, already-trusted binary or a pinned
  published version — never a freshly-fetched arbitrary artifact.
- **Uniform migration discipline** applies even to per-version-private records that
  their own binary could read unaided. One rule ("every persisted schema is versioned
  + guarded") is simpler to hold in mind than a governed/exempt split.

**When to revisit:** if binary archival proves too heavy in practice, fall back to
"current binary replays a frozen, append-only record schema" (no archived binaries),
accepting a small forward-read compat burden on the record reader.

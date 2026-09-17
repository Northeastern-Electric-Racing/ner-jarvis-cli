# ner-jarvis — Design Spec

> **Historical record — completed.** Kept for the *why*, not the *where*. File
> paths below are pre-migration: this plan was written when the CLI lived in a
> `cli/` subdirectory of `bracyw/ner-onboarding-agent`. It is now the root of
> `Northeastern-Electric-Racing/ner-jarvis-cli`, so read `cli/src/...` as
> `src/...`. Do not "fix" the paths here — that would falsify the record.

**Status:** Draft for review · **Date:** 2026-06-28

## 1. Summary

`ner-jarvis` is a command-line tool that configures **Claude Code** for
Northeastern Electric Racing's software team in one command: it installs NER's
five onboarding skills and connects the three data sources (Atlassian, GitHub,
Slack), then verifies the result. It owns the full lifecycle — install, update,
verify, uninstall — so a member's NER setup is reproducible and trivially
updatable.

Onboarding is the tool's **first capability, not its identity.** The name
("jarvis") and architecture leave room to grow into a broader NER configuration
assistant (git setup, repo cloning, more) without a rewrite.

## 2. Motivation

- **Friction.** Setup today is manual — add three Connectors, upload skills —
  which is slow and error-prone for new members.
- **Reproducibility.** Everyone should end up with the *same* working config.
- **Updates (primary driver).** When skills or sources change, members need a
  one-step way to pull the new config. This is the priority the design
  optimizes for.

## 3. Target & constraints

**Target: Claude Code only (v1).** Claude Desktop is deliberately out of scope:
its skills live server-side (UI upload only) and its data sources are OAuth
Connectors added in-app — neither is scriptable. Claude Code stores skills
(`~/.claude/skills/`) locally and exposes scriptable `claude plugin` and `claude
mcp` commands, so a CLI can drive setup. (See
`docs/adr/0002-manual-connectors-over-mcp-remote.md` and `docs/adr/0003-*`.)

**Hard constraints:**

- **Never touch secrets.** Authentication is the user's. The tool installs source
  plugins and registers source MCP servers; the user completes OAuth on first
  use. No tokens are stored, logged, or committed — and the embedded
  `sources.json` holds only plugin, marketplace, and MCP-endpoint references,
  which are non-secret.
- **Language-swappable.** The implementation language must be replaceable
  cheaply (see §4).
- **Cross-platform:** macOS, Linux, Windows.

## 4. Architecture

The tool is split so the implementation language owns nothing important:

```
ner-jarvis/             # standalone repo (local-only for now)
  .claude/skills/       # the 5 NER SKILL.md dirs — canonical source (data, not code); active in-repo (dogfooded)
  sources.json          # marketplaces + sources to connect (plugin or mcp; no secrets)
  behavior.md           # language-agnostic behavior contract (source of truth)
  cli/                  # the ONLY language-specific part — TypeScript (Bun) for v1
  .github/workflows/    # build binaries + publish npm package
```

**Skills vs. sources, and two source mechanisms.** NER's *own* content (the
skills) is always copied directly into `~/.claude/skills/`. Each *source* is
wired by whichever Claude Code mechanism fits, declared per-entry in
`sources.json` via a `type` field:

- **`plugin`** → install an existing plugin (`claude plugin marketplace add` +
  `claude plugin install`). Preferred when a maintained plugin exists, because we
  don't then own/maintain the MCP endpoint URL.
- **`mcp`** → register a remote MCP server directly (`claude mcp add`). Used when
  a source has no installable plugin.

The tool supports **both** and dispatches per entry; it never authors or hosts a
plugin or marketplace itself — it only installs ones that already exist. This is
why "the product is a CLI, not a plugin" and "use plugins for the sources" are
both true at once.

1. **Spec is the contract.** Behavior — commands, steps, state format, the exact
   external commands run — is defined language-independently. Swapping language
   = re-implementing `cli/` against the behavior contract (`behavior.md`).
2. **Payload is data.** Skills and the `sources.json` manifest are plain files,
   shared by any implementation and embedded into the binary at build time. A
   build of version X always carries the same payload → "everyone on vX has
   identical config." `sources.json` references marketplaces, plugins, and MCP
   endpoints only; it must never contain tokens, headers, or client secrets.
3. **`cli/` is a thin orchestrator.** It shells out (`claude …`, `git …`), copies
   files, and tracks state. No language-specific cleverness.

**Implementation language (v1): TypeScript, compiled to a binary via Bun.**
Rationale: satisfies the binary requirement (`bun build --compile`) *and* yields
an npm/npx channel for free; it is Application Software's house language (widest
maintainer pool); fastest to iterate on a thin orchestrator. The spec+payload
split keeps a later switch (e.g., to Rust) cheap.

## 5. Distribution

Two channels, one version number:

- **Single binary via GitHub Releases (primary).** Download one file (or one
  `curl` line) and run — no runtime required. Bun cross-compiles for macOS
  (arm64/x64), Linux (x64/arm64), and Windows (x64). *Note:* an unsigned macOS
  binary triggers a one-time Gatekeeper prompt unless notarized (Apple Developer
  account); accepted for v1.
- **npm / npx (secondary).** `npx ner-jarvis@latest` for members who have Node.
  Sidesteps the Gatekeeper prompt and gives the cleanest update path.

Versioning is semver; a release **is** a config version. Reproducibility = pin to
a release.

## 6. Command surface

- `ner-jarvis` / `ner-jarvis setup [name…]` — the setup wizard (default). With no
  arguments it sets up everything (skills + every source); given one or more
  `name`s (a skill or source from the payload) it sets up **only those**, so a
  member can add just Slack later or reinstall one skill without re-running the
  whole thing. Idempotent and **non-destructive** (§9): it never overwrites a
  skill or source it didn't install, nor one you've edited since — `--force` opts
  into overwriting, `--dry-run` previews every change and writes nothing. A
  targeted run touches only the named items and removes nothing.
- `ner-jarvis update [name…]` — re-apply the latest payload: refresh the copied
  skills and bring every source (or only the named ones) to its declared state —
  install/update plugin sources (`claude plugin update`) and add/replace MCP
  sources — per §9, under the same non-destructive rules. On the binary channel,
  first checks for a newer release and (where the OS allows) self-applies it.
- `ner-jarvis doctor [name…]` — read-only health check (optionally scoped to the
  named skills/sources). Confirms each skill directory is
  present under `~/.claude/skills/`; confirms each source is present — `plugin`
  sources via `claude plugin list --json` (machine-readable), `mcp` sources via
  `claude mcp get <name>` (non-zero if absent); and reports each source's MCP
  auth/connection status on a **best-effort** basis by parsing `claude mcp list`
  (the `claude` CLI has no machine-readable mode for it). Degrades to "present;
  open Claude Code and run `/mcp` to confirm auth" when that parse is
  inconclusive. Suggests fixes for anything missing or unauthenticated.
- `ner-jarvis uninstall` — remove exactly what the tool installed: its skills
  (honoring the recorded `hash` — leave user-modified ones and warn, mirroring
  §9); for each source, `claude plugin uninstall` (plus pruning any marketplace
  it added that nothing else needs) or `claude mcp remove --scope user`,
  per type; then the state file. Never removes anything the tool didn't add.
- `ner-jarvis --version`, `ner-jarvis --help`. Optional `jarvis` alias.

## 7. The setup wizard (sequence)

> **v2 (see §14).** `setup` is now **interactive by default** on a TTY — it confirms
> each step (Enter = yes, `n` = skip) — and a full run adds two steps: **clone the NER
> workspace** into a chosen directory (Enter = current dir) and **open Claude Code** in
> it. The sequence below is the underlying order; §14 layers the prompts, the two
> workspace steps, and a decision log on top. `--yes` runs it all unattended; a non-TTY
> run without `--yes` keeps exactly the legacy behavior below (no workspace steps).

1. **Preflight.** Require the `claude` CLI on PATH (and `git`); if missing, stop
   with install guidance and a non-zero exit.
2. **Install skills.** Copy the embedded payload's skill directories → `~/.claude/skills/` (user
   scope); record each in state with a content hash. When the run is targeted,
   only the named skills are considered. Skip and warn rather than overwrite if a
   skill already exists that the tool didn't install, or one it installed that
   you've since edited (hash mismatch) — `--force` overrides.
3. **Connect sources.** For each entry in `sources.json` (only the named ones
   when targeted), dispatch by `type` — all idempotent and non-destructive (a
   same-named plugin, marketplace, or MCP server the tool didn't add is left
   untouched and reported, never clobbered):
   - `plugin` → `claude plugin marketplace add <source>` then
     `claude plugin install <plugin>@<marketplace>`.
   - `mcp` → `claude mcp add --transport <transport> <name> <url> --scope user`.

   Both register MCP servers; no secrets touched — auth is step 4.
4. **Guide auth.** Print the exact next move — open `claude`, run `/mcp`,
   authenticate each source (or `claude mcp login <name>`). The tool cannot
   perform OAuth.
5. **Verify.** Run the `doctor` checks (§6): skill dirs present, each source
   present (`claude plugin list --json` / `claude mcp get`), and auth status
   parsed best-effort from `claude mcp list`. Report connected vs. needs-auth.
6. **Record state** (see §8).
7. **Next step.** "Open Claude Code and try the `ner-onboard` skill."

## 8. State

- **Path:** `~/.claude/.ner-jarvis.json`
- **Shape:**
  `{ stateSchemaVersion, version, installedAt, updatedAt, skills: [{ name, hash }], marketplaces: [{ name, source }], sources: [ PluginSource | McpSource ] }`
  - `PluginSource`: `{ name, type: "plugin", plugin, marketplace }`
  - `McpSource`: `{ name, type: "mcp", transport, url }`
  - `stateSchemaVersion` versions this file's own format, distinct from
    `version` (the installed payload/release), so future migrations stay clean.
  - `skills[].hash` is the content hash written at install, used by `update` and
    `uninstall` to detect user-modified skills.
  - `marketplaces` and `sources` record exactly what the tool added, so
    `uninstall` and reconciliation only ever touch our own additions.
- **Purpose:** idempotent re-runs, clean uninstall, update reconciliation, and
  `doctor` input.

## 9. Idempotency, targeting & non-destructive writes

`setup` and `update` both converge the system to the payload (re-running `setup`
behaves the same as `update`). Reconciliation compares the **payload against the
recorded state**; out-of-band changes a user makes outside the tool are not
auto-detected in v1.

**Non-destructive by default.** The tool only writes or removes artifacts it
created and still owns (tracked in state with a content hash). It never
overwrites something it didn't install, and never silently discards your edits to
something it did — on any such conflict it skips and warns. `--force` is the
explicit opt-in override; `--dry-run` reports what would change and writes
nothing.

**Targeting.** `setup`, `update`, and `doctor` accept optional `name…` arguments
naming specific skills or sources. A targeted run operates on only those items
and **never removes anything** — removing payload-dropped items happens only on a
full, un-targeted `setup`/`update`.

- **Skills.** Install skills present in the payload; overwrite only ones the tool
  installed whose on-disk content still matches the recorded `hash`; on a full
  run, remove skills the state shows we installed but that are gone from the
  payload. Never touch a skill the tool didn't install, or one whose hash no
  longer matches (user-modified) — skip and warn unless `--force`.
- **Sources.** Reconcile each by its declared `type`:
  - *plugin* — add marketplaces in the payload missing from state
    (`claude plugin marketplace add`); install missing plugins
    (`claude plugin install`); update installed ones (`claude plugin update`);
    uninstall plugins — and prune marketplaces — that we added but are gone from
    the payload.
  - *mcp* — add missing servers (`claude mcp add`); replace a same-named server
    whose `transport`/`url` differs from state; remove servers we added that are
    gone from the payload.

  In both cases, never touch plugins, marketplaces, or MCP servers the tool
  didn't add (tracked in state); a pre-existing same-named source is reported,
  not clobbered.

## 10. Error handling

- **`claude` CLI missing** → stop with install guidance; non-zero exit (sources
  can't be wired without it).
- **A source command fails** (`claude plugin marketplace add` / `install` /
  `update`, or `claude mcp add`; network or conflict) → record the failure,
  continue with the rest, summarize at the end; state reflects the partial
  result; `doctor` guides recovery.
- **Exit codes.** Hard errors (missing `claude`, unwritable `~/.claude`) exit
  non-zero immediately. A run that *completes but with N skill/source failures*
  also exits non-zero — so CI and the npx update path can detect it — after
  printing a summary of what succeeded and what to retry.
- **No silent failures.** Clear messages on every failure path.
- **Never** print or persist secrets, even on error.

## 11. Testing

- **Unit:** per component — skill-copy + hashing logic, per-type source command
  construction (plugin and mcp), state read/write, the reconciliation diff.
- **Integration:** run the wizard against a temporary `HOME` with a **fake
  `claude` shim** on PATH that records `plugin marketplace add` / `plugin
  install` / `plugin list` / `plugin update` / `plugin uninstall` and `mcp add` /
  `mcp get` / `mcp list` / `mcp remove` invocations and returns canned output —
  exercises the full flow (both source types, plus `doctor`'s `--json` plugin
  check and `mcp list` text parsing) without real Claude Code or auth.
- **Idempotency, targeting & safety:** `setup` twice → no changes on the second
  run; `update` after a payload change → correct install/update/add/replace/
  remove; a targeted `setup <name>` → touches only that item and removes nothing;
  a pre-existing same-named skill/source, or a user-edited skill → skipped with a
  warning (overwritten only under `--force`); `uninstall` → removes only what was
  installed and preserves user-modified skills.
- **CI:** cross-platform build + smoke-test matrix.

## 12. Open questions (resolve at implementation)

- Decide, per source, its delivery `type`: a `plugin` (and its marketplace
  source + plugin id) or a direct `mcp` server (and its endpoint URL +
  transport). Prefer a `plugin` where a maintained one exists; use `mcp`
  otherwise. The `claude plugin …` and `claude mcp add/remove/login` flags are
  confirmed against the installed `claude` CLI.
- Binary self-update mechanics per OS — notably replacing a running `.exe` on
  Windows (fallback: instruct the user to re-download).
- Repo topology (**decided:** standalone repo): ner-jarvis is its own repository,
  local-only for now (`git init`, no GitHub remote yet), living at
  `~/Desktop/ner/app_software/ner-jarvis`. The five skills are transferred into
  `.claude/skills/` at the repo root, which is both the canonical payload source
  the build embeds *and* the project-scoped skill set active in Claude Code when
  developing in the repo (dogfooding). Publishing to a
  `Northeastern-Electric-Racing/ner-jarvis` remote later is a `git remote add` +
  push, not a rebuild.
- macOS: accept the Gatekeeper prompt for v1, or invest in signing/notarization.

## 13. Out of scope (v1) / roadmap

Deferred fast-follows, enabled by the same architecture as additional
orchestration steps:

- git identity setup; cloning the track's work repos (Argos / FinishLine /
  firmware).
- Broader NER dev config; a `jarvis` umbrella with subcommands as scope grows.
- A Claude Desktop "assisted-manual" path (generate ZIPs + print exact UI steps).

## 14. v2 — Interactive setup & workspace clone

v2 makes `setup` a guided, confirm-each-step experience and adds a workspace
bootstrap, **without changing the reconciliation engine (§9)** — the prompts simply
decide which items `converge` is asked to act on.

**Interaction modes.**

- **Interactive** (default when stdin is a TTY and `--yes` is absent): confirm every
  step. A prompt is **Enter = yes** (default) or **`n` = no/skip**; `y`/`yes`/`no`
  are also accepted, and any other input re-asks. Declining a step skips just that
  step — so the confirms are also how a member chooses what to install.
- **Assume-yes** (`--yes`/`-y`): answer yes to everything, no prompts — a full
  unattended run (still clones + opens).
- **Non-interactive minimal** (no TTY, no `--yes`; CI, pipes, the test suite):
  installs skills + connects sources as in v1 and **skips the workspace steps**. This
  keeps `setup` scriptable and preserves existing behavior/CI.

**New steps (full, non-targeted run only).**

- **Clone the workspace.** `sources.json` carries a `workspace` entry
  (`{ repo, dirName }` — non-secret, embedded like the rest of the payload). The
  clone prompt asks for a destination that **defaults to the current working
  directory**: Enter clones into `<cwd>/<dirName>`; a typed path clones into
  `<path>/<dirName>`. If the target already exists, `setup` stops and reports rather
  than overwrite. (v1 workspace repo: the public `bracyw/ner-jarvis`, so any member
  can clone it without a grant.)
- **Open Claude Code.** After a successful clone, launch `claude` with its working
  directory set to the cloned repo, so the member lands in a ready NER workspace.

Both steps run only on a full run; a targeted `setup <name…>` never clones or opens.

**Decision log.** Each `setup` run appends timestamped newline-delimited JSON to
`~/.claude/.ner-jarvis.log`: the mode, every prompt + answer, the chosen clone path,
and each step's outcome. It never records secrets or `claude` output. It is a debug
artifact only — append-only, never read back — and is distinct from the state file
(§8), which still records only skills/sources.

**Testability.** The side-effecting pieces are seams: the prompt reader (a scripted
prompter in tests), the git clone (a local temp repo in tests), and the Claude-Code
launch (the same `NER_JARVIS_CLAUDE_BIN` shim as the rest). No test performs real I/O
against the network or a real `claude`.

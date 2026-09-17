# ner-jarvis

**One command to configure Claude Code for Northeastern Electric Racing.**
`ner-jarvis` installs NER's onboarding skills and connects its data sources
(Atlassian, GitHub, Slack) into your local Claude Code — so a new software-team
member goes from a fresh `~/.claude` to a working setup in a single step.

> A CLI scoped to App Software, made to accelerate onboarding and surface shared
> development bugs quickly. The skills it ships live in this repo's
> [`skills/`](skills/); the CLI embeds them at build time.

## What it installs

Into `~/.claude/skills/`, six NER skills:

| skill | what it does |
|---|---|
| `ner-onboard` | walks a new member through getting started |
| `ner-ask` | answers NER software questions from Confluence + GitHub |
| `ner-setup` | environment / dev-setup help |
| `ner-repo-explainer` | explains what a given NER repo does |
| `ner-escalation-router` | points you at the right owner / channel |
| `ner-flag-stale` | records a doc that misled you, for `ner-jarvis stale` |

And two data sources (both plugins):

| source | mechanism |
|---|---|
| **slack** | plugin (`slack@claude-plugins-official`) |
| **atlassian** | plugin (`atlassian@claude-plugins-official`) |

**GitHub** isn't a connected source — the skills use the **`gh` CLI** (Claude Code
has a shell, and `gh` is more capable for READMEs, commits, CODEOWNERS, and search).
ner-jarvis checks `gh` and guides `gh auth login`; it never installs or authenticates
it for you.

Everything ner-jarvis adds is tracked in `~/.claude/ner-jarvis/state.json`, so it only
ever touches its own additions — it never clobbers skills or sources you added
yourself. State carries a `migrationLevel` alongside `stateSchemaVersion`: every
persisted shape is versioned, and any structural change is migration-governed (a
schema-snapshot guard test fails CI otherwise). Two ladders handle upgrades — pure
schema migrations applied when state is read, and side-effecting environment
migrations run only during `setup`/`update`. `doctor` (like every read) is
read-only and never relocates or rewrites your files. Every `setup`/`update` also
writes a per-run **undo record** (under `~/.claude/ner-jarvis/undo/`) capturing what
it installed and the prior content of anything it overwrote, so `ner-jarvis undo`
can reverse a run precisely — and rollback is always performed by the *version of
ner-jarvis that made the run* (the current binary in-process, or an
archived/pinned older binary via delegation), so the tool can evolve without
carrying a back-compatibility tax.

## Install

No GitHub account, no org membership, and no `gh` needed — the repo and its
release assets are public.

**macOS / Linux:**

```sh
case "$(uname -s)" in Darwin) os=darwin;; Linux) os=linux;; *) echo "unsupported"; exit 1;; esac
case "$(uname -m)" in arm64|aarch64) arch=arm64;; x86_64|amd64) arch=x64;; *) echo "unsupported"; exit 1;; esac
curl -fsSL -o ner-jarvis \
  "https://github.com/Northeastern-Electric-Racing/ner-jarvis-cli/releases/download/v0.1.0/ner-jarvis-bun-$os-$arch"
chmod +x ner-jarvis && ./ner-jarvis
```

To keep it on your `PATH` instead of the current folder, swap the last line for
`mkdir -p ~/.local/bin && mv ner-jarvis ~/.local/bin/ && ner-jarvis`.

**Windows (PowerShell):**

```powershell
Invoke-WebRequest -OutFile ner-jarvis.exe `
  "https://github.com/Northeastern-Electric-Racing/ner-jarvis-cli/releases/download/v0.1.0/ner-jarvis-bun-windows-x64.exe"
.\ner-jarvis.exe
```

Running it with no arguments starts the interactive setup. It prompts before each
step, and `ner-jarvis undo` reverses a run precisely.

**npx** (Node ≥ 18) — *not published yet, see below*:

```sh
npx ner-jarvis@latest
```

### Platforms

| Platform | Asset |
|---|---|
| macOS (Apple Silicon) | `ner-jarvis-bun-darwin-arm64` |
| macOS (Intel) | `ner-jarvis-bun-darwin-x64` |
| Linux x64 | `ner-jarvis-bun-linux-x64` |
| Linux arm64 | `ner-jarvis-bun-linux-arm64` |
| Windows x64 | `ner-jarvis-bun-windows-x64.exe` |

Each is a standalone binary with the skills payload compiled in — no runtime, no
`node_modules`, no network fetch at install time.

### Still to do: npm

`npx ner-jarvis@latest` is the one install path that doesn't work yet. It needs the
`NPM_TOKEN` repository secret set; until then the release's `npm` job builds the
bundle, reports the skip, and stays green. Setting it and re-running that job is all
that's required — the binaries above are unaffected either way.

### Build from source

Build it yourself with [Bun](https://bun.sh):

```sh
bun install
bun run build:binary   # → dist/ner-jarvis   (standalone binary for this host)
# or
bun run build:npm      # → dist/index.js     (Node-runnable bundle)
```

Both build steps embed the skills + sources payload first, so the output is
self-contained.

## Commands

```sh
ner-jarvis                   # setup: install all skills + connect all sources (default)
ner-jarvis setup slack       # targeted: act only on the named skill/source
ner-jarvis update            # re-apply the latest embedded payload
ner-jarvis doctor            # read-only health check (non-zero exit if anything's off)
ner-jarvis uninstall         # remove only what ner-jarvis installed
ner-jarvis undo              # reverse the most recent setup/update run
ner-jarvis undo --list       # show the recorded run stack
```

Useful flags:

```sh
ner-jarvis --dry-run         # preview every change; write nothing
ner-jarvis --force           # overwrite items we installed but you've since edited
ner-jarvis --yes, -y         # run unattended (auto-confirm every step)
```

- **setup** is interactive on a TTY (confirm each step: Enter = yes, `n` = skip),
  idempotent, and non-destructive — safe to re-run. A full run also clones the NER
  workspace into a directory you choose and opens Claude Code there.
- **update** reuses the same convergence engine as setup; on the binary channel it
  *reports* a newer release but never rewrites the running executable.
- **uninstall** is interactive on a TTY too: it confirms each removal — the skills,
  each source (so you can keep a plugin you use outside NER), and the global note —
  with Enter = remove, `n` = keep (`--yes` removes everything unattended). It only
  ever removes ner-jarvis's own additions and never removes shared marketplaces.
- **undo** reverses a recorded run rather than everything ner-jarvis tracks: with no
  flags it undoes the most recent run, interactive on a TTY (Enter = undo, `n` =
  keep; `--yes` reverses everything unattended). It hash-guards edited skills
  (left in place unless `--force`), restores the prior content of anything the run
  overwrote, never removes shared marketplaces, and marks a run done only when fully
  reversed. `undo --list` prints the recorded run stack. A run made by a *different*
  ner-jarvis version is **delegated** to the binary that made it — an archived
  per-version binary, or `npx ner-jarvis@<version>` — so the current binary never
  parses an old version's records. (A full `uninstall` clears the undo journal and
  those archived binaries; the decision log is kept.)
- `name…` (e.g. `slack`, `github`) can be passed to `setup` / `update` / `doctor`
  to scope the run; a targeted run never removes anything.

## Authentication

**ner-jarvis never handles your secrets.** It connects the sources but cannot
perform OAuth for you. After setup, authenticate each yourself:

- **Slack, Atlassian** (plugins) — prompt on first use inside Claude Code.
- **GitHub** — install the [`gh` CLI](https://cli.github.com) and run `gh auth login`.
- Any `mcp` source — `claude mcp login <name>`, or open Claude Code and run `/mcp`.

## Troubleshooting

Run the health check to see what's missing or still needs auth:

```sh
ner-jarvis doctor
ner-jarvis doctor github     # scope the check to one source
```

`doctor` is read-only and exits non-zero if any tracked skill or source is missing
or unhealthy.

## Development

```sh
bun install
bun run embed    # regenerate the embedded payload from skills/ + sources.json
bun test
```

- The NER skills live at [`skills/`](skills/) and are **embedded at
  build time** (via `bun run embed`) — there's no runtime fetch.
- Data sources are declared in [`sources.json`](sources.json).
- [`behavior.md`](behavior.md) is the **language-agnostic contract** — the
  authoritative spec for command surface, wizard steps, state shape,
  reconciliation rules, and exit codes. Read it before porting ner-jarvis to
  another runtime.

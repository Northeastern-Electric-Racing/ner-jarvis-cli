# ner-jarvis-cli — Project Context

You are answering questions for new (and not-so-new) members of **Northeastern
Electric Racing**'s software team. Treat the user as a software-team member who
is onboarding. They are authenticated to NER's GitHub and Confluence as
themselves via the configured MCP servers; only return information they have
permission to see.

## Knowledge sources

- **Confluence space** (`NER`): https://nerdocs.atlassian.net/wiki/spaces/NER
  - Software onboarding root: https://nerdocs.atlassian.net/wiki/spaces/NER/pages/5079215
  - Notable pages referenced from onboarding: Software Contributor Guide,
    Software FAQ, Software Learning Resources, Starter Ticket Instructions.
- **GitHub org**: https://github.com/Northeastern-Electric-Racing

Use the **Atlassian MCP** for Confluence/Jira queries and the **GitHub MCP**
for repos, code, issues, and PRs. Cite sources (page URL or file path + line)
in answers.

## Org & escalation

**Ground org structure in `skills/ner-roster/roster.json`** (asOf **Fall 2026** —
the authoritative source for area → subteam → head/leads; query it directly or via
`ner-jarvis roster heads` / `roster leads <subteam>`). Leadership rotates by
academic year and even the newest Confluence rosters lag reality, so treat the
*people* as a **dated snapshot**: resolve current ownership live (this is exactly
why the shipped skills never hard-code names) and trust a known team member over a
stale page.

The **Software** area (Chief: **Chris Pyle**) has **four** subteams — the skills
optimize for the first three; Simulation comes later:

- **FinishLine** — PM dashboard. Head **Waverly Hassman**.
- **Application Software** — Argos, NERO, data-viz. Head **Wyatt Bracy**.
- **Firmware** — embedded. Head **Caio DaSilva**.
- **Software Product** — product/roadmap, owns no code repo. Head **Layla Sheikh**.

- **Final escalation:** Chief Software **Chris Pyle** (per roster; a stale
  Confluence page still names Peyton McKee — reconcile live if it matters).
- **Sub-leads** (Firmware: Motor Controller / TSECU / VCU / Embedded Validation /
  Controls / MSB / Telemetry; App Software: Argos / NERO / Data Visualization;
  FinishLine: tech leads) live in `roster.json` — read them there and reconcile
  the person live rather than hard-coding a snapshot that rots.
- Slack channels (verified live 2026-09-05 — the workspace changes): `#software`
  (software-wide announcements), `#tech-support` (setup help + repo/tool access —
  **replaced** the now-archived `#software_env-setup` and `#access-requests`),
  `#s_embedded-software` (**both** embedded/firmware **and Application Software**
  development — Argos and NERO work happens here, since `#software_argos` and
  `#software_nero` are archived), `#software_launchpad` (new members, all software
  teams), `#software_finishline` (FinishLine), `#software_pr-review` (FinishLine
  PRs), `#software_product` (Software Product), `#software_product-requests`
  (feature requests for any NER software). A June 2026 plan to rename these to
  `#s_finishline` / `#s_product` / `#tech_support` was **not** carried out — don't
  cite those names. Norm: post publicly, don't DM leads first.

## Repo glossary (the ones members actually touch)

Repos marked **(private)** need org access to see — a GitHub 404 there usually
means a permissions gap, not a missing repo.

**FinishLine — TypeScript, full-stack**
- `FinishLine` — Project-management dashboard (a.k.a. PM Dashboard v5), the main
  PM app. (`PM-Dashboard-v2` and v1 are archived — deliberately not listed here.)

**Application Software — TypeScript / Angular / Flutter, full-stack**
- `Argos` — Real-time data **processing** and visualization (Angular + Flutter +
  `scylla-server` + `charybdis-schema`). `scylla`/`siren` are services, not repos.
- `Nero-2.0` — Vehicle dashboard (C++/Qt/QML). An App-Software system — *not*
  telemetry, despite the language.
- `Ithaca` — Data-visualization for telemetry captures (Python); backs the
  roster's **"Data Visualization"** system (a system name, not a repo).

**Firmware / embedded track — C, FreeRTOS, some Rust**
- `Cerberus`, `Cerberus-2.0` — Vehicle Control Unit firmware (FreeRTOS;
  `Cerberus-2.0` is the 25A VCU).
- `Cerberus-1.5` **(private)** — VCU variant on ThreadX/Azure RTOS (STM32F405).
- `Shepherd-BMS`, `TSECU-Shepherd` — Battery-Management-System firmware.
- `adbms` **(private)** — Proprietary ADBMS battery-monitor driver (6830/2950);
  pulled in as a submodule (e.g. by Shepherd-BMS).
- `MSB-FW`, `MSB-FW-2` — FreeRTOS distributed-sensing boards.
- `ProteusMC` — Custom dual HV motor controller.
- `Lightning` — Lightning-board firmware.
- `Polyphemus` — 24A steering-wheel firmware (STM32F405).
- `nermoni` — STM32F103 ADC board.
- `Embedded-Base` — Shared drivers, middleware, dev tools, used as a submodule
  across the firmware repos above.
- `firmware-rs` — Experimental Rust firmware (not yet on the car).
- `h5-projects-rs` — STM32H5 Rust/Embassy firmware projects.
- `Salamander` — FSAE energy-meter firmware.
- `Pythia` — Embedded-Validation HIL test harness. **Firmware, despite being
  written in TypeScript** — don't shelve it as Application Software.

**Telemetry / data — Rust, Python, Go** *(stack is mid-migration from MQTT to
**Zenoh** — MQTT can now be largely disabled; the "MQTT" labels below are
transitional.)*
- `Calypso` — Configurable CAN-to-MQTT gateway (Rust).
- `Odysseus` — On-car MQTT-based telemetry OS (Buildroot + HaLow WiFi).
- `Odysseus-Daemon` — System-state daemon for Odysseus.
- `Odyssey-Definitions` — CANbus and Automotive-Ethernet packet definitions.
- `Odyssey-Configurations` — Car-system configs for the Odyssey framework
  (25A car onward).
- `ner-penelope-rust`, `ner-penelope-python` — Drivers for NER's data store
  (Rust / Python).
- `Telemetry-Stand` — Trackside telemetry-stand project.
- `mqtt-datasource` — Grafana datasource for MQTT streaming (Go; a fork).
- `mqttui` — Terminal MQTT client/TUI (Rust; a fork), used in telemetry work.

**Simulation / analysis — access varies (re-verify visibility; some private)**
- `NERSim` — Lap simulation (Simulink + Python).
- `NERTire` — Tire-analysis ML notebooks.
- `NERMultibody` — Multi-body FSAE-car simulation (newer; now has activity).
- `NERDIL` — Live driver-in-loop multibody simulation (newer; now has activity).

## How to answer

- **Pick the right source first.** Environment setup, conventions, "where do I
  start?" → Confluence. "What does this code do?" → GitHub. "Who owns X?" →
  both (Confluence for nominal owner; GitHub blame/commits for the most recent
  toucher).
- **Always cite.** Confluence answers should include the page URL; code answers
  should include `repo/path/to/file.ext:line` so the reader can click through.
- **Name names when escalation is needed.** Resolve the current owner live
  (GitHub recent committers + the Confluence roster, dated) and name them; the
  leads above are a snapshot to sanity-check against, not the final word. Don't
  fall back to "ask a senior member."
- **Don't speculate about repos you can't read.** If the user references a repo
  the GitHub MCP returns 404 on, say so and suggest the user check their org
  membership or contact the relevant lead.
- **Stay scoped to software-team questions.** Mechanical / electrical /
  business questions belong with their respective teams; redirect rather than
  guess.

## Agent skills

### Issue tracker

GitHub issues on `Northeastern-Electric-Racing/ner-jarvis-cli` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical names: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## ner-jarvis CLI (installer)

**This repo is the CLI** — `package.json`, `src/`, `scripts/`, and `test/` sit at
the root. **ner-jarvis** is a cross-platform installer that configures Claude Code
for a new NER software member in one command: it installs the six NER skills
into `~/.claude/skills/`, installs the Slack + Atlassian plugins (GitHub is
accessed via the `gh` CLI — checked and guided, never installed by us), then
clones the lean onboarding workspace and opens Claude Code in it. Built with Bun
(`node:` builtins only) into a standalone binary + npx bundle.

- **Payload it ships:** this repo's own `skills/` + `sources.json`, embedded at
  build time via `bun run embed` (regenerates the git-ignored
  `src/payload.generated.ts`). `skills/` is the canonical copy; the repo's
  `.claude/skills/` is an unrelated local dev-skill set, not shipped.
- **Contract:** `behavior.md` is the language-agnostic spec (command surface,
  setup wizard, state file, reconciliation, exit codes) — authoritative.
- **Versioning/undo:** every persisted shape is versioned + migration-governed
  (a schema-snapshot guard fails CI on any un-migrated change); state carries a
  monotonic `migrationLevel`. Every `setup`/`update` writes a per-run **undo
  record** (`~/.claude/ner-jarvis/undo/`) capturing what it installed plus the
  prior content of anything overwritten, and `ner-jarvis undo [--list]` reverses a
  run precisely (hash-guarded, never removes shared marketplaces). Rollback is done
  by the binary that *made* the run: the current version in-process, or a
  **foreign version delegated** to its archived binary
  (`~/.claude/ner-jarvis/versions/<v>/`, binary channel) or `npx ner-jarvis@<v>`
  (npm) — so the current binary never parses an old version's records. Archived
  binaries are GC'd once a version's runs are all undone; a full `uninstall` clears
  the journal + archives (keeping the decision log).
- **Workspace repo:** the CLI clones `bracyw/ner-jarvis` (mostly empty — just a
  `CLAUDE.md`) into a directory the onboardee chooses, as the folder their Claude
  Code runs in. Retargets to `Northeastern-Electric-Racing/ner-jarvis` after the
  eventual org transfer (a `sources.json` URL change).
- **Dev:** `bun install && bun run embed && bun test` (267 tests). See `README.md`.
- **Three repos, don't conflate them:** this repo (the CLI + the `skills/`
  source); `bracyw/ner-jarvis` (**public**, 3 files — the lean workspace the CLI
  *clones onto a member's machine*, not a copy of this repo); and
  `bracyw/ner-onboarding-agent` (**the former home** — v0.1.0's release assets
  still live there, as does the retired Claude-Desktop ZIP pipeline).

# NER Onboarding Agent

> **⚠️ Partly superseded — read with care.** The *Bundle* / *Surface* language below
> describes the original Claude-Desktop-ZIP delivery model. That shipped and was
> replaced: delivery is now the **ner-jarvis CLI** (this repo), which installs
> skills into `~/.claude/skills/` and wires plugins for **Claude Code** — the very
> surface this document calls "not a target surface." The *Onboardee*, *Track*, and
> *Car* entries are still current. Rewrite pending.

The shared language for the onboarding-agent project: an agentic system that helps NER software-team members get answers and orient themselves within the codebase and team. New members are a primary use case but not the only one — general-purpose Skills serve any software-team member day-to-day. The project's first deliverable is a Claude Desktop bundle; later iterations will add parallel bundles for other NER sub-teams.

## Language

**Bundle**:
The umbrella distributable for an NER sub-team. Today: a set of **per-Skill ZIPs** that the user installs into Claude Desktop one at a time via Customize > Skills > "+" > Upload a skill (drag-and-drop). Custom Skills live server-side in the user's Claude account — not in a local directory the Bundle can populate via script — so Anthropic's UI upload is the only sanctioned install path. The Skills depend on Anthropic's native remote MCP **Connectors** (Atlassian and GitHub today, plus Slack for ner-escalation-router; more later), which each user adds manually through Claude Desktop's Settings > Connectors UI. A `/ner-setup` Skill walks any user (new or returning) through Connector setup and points at docs; `/ner-onboard` adds onboarding-specific orientation on top of that. Later: may add an **MCPB file** (`.mcpb` — Anthropic's Desktop Extensions format, formerly DXT) packaging a custom NER MCP server (e.g., the question logger). MCPB covers MCP servers only, not Skills, so a fully-built Bundle is a pair of artifact-sets when an MCPB is present. Each NER sub-team will eventually have its own Bundle.
_Avoid_: extension, plugin, pack, addon

**Software bundle**:
The bundle for NER's software team. This project's v1 deliverable.
_Avoid_: software extension, software pack

**Sub-team bundle**:
A bundle scoped to one NER sub-team (Software, Electrical, Mechanical). The design assumes parallel sub-team bundles rather than one omnibus bundle, so each sub-team can carry its own Skills, prompts, and knowledge sources.
_Avoid_: team package, team kit

**Surface**:
The runtime where a Bundle is invoked. Claude Desktop is the primary surface and, for v1's audience, effectively the *only* one: NU's institutional Claude accounts allow native Connectors on Desktop but not on the web/mobile clients. Skills uploaded via Desktop's Customize > Skills sync to the user's Anthropic account and therefore also appear in claude.ai (web) for the same user — but the Connectors they depend on remain Desktop-only, so the practical Surface is Claude Desktop. The Atlassian, GitHub, and Slack MCPs are added via Claude Desktop's native **Connectors** UI (Settings > Connectors > Add custom connector); Anthropic exposes no automation hook for this, so the Bundle accepts manual click-through and uses a `/ner-setup` Skill to guide users through it. Goose Desktop is the planned secondary surface, but only the MCPB half of a future Bundle would port cleanly — Goose has no native Skills concept. Claude Code is not a target surface, but users comfortable with it can adopt the same Skills from the repo (Claude Code reads `~/.claude/skills/`).
_Avoid_: client, host, runtime (when referring to Desktop apps specifically — "runtime" is fine for the broader concept)

**Onboardee**:
A new NER software-team member working through their first contributions. Target persona for the Bundle's *onboarding-specific* Skills (e.g., `ner-onboard`) — not the only user of the Bundle. General-purpose Skills (`ner-ask`, `ner-repo-explainer`, `ner-escalation-router`) serve any software-team member, returning or new.
_Avoid_: new member (ambiguous with non-software NER members), user (too generic), newcomer

**Track**:
One of NER software's delivery Tracks (called *sub-teams* in GitHub and some Confluence docs). The four current Tracks are **Firmware**, **Application Software**, **FinishLine**, and **Simulation**. Firmware and Application Software together form *Embedded Software*, co-owned with the Electrical team — though 2026 strategy docs sometimes treat them as four parallel Tracks. v1 of the Software Bundle ships for Firmware, Application Software, and FinishLine; Simulation comes later. Skills don't enumerate Track names or owners — they point at Confluence + GitHub so the live-current organization wins (officer turnover and reorgs happen fast).
_Avoid_: side, team (overloaded with sub-team), discipline. Launchpad is *not* a Track — it's a learning program with per-Track curricula.

**Car**:
The NER race car considered as a complete system spanning firmware, electrical, mechanical, and telemetry. Cross-discipline relationships (firmware ↔ EE schematics ↔ CAN signals ↔ mechanical) are part of the Car. Onboarding-specific Skills surface these relationships for Onboardees orienting themselves; general team Q&A Skills don't need a Car-wide view.
_Avoid_: vehicle (too formal), system (too generic), the whole thing

## Example dialogue

> Dev: "How do members install the agent?"
>
> Domain expert: "They install the **Software Bundle** into their **Surface** — Claude Desktop today, Goose Desktop later. The Bundle ships five Skills: `ner-setup` (first-time Connector setup for any user), `ner-onboard` (orientation for new members), `ner-ask` (general Q&A), `ner-repo-explainer`, and `ner-escalation-router`. They drag a ZIP per Skill into Customize > Skills. Later we'll publish parallel **Sub-team Bundles** for EE and ME, but for v1 it's just the Software Bundle."
>
> Dev: "Does the Onboardee pick a Track on first run?"
>
> Domain expert: "`ner-onboard` asks which Track they're joining (Firmware, Application Software, or FinishLine for v1) so it can personalize the walkthrough. The general-purpose Skills don't care; they answer questions for any software-team member regardless of Track. Connector setup happens in `/ner-setup`, which is separate from onboarding because returning members need it too."

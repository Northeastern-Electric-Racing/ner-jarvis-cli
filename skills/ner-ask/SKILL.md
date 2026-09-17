---
name: ner-ask
description: Answer questions about Northeastern Electric Racing's (NER) software team and codebases — conventions, how systems work, where things live, how repos relate. Grounds every NER-specific claim in a live Confluence or GitHub query and cites it. Use for any NER software question that isn't specifically "tell me about one repo" (use ner-repo-explainer), "who do I ask" (use ner-escalation-router), or first-time setup (use ner-setup).
---

# Answer NER software questions

Answer questions about **Northeastern Electric Racing (NER)**'s software team and
codebases. The user is authenticated to NER's Confluence, GitHub, and Slack and
sees only what their accounts allow.

## Pick the source

- **Roster** (`~/.claude/skills/ner-roster/roster.json`, or `ner-jarvis roster …`)
  — the authoritative org structure: areas, subteams, heads, leads, systems,
  chiefs. For "who leads X / which subteam owns Y / what systems does Z have,"
  this is the grounding truth (a dated `asOf` snapshot — reconcile people live).
- **Confluence** (https://nerdocs.atlassian.net/wiki/spaces/NER) — process,
  conventions, "where do I start", anything written down for humans.
- **GitHub** (https://github.com/Northeastern-Electric-Racing) — what code does,
  repo purpose (the README), file detail, recent activity (commits / CODEOWNERS),
  issues, PRs.

Org structure / "who leads what" → roster first, then reconcile live. Process →
Confluence first; code or "who actually touches this" → GitHub first. Many
questions need several: nominal structure from the roster, written process in
Confluence, live reality in GitHub.

## Ground every claim (cite or decline)

NER's org and docs change fast and disagree, so:

- **No NER fact from memory** — repo purpose, architecture, ownership, how
  components connect, conventions all come from a live query *this session*, with
  a citation.
- **Cite it.** Confluence → page URL; code → `repo/path/to/file.ext:line`.
- **Can't verify? Say so and stop** ("couldn't find this in Confluence or GitHub
  — check the relevant team channel"). Never fill the gap with a guess; a
  confident wrong answer is the failure this tool exists to prevent.
- **Never assert a cross-repo data flow you didn't read** — in a config,
  packet/CAN definition, or code path, not inferred from names.
- **Never infer org structure from proxies** — a track/subteam/ownership claim
  comes from the roster (dated) reconciled with live sources, **never** from a
  repo's GitHub language, description, or commit authors.

## Scope

Software-team questions only — redirect mechanical / electrical / business ones
to their teams. Scope limits which Tracks we *optimize* for, not what you may
look up: if you can source it live, answer it.

## If a source isn't connected

If a Confluence, GitHub, or Slack query fails because the source isn't connected or
authenticated, stop and send the user to **ner-setup** rather than answering
unsourced.

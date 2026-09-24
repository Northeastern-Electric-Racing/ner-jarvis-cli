# ner-roster (data, not a skill)

This directory ships **data**, not an invokable skill — it has no `SKILL.md`, so
Claude Code never triggers it. ner-jarvis bundles and installs it like any skill
dir (content-hashed, updated, undoable), landing it at
`~/.claude/skills/ner-roster/roster.json`.

## What it is

`roster.json` is the NER **org leadership roster**, hierarchical by area:

```
executiveBoard[]                      # President + Chiefs
areas[]
  area, chief
  subteams[]                          # each led by a `head`
    name, head, leads[] { role, name }
  leads[]                             # optional: area-level leads with no named subteam head
```

- **A role can have more than one lead** (e.g. two TSECU Leads) — that's expected.
- `channels` maps a system to the public Slack channel where it is **actually
  discussed**, with a `default` fallback. Verified by reading live channel
  activity, never inferred from the name — `#github_argos` reads like the Argos
  channel but is a dead webhook feed; real Argos traffic is in
  `#s_embedded-software`.
- Stamped with `asOf` ("Fall 2026"). It is the **grounding truth for org
  structure and nominal ownership**, but it is a *dated snapshot*: skills should
  still reconcile people live (GitHub recent committers, Confluence roster) for
  recency and surface conflicts with dates rather than trusting it blindly.

## How the skills use it

The NER skills (`ner-onboard`, `ner-ask`, `ner-repo-explainer`,
`ner-escalation-router`) read this file to answer "which track/area owns X" and
"who leads Y" from an authoritative structure — instead of inferring org taxonomy
from GitHub language tags or descriptions (which is not authoritative for it).

## Querying

Read it directly (it's small), `jq` it, or use the bundled CLI.

Free-text search (AND of terms):

    ner-jarvis roster                     # everyone
    ner-jarvis roster argos               # rows matching "argos"
    ner-jarvis roster software telemetry  # AND of terms

Named lookups (sub-verbs):

    ner-jarvis roster heads               # every subteam head
    ner-jarvis roster head <team>         # the head of a subteam
    ner-jarvis roster leads <team>        # the leads of a subteam
    ner-jarvis roster systems [scope]     # distinct systems (e.g. Argos, VCU)
    ner-jarvis roster system <name>       # who leads a system
    ner-jarvis roster who <name>          # every role a person holds

Add `--json` to any of the above for machine-readable output.

Under the hood these map to a small, pure query API in the `ner-jarvis-cli` repo,
`src/core/roster.ts` (`heads`, `headOf`, `leadsOf`, `inArea`, `inSubteam`,
`byRole`, `byPerson`, `systems`, `systemOwners`, `chiefOf`), which flattens the
tree to rows
(`area, subteam, role, name`) — plain JSON, no database, identical behavior on
every platform.

## Maintenance

Edit `roster.json` when leadership changes and bump `asOf`. Keep names verbatim;
role labels are normalized (typo-corrected) for querying.

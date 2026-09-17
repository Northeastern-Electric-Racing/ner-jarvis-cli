---
name: ner-escalation-router
description: Figure out who to ask or where to post about a Northeastern Electric Racing (NER) software topic, repo, or system. Resolves current owners live from GitHub and Confluence, finds the right public Slack channel to post in, surfaces conflicting sources with their dates, and frames the action as posting publicly. Use when the user asks "who owns X", "who do I ask about Y", "who's the lead for Z", or where to get help.
---

# Route an NER question to the right people

NER is a student club with fast officer turnover and stale docs, so resolve
ownership **live** — never trust a single hard-coded name.

## Resolve ownership

Start from the **roster** for structure, then layer live signals on top.

0. **Org structure & nominal ownership → the roster.** NER's authoritative
   area → subteam → head/leads map ships at
   `~/.claude/skills/ner-roster/roster.json` (also queryable:
   `ner-jarvis roster system Argos`, `roster head Firmware`, `roster who <name>`,
   `roster leads <subteam>`). Use it to answer *which subteam/system owns a topic
   and who nominally leads it*. It's a **dated snapshot** (`asOf`) — trust it for
   structure, reconcile the people live. **Never infer a topic's owning
   track/subteam from GitHub language, repo descriptions, or commit authors** —
   that once mislabeled FinishLine as Application Software.
1. **Freshest people signal → GitHub**: recent committers, and CODEOWNERS if
   present (https://github.com/Northeastern-Electric-Racing). Recent committers
   are *activity*, not an ownership assignment — and never present your own team
   memberships as the owner.
2. **Nominal role, cross-check → Confluence** ("the firmware lead", "the chief
   software engineer") at https://nerdocs.atlassian.net/wiki/spaces/NER, citing
   the page's date ("as of <date>") — these go stale.
3. **When sources disagree** (roster vs GitHub vs Confluence — they often do),
   surface them **with their dates** and let the user judge. Don't silently pick one.

## Frame it as posting publicly

NER's norm is to **post in the public channel, not DM a lead.** So the answer is
almost always "post in <channel>," with names as *context*:

> "Post in the relevant software channel. GitHub shows **A** and **B** as the
> recent committers; Confluence (as of <date>) lists **C** as the nominal lead."

To name the channel, search NER's Slack live — it's the source of truth (channels
get renamed and archived, and Confluence lags). If Slack isn't connected, fall
back to the Confluence channel list and flag that it may be stale. Don't
hard-code channel names.

## Rules

- Cite sources (the roster + its `asOf` date, GitHub repo/committers, Confluence
  page URL + date, Slack channel).
- If you can't resolve an owner, say so and fall back to the general software
  channel. Never invent a name.

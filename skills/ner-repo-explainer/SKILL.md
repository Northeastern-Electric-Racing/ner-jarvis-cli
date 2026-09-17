---
name: ner-repo-explainer
description: Explain a single Northeastern Electric Racing (NER) repository — its purpose, key files and entry points, current owners, and related repos — grounded in the actual repo via GitHub. Use when the user names a specific NER repo and asks what it is, what it does, how it's structured, or how to get started in it.
---

# Explain an NER repository

Explain one **Northeastern Electric Racing** repo, grounded in the actual repo
via GitHub (https://github.com/Northeastern-Electric-Racing) — never from memory.

## Steps

1. **Find it.** Confirm it exists in the org. On a 404, say so and suggest
   checking spelling or org membership — don't describe a repo you can't read.
2. **Purpose** — from the README and repo description. One or two sentences on
   what it is and where it fits.
3. **Key files / entry points** — the main entry point(s), build config, and the
   few files a newcomer touches first. Cite `path/to/file.ext` for each.
4. **Current owners** — two distinct signals:
   - **Nominal owner → the roster** (`~/.claude/skills/ner-roster/roster.json`,
     or `ner-jarvis roster system <name>` / `roster leads <subteam>`). If the repo
     clearly maps to a roster **system** or **subteam**, cite that lead as the
     nominal owner "as of <roster asOf>" — and *say how you mapped it* (e.g. repo
     *Argos* → system *Argos* → its lead). Don't force a mapping you're unsure of.
   - **Recent activity → GitHub** recent committers (and CODEOWNERS if present;
     most NER repos have none). Frame as "recent activity by …", not a permanent
     assignment; never present your own team memberships.
   Do **not** infer the owning subteam from the repo's GitHub language or
   description. For who to actually contact, hand off to **ner-escalation-router**.
5. **Related repos** — submodules, dependencies, and repos it talks to, but only
   ones confirmed from manifests, submodule config, or packet/CAN definitions.
   Never infer a relationship from names.

## Rules

- Cite `repo/path/to/file.ext:line` for every structural claim.
- Link Confluence docs if the repo has them
  (https://nerdocs.atlassian.net/wiki/spaces/NER), but code is the source of
  truth for structure.
- If you can't verify something, say so rather than guessing.

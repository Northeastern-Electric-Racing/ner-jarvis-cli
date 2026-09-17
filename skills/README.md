# NER Software Bundle — Skills

Six Claude **Skills** that help NER software-team members get answers grounded
in NER's live Confluence and GitHub. Built for **Claude Desktop**.

## The skills

| Skill | What it does |
|-------|--------------|
| `ner-setup` | One-time setup: connect Atlassian + GitHub, verify. Anyone, first. |
| `ner-onboard` | Orient a new member: pick a Track, point at onboarding docs, find a first ticket. |
| `ner-ask` | General Q&A about NER software, grounded and cited. The headline skill. |
| `ner-repo-explainer` | Deep-dive one repo: purpose, entry points, owners, related repos. |
| `ner-escalation-router` | Who to ask / where to post about a topic or repo. |
| `ner-flag-stale` | Record a doc that misled you; review and export the log to share. |

All six are **pointer-only**: they tell Claude *where to look* (Confluence +
GitHub) and *how to answer* (ground every claim, cite or decline), and never
hard-code facts that go stale — leads, repo lists, version numbers. See
`../CONTEXT.md` and `../docs/adr/` for the why.

## Install (Claude Desktop)

These install one at a time through the Claude Desktop UI — there is no
one-click installer (see `../docs/adr/0002-manual-connectors-over-mcp-remote.md`
for the Connector side; the Skills upload is manual for the same reasons).

1. Get the ZIPs: download from the repo's Releases, or build them yourself with
   `./package-skills.sh` from the repo root (output lands in `dist/`).
2. In Claude Desktop: **Settings → Customize → Skills → + → Upload a skill**.
3. Drag in each `*.zip`. Repeat for all six.
4. Open a chat and run **`ner-setup`** first to connect Atlassian + GitHub.

Using Claude Code instead of Desktop? Point it at these folders directly —
copy or symlink each one into `~/.claude/skills/`.

## Build

From the repo root:

```bash
./package-skills.sh   # writes dist/ner-*.zip, one per skill
```

Each ZIP contains a single skill folder with its `SKILL.md` at the root.

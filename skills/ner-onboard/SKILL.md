---
name: ner-onboard
description: Orient a new Northeastern Electric Racing (NER) software-team member — pick their Track, point them at the right onboarding docs, and help them find a first contribution — all grounded in live Confluence and GitHub. Use when someone is new to NER software, just joined, is starting onboarding, or asks "how do I get started" / "what do I do first".
---

# Onboard a new NER software member

Orient a new member using **current** material pulled live from Confluence
(https://nerdocs.atlassian.net/wiki/spaces/NER) and GitHub
(https://github.com/Northeastern-Electric-Racing) — don't lecture from memory,
and cite every pointer as a clickable link.

## Flow

1. **Confirm setup first — and let it gate the rest.** If Atlassian + GitHub (and
   Slack) aren't returning live data, hand off to **ner-setup** rather than diagnosing
   it here. In Claude Code the common case is *installed but not authenticated* — an
   auth step, **not** a reinstall. Let Claude Code recommend the auth to the user (its
   "needs authentication · run /mcp" prompt); don't do it for them.
   **Do one thing at a time.** When a source still needs the user to go authenticate,
   *stop there*: give the auth steps, ask them to come back once it's connected, and
   wait. Don't fire the Track question (or any onboarding popup) in the same breath — a
   multiple-choice prompt competing with a "go log in" instruction just splits their
   attention, and the Track answer isn't actionable until Confluence is live anyway.
   Onboarding answers are only good once the sources return live, cited data.
2. **Once setup is confirmed live, ask which Track they're joining.** Ground the
   current Software subteams in the roster (`~/.claude/skills/ner-roster/roster.json`,
   or `ner-jarvis roster heads`) instead of a memorized list — as of the shipped
   snapshot that's **FinishLine**, **Software Product**, **Application Software**,
   and **Firmware** — and **always offer a "not sure / I don't know" option.** A
   brand-new member often won't know yet, and that's fine: never force a pick. If
   they're unsure, help them figure it out (what they're excited to work on —
   embedded/electronics, full-stack apps, or data/tooling — who recruited them, or
   which sub-team they've already talked to), or let them start broad and post in the
   general software channel via **ner-escalation-router**. If they name another Track,
   look it up live rather than correcting them. Conversation-only; no saved state
   across sessions.
3. **Point at the live onboarding path** for that Track: find the current
   Confluence pages (environment setup, contributor guide, learning resources,
   starter-ticket instructions), link them, and summarize what they say now —
   don't paraphrase a page you haven't read this session.
   **Prefer a maintained page over a nominally-correct one.** Some tracks have a
   recently-edited landing page and some have one that has sat untouched for two
   years; check when a page was last updated and lead with the live one. If the
   Track's own page is a stub or just defers ("ask your lead"), say so plainly
   rather than relaying it as guidance, and fall back to the nearest maintained
   page — then see step 6.
4. **Help them orient in the code.** For the Track's main repo(s), hand off to
   **ner-repo-explainer**.
5. **Find a first contribution** — a starter ticket from the current Confluence
   instructions / GitHub issues. If the live sources are thin or contradictory,
   say so and route them to the team channel via **ner-escalation-router**.

6. **When the docs dead-end, record it — once.** NER's wiki is mid-restructure, so
   some Tracks currently have no current onboarding page. If you hit a 404, a stub,
   or a page that contradicts the roster, name the gap in one line and hand off to
   **ner-flag-stale** to offer logging it. Don't let this become the conversation:
   offer once, take "no" the first time, and never audit pages the member didn't ask
   about. The member came here to get started, not to review documentation.

Stay encouraging and concrete. Whenever you ask the member to choose or answer
something, always include a "not sure / I don't know" option and help them work it
out — a new member should never have to guess. Everything Track- or person-specific
comes from a live, cited query.

# Getting ner-jarvis + ner-onboard off the ground, pending better docs

Status: **Phases 0-3 shipped 2026-09-06** · Wyatt + Claude

> **Where this landed.** ner-jarvis **v0.1.0** is released (5 binaries, all platforms).
> CI is green on macOS/Linux/Windows after being red since Jul 13. `ner-jarvis stale`
> and the `ner-flag-stale` skill ship in it. Two things are **not** done and both need
> you: the `NPM_TOKEN` repo secret (the release builds the npm bundle and skips the
> publish without it), and handing the CLI to 2-3 new App Software members.
> PRs #3 #4 #5 #6.

## The reframe

Today the pitch is *"this tool answers your NER questions from live Confluence."* That
pitch is blocked on Confluence being good, which is blocked on the Software 27 restructure,
which is parked.

Change the pitch to: **"this tool gets you set up, and it captures every place the docs
lied to you."** That ships now, it's honest about the state of the docs, and it turns
every new member's first two weeks into the exact input needed to fix Confluence — instead
of that knowledge evaporating into a DM.

The staleness log isn't a side feature. It's what makes shipping-before-the-docs coherent.

---

## Phase 0 — unblock the release path

Small, mechanical, all blocking. Nothing here needs a decision.

| # | Item | Detail |
| --- | --- | --- |
| 0.1 | **CI is red on Windows** | Every push since Jul 13 fails. macOS + Linux green. Two tests: `interactive: declining skills installs none, still connects confirmed sources` and `cloneWorkspace refuses when dest already exists (runs no git)`. Almost certainly path-separator / `existsSync` semantics. `release.yml` can't fire until this is green. |
| 0.2 | **Commit the working tree** | 5 files uncommitted: modified `CLAUDE.md` + 5 untracked docs (`onboarding-staleness.md`, `staleness-dashboard.html`, `project-status.html`, `software-27-app-software-draft.md`, `app-software-onboarding.md`). |
| 0.3 | **Fix the test count in CLAUDE.md** | Says 185, actual is 237. |
| 0.4 | **Fix Slack facts in CLAUDE.md** | `#software_argos` and `#software_nero` are **archived**. App Software development now happens in `#s_embedded-software` (CLAUDE.md still describes it as firmware-only). `#software_launchpad` is the all-software new-member channel. Chris's June rename plan (`#s_finishline`, `#s_product`) never happened — don't encode it. |
| 0.5 | **Reconcile `roster.json`** | Drop the Data Visualization Lead entry (Ithaca last push 2026-03-24, unstaffed this season). Confirm Argos → Jeff Kuo, NERO → Dev Chechi. |
| 0.6 | **The workspace repo is the first thing a member sees** | `bracyw/ner-jarvis` last pushed 2026-07-07 and is nearly empty. Whatever the CLI clones is the member's landing page. Put `docs/app-software-onboarding.md` in it as the README. |

## Phase 1 — the stale-doc report loop

The new capability. Local-first, with the sink deliberately pluggable.

### Data flow

```
member hits a wrong doc
   │
   ├─ tells Claude Code ("this page is out of date")
   │     └─ ner-flag-stale skill → shells out to the CLI
   │
   └─ ~/.claude/ner-jarvis/stale.jsonl        ← Phase 1: lives here, goes nowhere
         │
         ├─ `ner-jarvis stale export`  → paste-ready markdown  ← Phase 1 exit
         ├─ Slack post                                          ← Phase 2 (TBD)
         └─ FinishLine server                                   ← Phase 3
```

### 1.1 Storage — a new file, not the decision log

`core/log.ts` already appends NDJSON to `~/.claude/ner-jarvis/log.jsonl`, but that log is
specified as *"never read back… purely a human/debug artifact."* Stale reports need to be
read, listed, exported, and marked-as-sent. Different lifecycle → different file, with its
own versioned schema under the existing migration guard (`core/migrations.ts`, plus the
schema-snapshot test that fails CI on an un-migrated shape change).

Record shape (v1):

```jsonc
{
  "schemaVersion": 1,
  "id": "01J...",                  // ULID, stable across export/send
  "ts": "2026-09-05T18:22:00Z",
  "toolVersion": "0.1.0",
  "target": {
    "kind": "confluence",          // confluence | github | slack | repo | skill | other
    "url": "https://nerdocs.atlassian.net/wiki/.../538607622",
    "title": "Applications Software Onboarding | Embedded Software"
  },
  "dimension": 3,                  // 1-8, the rubric in docs/onboarding-staleness.md
  "whatIsWrong": "Page just says 'ask your lead' — no actual setup steps.",
  "whatIsTrue": "Setup lives in the Argos README now.",   // optional
  "reporter": "wbracy",            // local git user.name; never the email
  "sent": null                     // or { "sink": "slack", "at": "...", "ref": "..." }
}
```

**Reuse the 8-dimension rubric** already written in `docs/onboarding-staleness.md` as the
`dimension` enum. It's the same taxonomy the audits used, so member reports land in the
same buckets as the existing backlog and can merge into it directly.

### 1.2 CLI surface

```
ner-jarvis stale add     [--url U] [--title T] [--kind K] [--dimension N] [-m MSG]
ner-jarvis stale list    [--unsent]
ner-jarvis stale export  [--format md|json] [--unsent] [--mark-sent]
ner-jarvis stale rm <id>
```

`add` is interactive on a TTY (same three modes as `setup`) and fully flag-driven
otherwise, so the skill can call it non-interactively.

`export --format md` emits a paste-ready block. That is the Phase 1 exit: the member
copies it into `#tech-support`. No network call, no new permission, nothing leaves the
machine unless they run the command.

### 1.3 The skill

New `skills/ner-flag-stale/SKILL.md`. Triggers on "this doc is wrong / out of date / this
link is dead / this page doesn't match reality." It fills the record from context (it
already has the URL and title in hand), asks at most one clarifying question, calls
`ner-jarvis stale add`, and confirms. It should also fire **proactively** — when
`ner-onboard` or `ner-ask` reads a Confluence page and the page contradicts `roster.json`
or 404s, offer to log it rather than silently working around it.

### 1.4 Privacy — worth being explicit

This is the first thing the tool records *about NER's docs* rather than about the install.
Rules, mirroring the existing decision-log rule:

- The file is local. Nothing transmits without an explicit `export`/send command.
- Never write secrets, tokens, page bodies, or anything behind a Confluence restriction —
  the target URL and title only.
- `reporter` is the local git `user.name`, not an email address.
- `ner-jarvis uninstall` clears it, same as the undo journal.

---

## Phase 2 — make ner-onboard degrade honestly

`ner-onboard` currently hard-gates on live Confluence and step 3 tells it to "find the
current Confluence pages… and summarize what they say now." Against today's Confluence that
either dead-ends on the punt page (`538607622`) or hands over something from 2024.

Changes:

- **Ship a local fallback.** `docs/app-software-onboarding.md` (club/team orientation, no
  setup, no architecture) goes into the payload. When Confluence is thin, the skill leads
  with that instead of a dead link, and says plainly that the Confluence pages are being
  rebuilt.
- **Point at what's actually current.** Firmware's onboarding (`1343533`, v46) and
  Engineering Support (`3997751`, v26, updated Sep 3) are live and maintained. App
  Software's are not. The skill should prefer maintained pages over nominally-correct
  ones.
- **Wire in the flag.** Every dead end becomes a `stale add` offer. That's the loop closing.

---

## Phase 3 — actually release

1. CI green on all three OSes (0.1).
2. Tag `v0.1.0` → `release.yml` fires → cross-compiled binaries + npm publish. It has never
   run; expect one round of fixes. Needs the `NPM_TOKEN` secret set.
3. Dogfood on one clean machine, start to finish.
4. Hand to 2–3 new App Software members as the async track. Chris already agreed app
   software gets "a slightly different async track" and you told heads on Sep 1 you'd share
   an onboarding CLI to test.
5. Read `stale.jsonl` off those machines. That's the Confluence backlog, written by the
   people the docs failed.

---

## Deferred (explicitly out of scope now)

- **Slack sink.** How reports post — bot, canvas, `#tech-support` thread, digest — is TBD.
  Phase 1 ships copy-paste; that's enough to learn what the reports look like before
  automating a channel post.
- **FinishLine sink.** The eventual destination. Needs a FinishLine endpoint and an auth
  story. Design the record shape so it's the same payload either way.
- **The Confluence restructure** (`docs/software-27-app-software-draft.md`) — parked.
- **Argos/NERO onboarding content** — parked with it.
- ADR 0003 held back a question-log MCP for exactly this class of telemetry. Worth
  re-reading before Phase 2 of the sink work; this is a narrower version of that idea.

---

## Decisions needed from Wyatt

1. **Sequencing:** Phase 0 → 1 → 2 → 3, or fix CI and cut `v0.1.0` immediately with the
   stale log as `v0.2.0`? Shipping first gets it in front of members sooner; waiting means
   the first cohort's confusion actually gets captured.
2. **Does `stale add` need a "this blocked me" severity flag**, separate from the rubric
   dimension? Useful for triage, one more field to fill in.
3. **`ner-flag-stale` as its own skill, or a section inside `ner-ask`?** Separate skill is
   cleaner to trigger; folding it in means it's always loaded.

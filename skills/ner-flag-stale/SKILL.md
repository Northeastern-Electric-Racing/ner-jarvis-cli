---
name: ner-flag-stale
description: Record a Northeastern Electric Racing (NER) doc that misled you — a Confluence page, README, or channel pointer that reads as current but isn't. Use when someone says a doc is wrong / out of date / a link is dead / "this doesn't match reality", when they're confused by something they were told to follow, or when you hit a 404 or a page that contradicts the roster while answering.
---

# Flag a stale NER doc

NER's wiki is mid-restructure, so a new member will hit pages that read as current
and aren't. This skill turns that moment into a record instead of a shrug.

Reports go to `~/.claude/ner-jarvis/stale.jsonl` on the member's own machine.
**Nothing is transmitted.** They review and share it themselves with
`ner-jarvis stale export`.

## What counts as stale

Staleness is **relational, not chronological.** Age is not the test.

> A page is stale iff **(a)** a reader could mistake it for current — nothing in its
> title, location, or surroundings marks it superseded — **and (b)** acting on it
> would be wrong.

Apply the successor check, then pick one:

| Verdict | When | Log it? |
| --- | --- | --- |
| `orphan-current` | Wrong, and you can't find a newer page on the topic. A member will follow it. | Yes — this is the urgent one |
| `superseded` | Wrong, but a newer version is discoverable. Clutter. | Yes, with `--successor` |
| *historical* | A record of how something *was* — reads as past, not present. | **No.** Not stale. Leave it alone |

A 2024 design-decision record is history. A 2024 onboarding page is stale exactly
when it's the only onboarding page a member will find. **Search for a successor
before you decide** — that check is what separates the first two rows, and it's the
step that's easy to skip.

## When to speak up

**Two triggers, and no others.**

1. **The member is confused.** They followed something and it didn't work, or they
   can't reconcile two sources. Offer to record it. Capture what they were *trying to
   do*, not just the URL — that's what makes it actionable later.

2. **You hit it yourself while answering** — a 404, or a page that directly
   contradicts `roster.json`. Mention it in one line and offer to log it.

Otherwise **stay quiet.** Do not audit pages you weren't asked about, do not
second-guess a page that merely looks old, and do not interrupt an answer to raise a
doubt. The staleness test above is the filter, and most pages simply don't pass it.
A member who feels QA'd will stop asking you things.

## Recording one

Confirm the verdict and the "what's wrong" line with the member — the rest you can
fill from context. Then:

```
ner-jarvis stale add \
  --url="<page url>" \
  --title="<page title>" \
  --kind=confluence \
  --wrong="<what it claims that isn't so>" \
  --true="<what's actually true, if known>" \
  --dimension=<1-8> \
  --successor="<newer page url, only for superseded>" \
  --blocked
```

- `--wrong` is required. A bare link isn't actionable.
- Omit `--successor` and the verdict is inferred as `orphan-current`; supply it and
  it's `superseded`. Pass `--verdict` only to override that.
- `--blocked` means they couldn't proceed. It's a triage signal, separate from how
  wrong the page is — don't set it just because the page was annoying.
- `--kind`: `confluence` · `github` · `slack` · `repo` · `skill` · `other`.

### Rubric dimensions for `--dimension`

1. Leadership currency · 2. Org-structure currency · 3. Doc recency & completeness ·
4. Glossary ⇄ GitHub drift · 5. Dead links & version drift · 6. Slack channel currency ·
7. Onboarding-path viability · 8. Shipped grounding-truth drift

Pick the closest; 3 is the reasonable default.

## Reviewing and sharing

```
ner-jarvis stale list              what's recorded, most misleading first
ner-jarvis stale list --unsent     only what hasn't been shared
ner-jarvis stale export            paste-ready markdown
ner-jarvis stale export --mark-sent   ...and mark the batch shared
ner-jarvis stale rm <id>           drop one
```

Sharing is the member's call and their action: `export`, then paste into the team's
support channel. Look the channel up live rather than naming one here — channels get
renamed and archived, which is the same failure mode this skill exists to catch.

## What never goes in a report

- **No page bodies.** URL and title only. A page may be restricted; a report may get
  pasted into a public channel.
- **No credentials, tokens, or anything from a private page.**
- **No email addresses.** `reporter` is the local git `user.name`, set automatically.
  Don't add contact details.

If the member wants to report something behind a restriction, record the URL and a
neutral description of the problem — not the content.

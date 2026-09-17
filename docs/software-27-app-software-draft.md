# Draft — `Software 27` → `App Software 27` (Confluence)

Status: **draft for review**, nothing created in Confluence yet.
Drafted 2026-09-05, revised same day (scope: full App Software tree, not just onboarding).
Sources: `skills/ner-roster/roster.json` (asOf Fall 2026), live GitHub via `gh`,
`docs/onboarding-staleness.md`. Confluence-side facts marked **[verify]** —
Atlassian MCP was unauthenticated at draft time.

**Decision (Wyatt, 2026-09-05):** everything App Software lives under `Software 27`,
open by default. Nothing in the App Software universe needs to be private; anything
that later does gets restricted **per page** (Confluence restrictions inherit to
children, so restricting one page covers its subtree).

---

## Tree

```
Software 27                              (PAGE, top-level — not a folder, not under NER27)
└── App Software 27                      (PAGE — subteam landing)
    ├── Start Here                       (access, accounts, prerequisites)
    ├── Season 27                        (ANNUAL: roster, roadmap, goals, meeting notes)
    ├── Shared Resources                 (EVERGREEN — moves forward each year, see §Lifecycle)
    │   └── Dev Environment              (Docker, git, editors, common tooling)
    ├── Argos                            (system home)
    │   ├── Onboarding
    │   ├── Architecture & Systems       (scylla-server, charybdis, siren, clients)
    │   ├── Development                  (compose profiles, mock data, schema work)
    │   └── Deployment & Track Ops       (router/SSH, comp) ← the one restrict-if-ever candidate
    └── NERO                             (system home)
        ├── Onboarding
        ├── Architecture
        └── Development

[later] Firmware 27       — do not move yet; Caio's NER27 branch is live and in use
[later] FinishLine 27     — Chris is actively reorganizing; coordinate first
[later] Software Product 27 — no page exists anywhere today
```

Pages, not folders: NER27's `MECHANICAL RAHHHH` / `ELECTRICAL MEOW` are Confluence
*folders* and can't carry content (the page API 404s on them). Every node above that
needs body text must be a page.

---

## ⚠ The one thing "everything under Software 27" breaks

`Software 27` is an **annual** tree — that's the whole point, and the archive footer
says so. But most App Software technical docs are **evergreen**: how scylla works,
what charybdis is, how to set up Docker. Argos's architecture doesn't change because
the car did.

If everything sits under `Software 27` and the tree archives at season end, the
evergreen docs archive with it — and the next head rewrites from scratch. That is
precisely the rot this whole project exists to stop.

**Recommendation** — the mechanism you already settled in July: a `Shared Resources`
branch that **moves — never copies — forward** into `Software 28` at handoff, so page
IDs survive and every existing link keeps working. Two categories, decided per page:

| Category | Examples | At season end |
|---|---|---|
| **Annual** | roster, roadmap, goals, this year's onboarding, meeting notes | archives with `Software 27` |
| **Evergreen** | architecture, dev environment, system docs, deployment runbooks | **moves** to `Software 28` |

The alternative — let it all archive and re-create yearly — is a real option, just
name it deliberately rather than discovering it next August.

---

## Page-by-page

### `Software 27`
- **What this is** — "Software's docs for the NER27 season (Aug 2026 – Jul 2027).
  Each season gets its own tree; when Software 28 opens, this one is archived, not edited."
- **Why it's top-level, not under NER27** — one sentence on the guest/permissions gap.
  (This deliberately reverses the July "cycle docs live in the car tree" convention —
  say so, or the next head undoes it.)
- **Pick your subteam** — App Software / Firmware / FinishLine / Software Product.
  Firmware and FinishLine link to their *current* homes until they move.
- **Who runs Software** — Chief Software **Chris Pyle**; subteam heads.
- **Where to ask** — `#software`, `#tech-support`. [verify]

### `App Software 27`
- **What we build this season** — two systems:
  - **Argos** — real-time data processing + visualization. Angular client, Flutter
    client, `scylla-server`, `charybdis` schema. TypeScript/Rust. Public repo.
  - **NERO** — the car's dashboard. C++/Qt/QML, runs on the vehicle. Public repo.
  - *(`Ithaca` — telemetry data-viz, Python — exists but is **not staffed for NER27**.
    One line so nobody finds the repo and assumes it's live.)*
- **The team** — Head **Wyatt Bracy**; Argos Lead **Jeff Kuo**; NERO Lead **Dev Chechi**.
  ⚠ **Resolve before publishing — see flag #6.**
- **New here? → Start Here**
- Footer: *"Snapshot of the NER27 season. Archive with the Software 27 tree; don't
  update in place after the season closes."*

### `Start Here`
The day-one blocker page — currently tribal knowledge.
- **Accounts, in order**
  1. NER Google / Slack — join `#software`, `#tech-support`, your system's channel
  2. **GitHub org membership** (Northeastern-Electric-Racing). Without it private repos
     return **404, not 403** — a 404 means a permissions gap, not a missing repo
  3. Confluence access
  4. *(Argos, later)* router / SSH access — ask the Argos lead
- **Prerequisites** → `Shared Resources / Dev Environment`
- **How to ask** — post publicly in `#tech-support`; don't DM leads first

### `Argos / Onboarding`
- Repo: `Northeastern-Electric-Racing/Argos` (public)
- Quickstart → README's Angular Client / Scylla Server / Flutter Client sections
- Local dev with mock data → `./argos.sh client-dev up`
- ⚠ README's "Development" link points at **Odyssey 24A** (`615874585`) — year-stamped
  *and* empty. **Odyssey 25A** (`1017610276`) exists; link that and fix the README. [verify]
- First contribution → live "good first issue" filter, not a prose page
- Ask: Argos Lead / `#software` — [verify] whether a live `#software_argos` exists

### `Argos / Architecture & Systems`, `/ Development`, `/ Deployment & Track Ops`
Homes for the real content. **Link out to repo docs; don't restate them** — Argos
already carries `README.md`, `CLAUDE.md`, and `CONTEXT.md` in-repo, and those stay
current. Confluence owns orientation, access, and the things that have no repo home
(router procedures, comp-day runbooks, decisions).
`Deployment & Track Ops` is the only page I'd expect to ever want a restriction —
and even then, restrict credentials, not procedure.

### `NERO / Onboarding`, `/ Architecture`, `/ Development`
- Repo: `Northeastern-Electric-Racing/Nero-2.0` (public, C++/Qt/QML)
- Setup → Qt Creator, open `NERODevelopment/CMakeLists.txt`, pick your desktop kit, build+run
- Mock telemetry → `docker compose -f compose.nero-dev.yml up -d`
- ⚠ README's install link is a shortlink: `nerdocs.atlassian.net/wiki/x/CIBORQ`.
  **Resolve where it lands** before depending on it — it may have moved or been
  archived in Jack's 2026-09-02 sweep. [verify]
- Note for newcomers: NERO is **App Software, not firmware**, despite the C++

---

## Migrating the existing pages

Rules, in order of importance:

1. **MOVE, never copy.** Page IDs survive a move; links keep working. Argos's README
   links Confluence by ID and NERO's by shortlink — a copy-and-delete breaks both.
2. **Don't retro-file last season into this one.** `Applications Software 25`
   (`970162178`) and its `Argos 25` / `NERO 25` children are NER25-season pages. They
   stay put (or go to Archive) — pulling them into `Software 27` defeats the annual model.
   Move the *evergreen* content out of them; leave the season shell behind.
3. **Tombstone anything linked by ID**, don't delete: the old Software roots
   `5603329` / `5079215` are README-linked. Leave stubs pointing at Software 27.
4. **Kill the punt page.** `Applications Software Onboarding | Embedded Software`
   (`538607622`) says "a general onboarding guide is not possible — your applications
   software lead will guide you." Once `Start Here` exists, that page is superseded;
   archive it in the same sitting. [verify it still reads that way]
5. **Odyssey 24A** (`615874585`) is year-stamped and empty — archive; repoint the
   Argos README at Odyssey 25A.

---

## LIVE VERIFICATION — 2026-09-05 (via `twg` CLI, read-only)

### 1. Permissions premise — ✅ CONFIRMED

| Page | Restrictions |
|---|---|
| `NER27` (1651179525) | update: 1 user + 1 group · **read: group `1cf3d137-…`** |
| `Software` (5603329, top-level) | update: 1 user + 1 group · **no read restriction** |

NER27 carries a **read restriction**; the top-level Software page does not. Content
filed under NER27 is genuinely gated in a way top-level content isn't. Your instinct
was right. *(Caveat: the group endpoints 404'd, so I couldn't resolve the group's
display name — worth eyeballing in the UI to see who's actually in it.)*

### 2. The NER27 draft is Wyatt's own year-roster stub — RESOLVED, no collision

```
NER27
└── Software            [FOLDER]  2078441486
    └── App Software    [PAGE, DRAFT]  2078310430   ← 404 on read
```

Read via `--draft` on 2026-09-05. **v1, 2026-08-24, four lines:**

> **Head:** Wyatt Bracy · **Chief:** Chris Pyle · **Argos Lead:** Jeff Kuo · **NERO Lead:** Dev Chechi

Same shape as `Applications Software 25` — it's the **annual roster page**, following
last year's pattern. Wyatt's own draft; no collision with Chris.

Two consequences:
- **Lead names CONFIRMED.** Wyatt wrote Jeff/Dev himself on Aug 24, so `roster.json`
  is right and the "Argos/NERO swap" flag is **withdrawn** — the commit history just
  lags new assignments.
- **A season roster is car-specific** and correctly belongs in `NER27 / Software /
  App Software`. The Aug-24 instinct was right; publish it there.

### 3. ⚠ A club-wide philosophy page exists, and it contradicts the plan

**`Confluence Restructure Philosophy`** (1954349058) — **Riyana Roy** (President),
v2 **2026-07-20**, filed under `NER27 / Club Initiatives`. One day after your Jul 19 reopen.

Core rule: *"Sort every page by one question: is this true regardless of which car we
build, or is it about one specific car?"*
- **Living knowledge** → permanent home in a shared area. Stays current.
- **Vehicle record** → lives in that car's folder, freezes when the season ends.

Principles that bear directly on `Software 27`:
- **#3** Shared resources move **up out of** car folders.
- **#4** Onboarding holds only the **current version** of each path. Update in place, no "v2".
- **#7** Vehicle folders stay top-level; internal layout flexes per year.
- **#6** Outdated content moves to **Archive** (a new top-level area).

Proposed top level: Vehicle Overview · Team Info · Project Management · Engineering
Support · **Onboarding** · **Software support** (discipline knowledge) · Business ·
Templates · NER25/NER27/… · Archive.

Closing note: *"Empty sub-structure is intentional. We'll define it with each team
rather than deciding for them."* — the software sub-structure is explicitly yours to define.

**This answers the evergreen/annual question — against a year-labeled Software tree.**
Under this philosophy onboarding is club-level and evergreen, not per-season, and
App Software discipline knowledge belongs in "Software support," not in `Software 27`.

### 4. Current top level of the NER space

`Vehicles Overview` · `Project Management` · `Engineering Support` ·
`New Member Onboarding` (555581524) · `NER17` · `NER22` · `NER24` · `NER25` ·
`NER27` · `Software` (5603329, the old root) · `Business` · `NER Networking And Servers`

No `Archive`, `Team Info`, or `Templates` yet — Riyana's proposal is partly unbuilt.

### 5. Stale-item checks — all confirmed

- **`Applications Software 25`** (970162178, v3 Sep 2025) is **12 words**: *"Head: Wyatt
  Bracy · NERO Lead: Wyatt Bracy (temp) · Argos Lead: Wyatt Bracy."* You held all three
  last year — so Jeff/Dev are **new** assignments, and the "swap" I flagged may just be
  "assigned recently, no commits yet." Still confirm, but it's less alarming.
- **Punt page** (538607622, v2 Nov 2025) — still reads *"a general onboarding guide is
  not possible… your applications software lead will guide you."* Confirmed.
- **Odyssey 24A** (615874585, v1 Oct 2024) — 6 words, all macro params. Effectively empty. Confirmed.
- **Odyssey 25A** (1017610276, v2 Jul 2025) — real content (goals, automotive ethernet). Confirmed.

---

## Flags — things I'd add that weren't in your list

**1. An access/accounts page (`Start Here`).** Your "you'll need a sign-in for this"
layer, promoted to its own page. The GitHub 404-means-permissions point especially —
new members read 404 as "repo deleted" and give up.

**2. Names on the page are fine here** — you decided this in July: a yearly snapshot
archives with its tree, so it can safely carry names. That's the main advantage of
the annual model over an evergreen page.

**3. Shared prerequisites once, not twice.** Docker is common to Argos and NERO.
Duplicating setup across two onboarding pages guarantees divergence.

**4. Link out to repo docs; don't restate them.** Anything copied from a README into
Confluence is a second copy that rots. Confluence owns *orientation and access*; the
repo owns *how to build it*.

**5. Fix the two stale links rather than inheriting them** — Argos → Odyssey 24A
(empty), NERO → an unresolved shortlink. Carrying them forward ships a pre-rotted tree.

**6. ~~Blocker on lead names~~ — WITHDRAWN 2026-09-05.** The Jul 13 audit read the
Argos/NERO assignments as swapped (Jeff Kuo committing on Nero-2.0 while listed as
Argos Lead; Dev Chechi absent). The Aug-24 draft settles it: Wyatt assigned Jeff to
Argos and Dev to NERO himself. `roster.json` is correct; commits lag new leads.

Separately, `roster.json` lists a **Data Visualization Lead** for Fall 2026, but Data
Viz isn't running this season (Wyatt, 2026-09-05) — corroborated by `Ithaca`: last
push **2026-03-24**, ~5 months cold, all Yash. Drop or mark that entry when
reconciling the roster.

**7. First-contribution path should be a live query, not prose.** *Starter Ticket
Instructions* (`59637771`) is from Sep 2023. A per-repo "good first issues" link
can't go stale.

**8. Open-by-default deserves one explicit line.** Since the tree is public-to-members
by design, say so on `App Software 27` ("everything here is open to NER members; if a
page needs restricting, restrict that page"). It stops the next person from
cargo-culting restrictions onto new pages.

**9. An archive footer on each landing page.** Names the season, says "archive, don't
edit." Answers the Jul 19 archive-*trigger* question narrowly, for these pages —
enough to start without reopening the whole design.

---

## Before creating anything

1. **Verify the permissions premise.** The entire reason for top-level is that guest
   access under NER27 is bad. Check what a guest/new member actually sees at top level
   vs. under NER27 — if it inherits the same space restrictions, the move fragments
   the space and buys nothing.
2. **Coordinate with Chris.** On 2026-09-02 he claimed "the broader structure of
   software" in the `#operations` thread. Post this tree there before building.
3. ~~Resolve flag #6 (lead names)~~ — done; roster confirmed.
4. **Decide the evergreen/annual split** (§ above) — it's the one structural question
   that "everything under Software 27" opens up.

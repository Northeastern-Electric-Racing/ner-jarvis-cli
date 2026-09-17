# NER Onboarding Staleness — Running List

A living backlog of doc-vs-reality drift that NER's onboarding agent surfaces when
it runs the skills against live Confluence / GitHub / Slack. Two kinds of item:

- **`[repo:…]`** — ours to fix in *this* repo (`CLAUDE.md`, `skills/ner-roster/roster.json`, the skills).
- **`[upstream:…]`** — stale in NER's own Confluence / Slack / repo READMEs; fixing needs edits over there.

**Grounding rule this list assumes:** `roster.json` (asOf *Fall 2026*) is the trustworthy
structure source; where a doc disagrees with it, the doc is stale. People (not
structure) still get reconciled against live GitHub committers.

> **How this was built.** Six investigations, 2026-07-13: two mined onboarding
> dry-runs (`bcc94626` = "I'm new"; `2babe2b6` = the FinishLine-misclassification
> run) + four per-head-area live audits (App Software, Firmware, FinishLine,
> Software Product) applying the 8-dimension rubric at the bottom of this file.
> **To refresh:** re-run an onboarding dry-run, then re-dispatch the area audits;
> append new findings here.

**Legend:** severity **H/M/L** · provenance tags: `[AppSw] [FW] [FL] [SWProd] [setup-run] [fl-run] [confluence-sweep]`. (The Confluence dimension — previously blocked on auth — was swept read-only on 2026-07-13; see §F.)

---

## A. `[repo:CLAUDE.md]` — the biggest bucket

`CLAUDE.md` is the always-loaded context and is a full cycle behind `roster.json`
on org, leads, and channels. Any agent leaning on it (rather than the roster) misroutes.

### Org model & leadership — ✅ fixed in CLAUDE.md 2026-07-13
- [x] **H** — Was three hard-coded tracks; now **four** subteams incl. **Software Product** (Head **Layla Sheikh**, Product Lead **Jiya Bhan**). `[SWProd]`
- [x] **H** — FinishLine head → **Waverly Hassman** (was "Chris Pyle; Waverly incoming"). `[FL][setup-run]`
- [x] **H** — Stale, self-contradicting Firmware sub-lead snapshot (mis-filed Surya under Argos, omitted ~7 leads, "Emulation Lead unconfirmed") **removed** — CLAUDE.md now points sub-leads at `roster.json` instead of an inline list that rots. `[FW][AppSw]`
- [x] **M** — App-Software leads no longer inlined (were stale: Surya-under-Argos, missing Yash) — resolved by the same roster pointer. `[AppSw]`
- [x] **M** — FinishLine tech-lead list no longer inlined — resolved by the roster pointer. `[FL]`
- [x] **L** — CSE decided: **Chris Pyle** (roster `executiveBoard` → "Chief Software"; Software Charter 2026 corroborates him as doc owner). CLAUDE.md states Chris Pyle and flags the stale Peyton-McKee page. `[setup-run][fl-run][confluence-sweep]`

### Repo glossary — ✅ fixed in CLAUDE.md 2026-07-13
- [x] **H** — Split the fused **"Application Software / FinishLine track"** heading into distinct FinishLine / Application Software blocks. `[FL][AppSw][fl-run]`
- [x] **H** — Added `h5-projects-rs`, `Salamander`, and `Pythia` (tagged **Firmware despite TypeScript**). `[FW][AppSw]`
- [x] **M** — Moved `Nero-2.0` + `Ithaca` into Application Software; mapped the "Data Visualization" system → `Ithaca`. `[AppSw]`
- [x] **M** — Noted the **MQTT→Zenoh** migration in the telemetry heading. `[FW]`
- [x] **M** — Added `mqttui`. *(Minor forks — `probe-rs`, `zenoh-pico`, `nrc7292_sw_pkg`, `clang-format-action`, `gpsd_proto`, `LearningSessions` — intentionally left out to keep the always-loaded glossary lean; resolve live if needed.)* `[FW][FL]`
- [x] **M** — De-staled the Simulation block ("currently empty" dropped; visibility-re-verify noted). `[setup-run]`
- [x] **L** — Broadened `Argos` to "real-time data **processing** and visualization (Angular + Flutter + scylla-server + charybdis-schema)." `[AppSw]`
- [x] **L** — Noted "Data Visualization" is a system (→ Ithaca) and `scylla`/`siren` are services, not repos. `[AppSw][FW]`

### Slack channel list — ✅ fixed in CLAUDE.md 2026-07-13 (CLAUDE.md list only; READMEs are §D)
- [x] **H** — Dropped archived **`#software_env-setup`** from CLAUDE.md → **`#tech-support`** (live setup/access replacement, created 2026-06-30). *(FinishLine README still references it — that's §D, upstream.)* `[AppSw][FW][FL][setup-run]`
- [x] **H** — Dropped archived **`#access-requests`** (access folded into `#tech-support`). `[AppSw][FW][FL]`
- [x] **M** — Added `#tech-support` and `#software_product`. *(Narrower channels — `#software_product-requests`, `#software_application-design`, `#github_firmware`, `#software_launchpad`, `#software_rules_dashboard` — intentionally not added to always-loaded context; agents resolve channels live.)* `[AppSw][FW][SWProd]`

---

## B. `[repo:roster.json]` — people reconcile (structure is sound)

- [ ] **M** — Some leads don't match recent committers — sharpened by a 2026-07-13 live
  check: **Nero-2.0's recent commits are Jeff Kuo** (roster: *Argos* Lead) **+ Chris Pyle**,
  **Argos is all Wyatt Bracy**, and roster-NERO-lead **Dev Chechi is absent**. The
  Argos/NERO lead assignments look swapped or rotated — confirm with the people, then
  update the roster (structure stays; confirm people). `[AppSw]`
- [ ] **L** — **Peyton McKee** (roster Telemetry Lead) has no 2026 firmware commits and
  reads as alum/emeritus — and the **Embedded Software landing** (`1894416406`,
  *Jun 2026*, Caio) lists **Telemetry Lead = Jack Rubacha, Alex Houslanger** (plus
  TSECU Blake Jackson/Surya Thoppae, VCU Alex Petry, MSB Sara Sethi, Controls
  Sakthivel Sivakumar, Embedded Validation Kaushik Mehta). Reconcile the roster's
  firmware leads against that page + the people. `[FW]`

---

## C. `[repo:skill]` — the skills

- [ ] **M** — `ner-onboard` lists Software Product as a Track but then routes everyone to code-track steps (env setup, "the Track's main repo", `ner-repo-explainer`). A **product joiner owns no repo** and dead-ends. Add a product branch (surface = FinishLine + roadmap + `#software_product`). `[SWProd]`
- [ ] **L** — Skills are otherwise **clean**: grep confirms no hardcoded firmware/leadership/repo names; resolution is live + roster-driven, as intended. Keep it that way. `[FW]` *(verified-good)*

---

## D. `[upstream:GitHub]` — NER repo READMEs

- [ ] **M** — **`FinishLine/README.md`** backup contact is **`@Peyton-McKee`** (now a *Firmware* Telemetry Lead) and it points setup help at the archived **`#software_env-setup`** (verified 2026-07-13 at lines 11/15). Line 15 also links the frozen onboarding root **by ID** (`5079215`) — which argues for rewriting that root *in place* rather than archive-and-replace. Update contact → Waverly Hassman; channel → `#tech-support`. `[FL]`
- [ ] **L** — Firmware READMEs are thin/empty (`Cerberus-2.0` = title only; `TSECU-Shepherd`, `MSB-FW-2` empty) and punt entirely to Confluence — no local getting-started signal. `[FW]`

---

## E. `[upstream:Slack]` — housekeeping (informational)

- [ ] **L** — Archived App-Software channels (`#app_software`, `#software_argos`, `#software_nero`, `#software_data-viz`) still carry stale **"Head: Peyton McKee"** topics — Wyatt Bracy is the head now. `[AppSw]`
- [ ] **L** — `#software_finishline` **creator** is Sean Walker (23–24 head); `#github_firmware`/`#s_embedded-software` purposes still say **"Data & Controls"** (a pre-2022 org name). Channel-creator/topic metadata mislead any owner-by-metadata inference. `[FL][FW]`

---

## F. `[upstream:Confluence]` — swept read-only 2026-07-13 `[confluence-sweep]`

Verified against the Fall 2026 roster. The space splits into a **frozen 2023–24
layer** (names Peyton McKee as CSE + Sean Walker / Dylan Donahue as heads, routes
to archived channels, encodes the abandoned "App Software → Embedded Development"
merge) and a **current 2025–26 layer** that restores standalone teams under Chris
Pyle. These are NER-side fixes (we don't edit Confluence — read-only), so they
stay unchecked as an upstream backlog.

**Current-layer anchors (the good copies — point people here):**
- **Software Charter 2026** (`1833828362`, *Jun 2026*, owner Chris Pyle) — the live
  taxonomy: standalone **Application Software**, **FinishLine**, and **Product
  Management** under the **Chief Software Engineer**. Caveat: names **no
  individuals** and has **no "Head of Firmware" role** (still "D&C… to be changed
  to the head of firmware") — the charter itself lags the roster on Firmware.
- Live onboarding successors: **Finishline Onboarding 26-27** (`1918861314`, Jul
  2026, Waverly); **Applications Software 25** (`970162178`, Sep 2025, Wyatt — a
  roster, not a flow); **Firmware Environment Setup** (`524451844`, Jan 2026);
  **Firmware New Member Initial Onboarding** (`1427472385`, Jan 2026, Caio);
  **Telemetry Onboarding | Firmware** (`1815052291`, Jun 2026).

**Frozen / stale pages (verified):**
- [ ] **H** — **Software Onboarding** root (`5079215`, *Sep 2024*): CONFIRMED —
  "a Head, **Sean Walker for FinishLine and Dylan Donahue for Firmware**… the Chief
  Software Engineer, **Peyton McKee**"; routes to **#software_env-setup**
  (archived); only Firmware + FinishLine branches, **no App Software / Software
  Product branch**. Highest-value page to fix. `[setup-run][fl-run]`
- [ ] **H** — **Software** org page (`5603329`, *Aug 2024*): CONFIRMED — "Application
  Software team and Data & Controls… **formally merged into the Embedded
  Development team**." **Refuted by Software Charter 2026** — the merge is
  abandoned. *Coordinate, don't duplicate: a new **Org Chart** page (`1935278234`)
  appeared 2026-07-12, currently empty ("[Empty @ 7/12/26]") — the successor likely
  lives there.* `[fl-run]`
- [ ] **M** — **Applications Software Onboarding | Embedded Software** (`538607622`,
  *Nov 2025*): CONFIRMED punt — "a general onboarding guide is not possible. **Your
  applications software lead will guide you**." Title mislabels App Software as
  Embedded; no named owner. `[setup-run][AppSw]`
- [ ] **M** — **Web Dev Onboarding** (`528089090`, *Jan 2026*): CONFIRMED — title
  hides it's **FinishLine-specific**; links **archived `PM-Dashboard-v2`**; Node
  strikethrough drift (`~~14~~ ~~16~~ ~~18~~ 20`); baked-in GitHub-Classroom "no
  longer have access" workaround; routes to **#software_env-setup**. Superseded by
  Finishline Onboarding 26-27. `[fl-run][FL]`
- [ ] **M** — Year-pages superseded: **Application Software 24** (`418119745`, Sep
  2024 → **Applications Software 25** `970162178`); **Odyssey 24A** (`615874585`,
  Oct 2024 — year-stamped **and body empty**, yet linked from the Argos README —
  a real **Odyssey 25A** `1017610276` exists; repoint the README there);
  **Embedded Software 24** (`418086970`, unarchived beside 25). `[AppSw][FW]`
- [ ] **L** — **LaunchPad** (`266928130`, *Feb 2024*): CONFIRMED — self-dates
  "Currently (Spring 2024)"; a proposal doc citing "Peyton" over Application
  Software. Historical, not current process. `[fl-run]`
- [ ] **L** — **Firmware onboarding is fragmented** across ~4 current entry points
  with no canonical start: **Firmware Onboarding | Embedded Software** (`1343533`),
  **Firmware Environment Setup** (`524451844`), **Firmware New Member Initial
  Onboarding** (`1427472385`), **Telemetry Onboarding | Firmware** (`1815052291`).
  Reconcile into one path. `[FW]`
- [ ] **L** — **Software Learning Resources** (`5636100`, *Mar 2023*): stale by age
  — generic FinishLine web-dev tutorials only, nothing for firmware / telemetry /
  Qt / Rust. **Software Contributor Guide** (`8060929`, *Aug 2024*) is largely
  current but FinishLine-flavored (base branch `develop`). `[setup-run]`

**Whole-section sweep (2026-07-13, full 39-page tree under `Software` 5603329 fetched to depth 6):**
- [ ] **H** — **The front door froze; the live work is in the car trees — firmware's, mostly.** *(Reframed
  2026-07-14 after tracing the space's top level: homepage `65735` → NER17/22/24/25/27
  car-generation trees + function sections — there is no top-level Electrical section;
  every team files cycle work under the car. NERxx trees are *season* trees, not just
  the chassis — NER27 also holds Admin / Club Initiatives / General Meeting Notes —
  which is why FinishLine's 26-27 pages fit there despite not shipping on the car.
  NER27 also shifted to **one folder per team** — MECHANICAL RAHHHH `1786970113`,
  ELECTRICAL MEOW `1926037513`; both type *folder*, so the page API 404s on them —
  read contents via CQL `ancestor =`. All mech/EE 27 projects live inside them,
  incl. MSB 27 + VCU/LFIU 27 *hardware* pages whose *firmware* twins live in
  Embedded Software — the Charter's hw/sw boundary practiced per-board. NER24/25
  filed flat system branches with no team umbrellas, so folder-per-team is a NER27
  convention shift; a "Software 27" container matches it, and today's flat
  "Embedded Software"/"Web Development" branches read as two standalone teams.
  Corrected 2026-07-19 after Wyatt's catch: only "Embedded Software" is a
  historical (pre-Charter) team name — no NER team was ever called "Web
  Development". That label was coined with the folder on Jul 6 2026, and the team
  inside was never renamed: its own page is "Finishline Onboarding 26-27",
  roster.json (Fall 2026) says FinishLine, and the old section's subteam branch is
  "Finishline Team". The car-tree migration is also uneven — Embedded moved for
  real; FinishLine planted one onboarding page; App Software and Product have no
  NER27 branch at all.)* The Software section (39 pages, 33
  untouched since 2024) is the team's evergreen front door and links none of the live
  work. Software's cycle docs are branches of the **shared car trees**, siblings of
  Mechanical's/Electrical's: **NER27** `1651179525` → **Embedded Software** `1894416406`
  (*Jun 2026*, Caio — 27A pages incl. **Firmware Launchpad 26-27** `1895235617`) and
  **Web Development** `1918730241` (*Jul 6 2026* — holds **Finishline Onboarding 26-27**
  `1918861314`); **NER25** `727252999` → **Embedded Software 25** `727384068`
  (Firmware 25 `727253009` ~20 pages; **Applications Software 25** `970162178` with
  Argos 25/NERO 25; **Odyssey 25A** `1017610276`); **NER24** `318373889` → **Embedded
  Software 24** `418086970` unarchived beside 25. The "Embedded Software" name is
  pre-Charter: the 25 page defines it as "Firmware – **Electrical Team** + Applications
  Software – Software Team", and the Jul 2024 Electrical Heads notes (`471465989`)
  catch the handover mid-flight ("firmware mostly integrated with software"). Fix =
  **don't move cycle docs out of the car trees** (that's the space-wide convention);
  revive the Software section as the evergreen front door that routes to the current
  car tree, and rename NER27's software branches to the Charter's shape — one
  **Software 27** with Firmware / App Software / FinishLine (renames keep IDs).
  `[confluence-sweep]`
- [ ] **M** — **Finishline Team branch (`184877191`) frozen at Spring 2025:** six roadmap
  cycle-pages (2022 → Sp 2025) as unarchived siblings + 2024 ticket/feature stashes.
  The section's *only* subteam branch. `[FL]`
- [ ] **L** — **Two Launchpad pages**: `LaunchPad` (`266928130`, under onboarding) and
  top-level `Launchpad Web Dev` (`389447703`, Jul 2024) — duplicates of a program the
  Vision moves away from. `[confluence-sweep]`
- [ ] **L** — Aging evergreen set: **Starter Ticket Instructions** (`59637771`, Sep 2023)
  and a 2022 **Prisma FAQ** (`8749072`) nested under the general Software FAQ. `[confluence-sweep]`
- [ ] **L** — **NERSim** (`555548685`) stuck in **draft** status since Sep 2024 while
  Simulation's active work sits in the sibling folder. `[confluence-sweep]`

**Settled target design (Wyatt, 2026-07-18 — supersedes the "front door" model):**
Fully annual; no permanent Software home. `NER2X/Software/{Firmware, App Software,
FinishLine, Product}` with **onboarding per subteam**; the Software landing page is a
yearly snapshot (head, leads, pick-a-subteam — names are fine there, it archives with
its tree). Members-only like the rest of NER2X — no public tier (recruiting lives on
the website/GitHub; new members need Confluence access day one). The **Shared Resources** folder (the
evergreen minimum: env setup, system docs, Charter) **moves — never copies —
forward** each handoff so page IDs survive; durable artifacts (READMEs, pins) only link evergreen IDs or write
the path as text. Two archive triggers: **supersede** (archive the predecessor in the
same sitting) and **retire** (car retires → the year's whole Software branch archives;
two live car trees is normal, three is rot). Old top-level Software section: tombstone
the two README-linked roots (`5603329`, `5079215`), then archive the entire section —
nothing permanent remains. Verify nerdocs' plan includes page archiving before the
sweep.

**2026-07-19 — archiving model REOPENED (Wyatt: "start fresh, high level").** The
trigger/year-stamp design above is no longer settled; the page now carries only a
placeholder: **everything not kept moves into a new top-level `Archive` folder**
(plain Confluence moves — IDs and links survive; no dependence on the paid archive
feature, so that caveat is dropped). Unit discussion so far: proposed archive-unit =
the *subteam's* year branch (page-level fails culturally — 33/39 untouched; whole
year tree isn't Software's to pull; subteams close seasons on two different clocks —
firmware follows the car, FinishLine/Product the academic year). Preconditions named:
evergreen content must be evacuated to Shared Resources first; mid-season husks need
a rule. Purpose + trigger not yet discussed. Six rules on the page are now five
(triggers row deleted).

**Two structural gaps (no page exists — itself the finding):**
- [ ] **H** — **No current Application Software onboarding page.** The only
  App-Software artifact is the punt (`538607622`); no "26-27"-style flow exists, so
  new App-Software members have no landing path. `[AppSw][setup-run]`
- [ ] **M** — **No Software Product subteam page.** Layla Sheikh's Product subteam
  is defined only *inside* Software Charter 2026 ("Head of Product Management"). No
  "Product Team" page exists; the old Product docs (**Software Product Management**
  `13828116` 2023, **Scavenger Hunt** `25952257` 2022) are stale FinishLine-product
  docs that never described a subteam. *Already in motion: Chris pinged Layla for
  status on "the product confluence doc" 2026-07-07 (heads channel); nothing had
  landed as of 2026-07-13.* `[SWProd]`

**REFUTED — earlier PENDING suspicions that were wrong (don't chase):**
- `524451844` is **not** a stale "2024 Firmware Onboarding Master" — it was
  **renamed "Firmware Environment Setup"** and is current (Jan 2026).
- `108888108` is **not** an STM32 page — renamed **"Setting Up Docker"**,
  semi-deprecated but self-flags it ("phased out… see NER Build System").
- CSE naming: roster's **Chris Pyle confirmed live** (Charter 2026 doc owner); only
  the frozen pages still say Peyton McKee.

---

## Verified-good / false alarms — do **not** "fix"

- `roster.json` structure is trustworthy across all four areas (FinishLine & Firmware blocks corroborated by live committers + Slack). Drift is one-directional: CLAUDE.md/READMEs/Confluence lag the roster.
- **`ProteusMC`, `Polyphemus`, `nermoni` are all live/public** (not archived) — the earlier "absent" suspicion was a truncated-view artifact; glossary entries are correct.
- `FinishLine` repo glossary entry ("PM Dashboard v5") is accurate; `PM-Dashboard-v2` (and v1) correctly *absent* from the glossary — they're archived.
- Skills carry no hardcoded names (live + roster-driven).
- `#s_embedded-software`, `#software`, `#software_pr-review`, `#software_finishline` are live and correctly listed.

---

## The staleness rubric (8 dimensions — reusable anywhere)

1. **Leadership currency** — heads/leads/CSE in docs vs live roster + GitHub committers.
2. **Org-structure currency** — doc team/track boundaries vs roster subteams; merges/renames/new/dissolved; cross-page contradictions.
3. **Doc recency & completeness** — lastModified age, year-stamped titles, empty/"ask your lead" pages, a track with no landing branch.
4. **Glossary ⇄ GitHub drift (both ways)** — active repos missing from the glossary; glossary repos gone/archived/renamed; description/language/"empty-new" drift.
5. **Dead links & version drift** — docs pointing at gone repos/channels/tools; stale version pins; baked-in bug workarounds.
6. **Slack channel currency** — doc-named channels archived/renamed; live channels no doc mentions.
7. **Onboarding-path viability** — a coherent, current, stack-appropriate getting-started path, or a dead-end / borrowed one.
8. **Shipped grounding-truth drift** — `CLAUDE.md`, `roster.json`, skill glossary vs live.

## Sources mined (2026-07-13)

- Onboarding dry-run `bcc94626` ("I'm new" → Application Software) — `[setup-run]`
- Onboarding dry-run `2babe2b6` (FinishLine-misclassification run) — `[fl-run]`
- Area audits: Application Software `[AppSw]`, Firmware `[FW]`, FinishLine `[FL]`, Software Product `[SWProd]`
- Confluence read-only page-sweep (~14 pages, IDs above) — `[confluence-sweep]`

*Read-only audits; no NER systems or repos were modified.*

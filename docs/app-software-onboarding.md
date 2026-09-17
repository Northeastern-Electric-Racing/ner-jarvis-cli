# App Software — Getting Oriented

> Owner: Head of Application Software · Last Revision: 2026-09-05 · Version: 1 · Applies To: Season 27

This page is about **the club and the people** — who we are, who we work with, and how
we operate. It is deliberately short.

It is **not** setup instructions, architecture, or how to pick up a ticket. Those live on
the Argos and NERO pages, and you'll be pointed there once you're through orientation.

---

## What NER is

Northeastern Electric Racing builds a new electric formula car every year and races it
in Formula SAE. One car per season, named by year — **27** is the car being built now.
"Not under 27" means "not current."

Five divisions: **Mechanical, Electrical, Software, Business, Operations.** Everyone is
a student, everyone is a volunteer, and the car has a hard deadline that doesn't move.

## Where App Software sits

You're in the **Software** division (Chief: Chris Pyle). It has four subteams:

| Subteam | What it does |
| --- | --- |
| **Application Software** | Argos and NERO — the software people use to see and drive the car |
| **Firmware** | The code running on the boards in the car |
| **FinishLine** | The project-management platform the whole club runs on |
| **Software Product** | Product and roadmap across all of the above |

Inside App Software there are two systems:

- **Argos** — how anyone outside the car sees what the car is doing. Live at the track,
  and after the fact.
- **NERO** — what the driver sees from inside the car.

You'll be assigned to one. Working on the other later is normal and encouraged.

## Who we work with

App Software sits between the car and everyone who needs to understand it. That means we
are almost never the only team in a conversation.

<!-- TODO(Wyatt): this table is the part that can't be sourced from anywhere else.
     Fill in / correct each row — especially "what we owe them", since that's what a new
     member actually needs to know before their first cross-team conversation. -->

| Team | What we get from them | What they get from us |
| --- | --- | --- |
| **Firmware** | The data the car actually emits, and what each signal means | ? |
| **Electrical** | ? | ? |
| **Mechanical / Vehicle Dynamics** | ? | ? |
| **FinishLine** | The platform we plan and track work in | ? |
| **Software Product** | ? | ? |
| **Operations** | Confluence, accounts, club process | ? |

Two things worth internalizing now:

1. **We are a service team as much as a build team.** Someone asking "can Argos show me
   X?" is a real requirement, not an interruption.
2. **Nobody outside App Software has to know how our software works** — that's on us to
   explain in their terms, not theirs to learn.

## How we communicate

**Post publicly. Don't DM.** This is a club-wide rule and it's the one we care about most.
A DM helps one person; the same question in a channel helps the next five people who hit
it, and it doesn't die when a lead is busy.

| Channel | Use it for |
| --- | --- |
| `#s_embedded-software` | All App Software (and embedded) development talk — this is your home channel |
| `#software_launchpad` | New members across all software teams |
| `#tech-support` | Access, accounts, tooling, "I can't get into X" |
| `#software` | Software-wide announcements |
| `#software_product-requests` | Feature requests for any NER software |
| `#active-members` | Club-wide |

Work is planned and tracked in **FinishLine** (`finishlinebyner.com`), under the **Argos 27**
and **NERO 27** projects. Docs live in **Confluence**. Code lives in the
`Northeastern-Electric-Racing` GitHub org.

## What we expect

- **Come to the weekly App Software meeting.** It's the main thing. If you can only do one
  thing, do this one.
- **Roughly 5 hours a week** as a new member. (Source: Software Charter 2026.)
- **Say something when you're stuck** — same day, in channel. Being stuck quietly for a
  week is the single most common way people fall off.
- **Tell someone when you can't make it.** Life happens; silence is the problem, not absence.

## Your first few weeks

1. **Meet the Chief chat** — a five-minute conversation with Chris. Part of club recruitment.
2. **Software onboarding kickoff** — one session, club-wide software context.
3. **Start coming to the App Software weekly meeting.** You're handed over early on purpose:
   you'll learn more sitting in a room with people doing the work than in another lecture.
4. **Get your accounts and dev environment set up** → see the Argos / NERO onboarding pages.
5. **Pick up a first ticket.**

## Who to ask

Ask in channel first. If you need a person:

| | |
| --- | --- |
| **Head of Application Software** | Wyatt Bracy |
| **Argos Lead** | Jeff Kuo |
| **NERO Lead** | Dev Chechi |
| **Chief Software** | Chris Pyle |

Escalation goes lead → head → chief. You will not annoy anyone by asking too early.

---

<!-- OPEN QUESTIONS before this goes on Confluence:
  1. "Who we work with" table above.
  2. Weekly App Software meeting: day/time/place — not yet set for FL26 as far as I can tell.
  3. Are the Vision doc's two-week ticket cycle and three-strike policy actually in force
     for 26-27, or still proposals? Left out of "What we expect" until confirmed.
  4. Confirm Argos/NERO lead assignments (from your 2026-08-24 draft; roster.json still
     lists a Data Visualization lead that appears unstaffed this season).
-->

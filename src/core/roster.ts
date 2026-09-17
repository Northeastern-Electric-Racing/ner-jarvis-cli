import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { skillsDir } from "./paths";
import { loadPayload } from "./payload";

/**
 * The NER leadership roster (`skills/ner-roster/roster.json`) is the grounding
 * truth for org STRUCTURE and nominal ownership. It ships as a data-only skill
 * dir, landing at `~/.claude/skills/ner-roster/roster.json`, where the NER
 * skills read it directly.
 *
 * This module is the *programmatic* query path: flatten the hierarchy into rows
 * and filter them in plain JS — no database, no deps, identical behavior under
 * the Bun binary and the Node/npx channel.
 */

export interface RosterLead {
  role: string;
  name: string;
}
export interface RosterSubteam {
  name: string;
  head?: string;
  leads?: RosterLead[];
}
export interface RosterArea {
  area: string;
  chief?: string | null;
  subteams?: RosterSubteam[];
  leads?: RosterLead[];
}
export interface RosterDoc {
  asOf?: string;
  source?: string;
  note?: string;
  executiveBoard?: RosterLead[];
  areas?: RosterArea[];
}

/** One flattened, queryable row. `subteam` is "" for area-level / exec-board rows. */
export interface RosterRow {
  area: string;
  subteam: string;
  role: string;
  name: string;
  isHead: boolean;
}

const EXEC_BOARD = "Executive Board";

/**
 * Read the roster document: the user's installed copy
 * (`~/.claude/skills/ner-roster/roster.json`) wins if present — they maintain
 * it — otherwise fall back to the copy embedded in this build. Throws only if
 * neither source has it (misbuilt payload).
 */
export function loadRosterDoc(): RosterDoc {
  const installed = join(skillsDir(), "ner-roster", "roster.json");
  if (existsSync(installed)) return JSON.parse(readFileSync(installed, "utf8")) as RosterDoc;

  const skill = loadPayload().skills.find((s) => s.name === "ner-roster");
  const file = skill?.files.find((f) => f.path === "roster.json");
  if (!file) throw new Error("roster.json is not installed and not embedded in this build.");
  return JSON.parse(file.contents) as RosterDoc;
}

/** Flatten the hierarchy into rows. */
export function flattenRoster(doc: RosterDoc): RosterRow[] {
  const rows: RosterRow[] = [];
  for (const e of doc.executiveBoard ?? [])
    rows.push({ area: EXEC_BOARD, subteam: "", role: e.role, name: e.name, isHead: false });

  for (const a of doc.areas ?? []) {
    for (const s of a.subteams ?? []) {
      if (s.head) rows.push({ area: a.area, subteam: s.name, role: "Head", name: s.head, isHead: true });
      for (const l of s.leads ?? [])
        rows.push({ area: a.area, subteam: s.name, role: l.role, name: l.name, isHead: false });
    }
    for (const l of a.leads ?? [])
      rows.push({ area: a.area, subteam: "", role: l.role, name: l.name, isHead: false });
  }
  return rows;
}

/**
 * Keep rows matching EVERY term (case-insensitive substring across
 * area+subteam+role+name). No terms → all rows.
 */
export function queryRoster(rows: RosterRow[], terms: string[]): RosterRow[] {
  const needles = terms.map((t) => t.toLowerCase()).filter(Boolean);
  if (!needles.length) return rows.slice();
  return rows.filter((r) => {
    const hay = `${r.area} ${r.subteam} ${r.role} ${r.name}`.toLowerCase();
    return needles.every((n) => hay.includes(n));
  });
}

// --- Semantic finders -------------------------------------------------------
// Named lookups over flattened rows, so callers ask for what they mean ("head
// of Firmware", "leads of FinishLine", "who owns Argos") instead of guessing at
// substrings. All are case-insensitive and pure.

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const has = (hay: string, needle: string) => hay.toLowerCase().includes(needle.toLowerCase());

/** Convenience: read + flatten the roster in one call. */
export function loadRosterRows(): RosterRow[] {
  return flattenRoster(loadRosterDoc());
}

/** Every subteam head. */
export function heads(rows: RosterRow[]): RosterRow[] {
  return rows.filter((r) => r.isHead);
}

/** The head of a subteam (exact subteam-name match). */
export function headOf(rows: RosterRow[], subteam: string): RosterRow | undefined {
  return rows.find((r) => r.isHead && eq(r.subteam, subteam));
}

/** The non-head leads of a subteam (exact subteam-name match). */
export function leadsOf(rows: RosterRow[], subteam: string): RosterRow[] {
  return rows.filter((r) => !r.isHead && eq(r.subteam, subteam));
}

/** Everyone in an area (exact area-name match). */
export function inArea(rows: RosterRow[], area: string): RosterRow[] {
  return rows.filter((r) => eq(r.area, area));
}

/** Everyone in a subteam — its head plus its leads (exact subteam-name match). */
export function inSubteam(rows: RosterRow[], subteam: string): RosterRow[] {
  return rows.filter((r) => eq(r.subteam, subteam));
}

/** People holding a role (exact role match, e.g. "Telemetry Lead"). */
export function byRole(rows: RosterRow[], role: string): RosterRow[] {
  return rows.filter((r) => eq(r.role, role));
}

/** Every role a person holds (substring name match; catches cross-team folks). */
export function byPerson(rows: RosterRow[], name: string): RosterRow[] {
  return rows.filter((r) => has(r.name, name));
}

/**
 * A "system" is the subject of a "… Lead" role — the thing a lead owns:
 * systemName("Argos Lead") → "Argos", "VCU Lead" → "VCU". Returns undefined for
 * "Head" and any role that isn't a "… Lead".
 */
export function systemName(role: string): string | undefined {
  const m = /^(.*\S)\s+Lead$/i.exec(role.trim());
  return m ? m[1] : undefined;
}

/** Distinct systems, optionally scoped to an area and/or subteam. Sorted. */
export function systems(rows: RosterRow[], scope?: { area?: string; subteam?: string }): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    if (scope?.area && !eq(r.area, scope.area)) continue;
    if (scope?.subteam && !eq(r.subteam, scope.subteam)) continue;
    const s = systemName(r.role);
    if (s) set.add(s);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Who leads a system — rows whose system (role minus "Lead") matches by substring. */
export function systemOwners(rows: RosterRow[], system: string): RosterRow[] {
  return rows.filter((r) => {
    const s = systemName(r.role);
    return s ? has(s, system) : false;
  });
}

/** An area's chief (from the doc; the same person often also sits on the exec board). */
export function chiefOf(doc: RosterDoc, area: string): string | undefined {
  return (doc.areas ?? []).find((a) => eq(a.area, area))?.chief ?? undefined;
}

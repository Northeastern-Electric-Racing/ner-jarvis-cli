import {
  loadRosterDoc,
  flattenRoster,
  queryRoster,
  heads,
  headOf,
  leadsOf,
  systems,
  systemOwners,
  byPerson,
  type RosterRow,
} from "../core/roster";

export interface RosterReport {
  ok: boolean;
  lines: string[];
}

export interface RosterOpts {
  targets: string[];
  json?: boolean;
}

const ROW_COLS = ["area", "subteam", "role", "name"];

/** Sub-verbs that map to semantic finders; anything else is a free-text search. */
const VERBS = new Set(["heads", "head", "leads", "systems", "system", "who"]);

/** Render row objects as an aligned text table over the given columns. */
function table(rows: Record<string, unknown>[], columns: string[]): string[] {
  if (!rows.length) return [];
  const cell = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
  const fmt = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i]!)).join("  ").trimEnd();
  const out = [fmt(columns.map((c) => c.toUpperCase()))];
  for (const r of rows) out.push(fmt(columns.map((c) => cell(r[c]))));
  return out;
}

/** Standard result shape for a row-returning query: JSON, or header + count + table. */
function rowsResult(header: string, rows: RosterRow[], json?: boolean): RosterReport {
  if (json) return { ok: true, lines: [JSON.stringify(rows, null, 2)] };
  const count = `${rows.length} match${rows.length === 1 ? "" : "es"}`;
  if (!rows.length) return { ok: true, lines: [`${header} — ${count}`, "(nothing found)"] };
  return { ok: true, lines: [`${header} — ${count}`, "", ...table(rows as unknown as Record<string, unknown>[], ROW_COLS)] };
}

/**
 * Query the NER leadership roster.
 *
 *   ner-jarvis roster [term…]        free-text search (AND of terms)
 *   ner-jarvis roster heads          every subteam head
 *   ner-jarvis roster head <team>    the head of a subteam
 *   ner-jarvis roster leads <team>   the leads of a subteam
 *   ner-jarvis roster systems [scope] distinct systems (optionally within a scope)
 *   ner-jarvis roster system <name>  who leads a system (e.g. Argos, VCU)
 *   ner-jarvis roster who <name>     every role a person holds
 *
 * `--json` emits JSON for any of the above.
 */
export function roster(opts: RosterOpts): RosterReport {
  const doc = loadRosterDoc();
  const rows = flattenRoster(doc);
  const asOf = doc.asOf ? ` (as of ${doc.asOf})` : "";

  const [maybeVerb, ...rest] = opts.targets;
  const verb = maybeVerb?.toLowerCase();
  const arg = rest.join(" ").trim();

  if (verb && VERBS.has(verb)) {
    switch (verb) {
      case "heads":
        return rowsResult(`NER heads${asOf}`, heads(rows), opts.json);
      case "systems": {
        const scoped = arg ? queryRoster(rows, [arg]) : rows;
        const list = systems(scoped);
        if (opts.json) return { ok: true, lines: [JSON.stringify(list, null, 2)] };
        const header = `NER systems${arg ? ` in "${arg}"` : ""}${asOf} — ${list.length}`;
        return { ok: true, lines: list.length ? [header, "", ...list.map((s) => `  ${s}`)] : [header, "(none found)"] };
      }
      // Singular verbs need an argument; without one, fall through to a plain search.
      case "head":
        if (arg) { const h = headOf(rows, arg); return rowsResult(`Head of ${arg}${asOf}`, h ? [h] : [], opts.json); }
        break;
      case "leads":
        if (arg) return rowsResult(`Leads of ${arg}${asOf}`, leadsOf(rows, arg), opts.json);
        break;
      case "system":
        if (arg) return rowsResult(`Owner(s) of "${arg}"${asOf}`, systemOwners(rows, arg), opts.json);
        break;
      case "who":
        if (arg) return rowsResult(`${arg}${asOf}`, byPerson(rows, arg), opts.json);
        break;
    }
  }

  // Default: free-text search across area+subteam+role+name.
  const matched = queryRoster(rows, opts.targets);
  if (opts.json) return { ok: true, lines: [JSON.stringify(matched, null, 2)] };
  const header = `NER roster${asOf} — ${matched.length} match${matched.length === 1 ? "" : "es"}`;
  if (!matched.length) {
    return { ok: true, lines: [header, "(no matches — try a broader term, or `ner-jarvis roster` for everything)"] };
  }
  return { ok: true, lines: [header, "", ...table(matched as unknown as Record<string, unknown>[], ROW_COLS)] };
}

export function printRoster(r: RosterReport): void {
  for (const l of r.lines) console.log(l);
}

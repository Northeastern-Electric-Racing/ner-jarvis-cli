import {
  CURRENT_STALE_SCHEMA_VERSION,
  RUBRIC,
  TARGET_KINDS,
  VERDICTS,
  appendStaleReport,
  exportMarkdown,
  localReporter,
  markSent,
  newReportId,
  readStaleReports,
  triageOrder,
  writeStaleReports,
} from "../core/stale";
import type { Prompter } from "../core/prompt";
import type { StaleReport, StaleTargetKind, StaleVerdict } from "../types";

export interface StaleReport_ { ok: boolean; lines: string[] }
export interface StaleOpts {
  targets: string[];
  options: Record<string, string>;
  json?: boolean;
  toolVersion?: string;
}
export interface StaleDeps {
  prompter?: Prompter;
  isTTY?: boolean;
  now?: () => Date;
  reporter?: () => string;
}

const VERB_HELP = [
  "ner-jarvis stale add [flags]     record a doc that misled you",
  "ner-jarvis stale list            show what you've recorded",
  "ner-jarvis stale export          paste-ready markdown to share",
  "ner-jarvis stale rm <id>         drop one report",
  "",
  "add flags:",
  "  --url=U --title=T --kind=K     K: " + TARGET_KINDS.join(" | "),
  "  --verdict=V                    V: " + Object.keys(VERDICTS).join(" | "),
  "  --dimension=N                  1-8, the staleness rubric",
  "  --wrong=MSG                    what the page claims that isn't so",
  "  --true=MSG                     what's actually true (optional)",
  "  --successor=URL                the newer page (verdict=superseded)",
  "  --blocked                      you couldn't proceed",
  "",
  "list/export flags:  --unsent   export also: --mark-sent   both: --json",
];

/** One line per report, for `list`. */
function line(r: StaleReport): string {
  const flags = [r.blockedMe ? "blocked" : "", r.sent ? `sent→${r.sent.sink}` : ""].filter(Boolean).join(" ");
  return `${r.id}  ${r.verdict.padEnd(15)} ${(r.target.title || r.target.url).slice(0, 52).padEnd(52)} ${flags}`.trimEnd();
}

/**
 * Build a report from flags, falling back to prompts on a TTY for anything missing.
 * Returns null when a required field can't be resolved (non-interactive + no flag).
 */
function buildReport(o: Record<string, string>, deps: StaleDeps, toolVersion: string): StaleReport | string {
  const ask = (q: string, dflt = "") =>
    deps.isTTY && deps.prompter ? deps.prompter.askPath(q, dflt).trim() : dflt;

  const url = o.url ?? ask("Link to the page:");
  if (!url) return "a --url is required (or run on a TTY to be prompted)";
  const whatIsWrong = o.wrong ?? ask("What does it say that isn't true?");
  if (!whatIsWrong) return "a --wrong description is required — a bare link isn't actionable";

  const kindRaw = (o.kind ?? ask("Kind", "confluence")) as StaleTargetKind;
  const kind: StaleTargetKind = TARGET_KINDS.includes(kindRaw) ? kindRaw : "confluence";

  const successor = o.successor ?? "";
  // The successor check IS the verdict: if a newer page is findable the reader can
  // route around this one; if not, they'll follow it. Honor an explicit --verdict,
  // otherwise infer from whether a successor was supplied.
  const verdictRaw = o.verdict as StaleVerdict | undefined;
  const verdict: StaleVerdict =
    verdictRaw && verdictRaw in VERDICTS ? verdictRaw : successor ? "superseded" : "orphan-current";

  const dim = Number(o.dimension ?? ask("Rubric dimension 1-8", "3"));
  return {
    staleSchemaVersion: CURRENT_STALE_SCHEMA_VERSION,
    id: newReportId(deps.now?.() ?? new Date()),
    ts: (deps.now?.() ?? new Date()).toISOString(),
    toolVersion,
    verdict,
    dimension: Number.isFinite(dim) && dim >= 1 && dim <= 8 ? dim : 3,
    target: { kind, url, title: o.title ?? ask("Page title:") },
    successor: successor || undefined,
    whatIsWrong,
    whatIsTrue: o.true || undefined,
    blockedMe: o.blocked === "true",
    reporter: (deps.reporter ?? localReporter)(),
    sent: null,
  };
}

/**
 * Record and review docs that misled you.
 *
 * Local-first by design: `stale.jsonl` never leaves the machine until you run
 * `export` and paste the result somewhere. Slack and FinishLine sinks come later;
 * the record shape is already the payload either of them will carry.
 */
export function stale(opts: StaleOpts, deps: StaleDeps = {}): StaleReport_ {
  const [verb = "list", ...rest] = opts.targets;
  const o = opts.options ?? {};
  const toolVersion = opts.toolVersion ?? "";
  const unsentOnly = o.unsent === "true";

  switch (verb) {
    case "add": {
      const built = buildReport(o, deps, toolVersion);
      if (typeof built === "string") return { ok: false, lines: [`✗ ${built}`, "", ...VERB_HELP] };
      appendStaleReport(built);
      return {
        ok: true,
        lines: opts.json
          ? [JSON.stringify(built, null, 2)]
          : [`✓ recorded ${built.id} — ${built.verdict}`,
             `  ${built.target.title || built.target.url}`,
             `  ${readStaleReports().filter((r) => !r.sent).length} unsent report(s). \`ner-jarvis stale export\` when you're ready.`],
      };
    }

    case "list": {
      let all = triageOrder(readStaleReports());
      if (unsentOnly) all = all.filter((r) => !r.sent);
      if (opts.json) return { ok: true, lines: [JSON.stringify(all, null, 2)] };
      if (!all.length) return { ok: true, lines: ["No stale-doc reports recorded."] };
      const head = `${all.length} report${all.length === 1 ? "" : "s"}` + (unsentOnly ? " (unsent)" : "");
      return { ok: true, lines: [head, "", ...all.map(line)] };
    }

    case "export": {
      let all = readStaleReports();
      if (unsentOnly) all = all.filter((r) => !r.sent);
      if (opts.json) return { ok: true, lines: [JSON.stringify(triageOrder(all), null, 2)] };
      const md = exportMarkdown(all, toolVersion);
      const lines = [md];
      if (o["mark-sent"] === "true" && all.length) {
        const n = markSent(new Set(all.map((r) => r.id)), "manual", (deps.now?.() ?? new Date()).toISOString());
        lines.push("", `— marked ${n} report(s) sent.`);
      }
      return { ok: true, lines };
    }

    case "rm": {
      const id = rest[0];
      if (!id) return { ok: false, lines: ["✗ which one? `ner-jarvis stale rm <id>` (see `stale list`)"] };
      const all = readStaleReports();
      const kept = all.filter((r) => r.id !== id);
      if (kept.length === all.length) return { ok: false, lines: [`✗ no report with id ${id}`] };
      writeStaleReports(kept);
      return { ok: true, lines: [`✓ removed ${id}`] };
    }

    default:
      return { ok: false, lines: [`✗ unknown: stale ${verb}`, "", ...VERB_HELP] };
  }
}

export function printStale(r: StaleReport_): void {
  for (const l of r.lines) (r.ok ? console.log : console.error)(l);
}

export { RUBRIC };

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { nerJarvisHome, staleFile } from "./paths";
import type { StaleReport, StaleSent, StaleTargetKind, StaleVerdict } from "../types";

export const CURRENT_STALE_SCHEMA_VERSION = 1;

/**
 * The 8-dimension staleness rubric from `docs/onboarding-staleness.md`, reused verbatim
 * so a member's report lands in the same bucket as the maintainer audits and the two
 * lists can merge without a translation step.
 */
export const RUBRIC: Record<number, string> = {
  1: "Leadership currency",
  2: "Org-structure currency",
  3: "Doc recency & completeness",
  4: "Glossary ⇄ GitHub drift",
  5: "Dead links & version drift",
  6: "Slack channel currency",
  7: "Onboarding-path viability",
  8: "Shipped grounding-truth drift",
};

export const TARGET_KINDS: StaleTargetKind[] = [
  "confluence", "github", "slack", "repo", "skill", "other",
];

/**
 * The two verdicts worth recording.
 *
 * Staleness is **relational, not chronological**: a page is stale iff a reader could
 * mistake it for current AND acting on it would be wrong. A doc describing how
 * something was built before is a *historical record* — it reads as past, so it is
 * never stale and is deliberately absent from this enum. The successor check is what
 * separates the two that remain.
 */
export const VERDICTS: Record<StaleVerdict, string> = {
  "orphan-current": "wrong, and no findable successor — a member will follow it",
  "superseded": "wrong, but a newer version is discoverable",
};

/** Sort key: the verdict a member will actually be misled by comes first. */
const VERDICT_RANK: Record<StaleVerdict, number> = { "orphan-current": 0, "superseded": 1 };

/**
 * Ordered, pure schema transforms indexed by from-version, mirroring `state.ts`:
 * `SCHEMA_MIGRATIONS[n]` takes a shape at `staleSchemaVersion === n` and returns
 * `n+1`. No filesystem, no side effects.
 *
 *   [0]: v0 (or absent) → v1 — coerce any prior/unknown shape without dropping data.
 */
const SCHEMA_MIGRATIONS: ((raw: any) => any)[] = [
  (raw) => ({ ...raw }),
];

/** Coerce any prior/unknown-shaped record to the current schema without dropping data. */
export function migrateStaleReport(raw: any): StaleReport {
  let cur: any = raw ?? {};
  let from = typeof cur.staleSchemaVersion === "number" ? cur.staleSchemaVersion : 0;
  while (from < CURRENT_STALE_SCHEMA_VERSION) {
    const step = SCHEMA_MIGRATIONS[from];
    if (!step) break;
    cur = step(cur);
    from += 1;
  }
  const kind: StaleTargetKind = TARGET_KINDS.includes(cur?.target?.kind) ? cur.target.kind : "other";
  const verdict: StaleVerdict = cur?.verdict === "superseded" ? "superseded" : "orphan-current";
  const dimension = Number(cur?.dimension);
  return {
    staleSchemaVersion: CURRENT_STALE_SCHEMA_VERSION,
    id: String(cur?.id ?? ""),
    ts: String(cur?.ts ?? ""),
    toolVersion: String(cur?.toolVersion ?? ""),
    verdict,
    dimension: dimension >= 1 && dimension <= 8 ? dimension : 3,
    target: {
      kind,
      url: String(cur?.target?.url ?? ""),
      title: String(cur?.target?.title ?? ""),
    },
    successor: cur?.successor ? String(cur.successor) : undefined,
    whatIsWrong: String(cur?.whatIsWrong ?? ""),
    whatIsTrue: cur?.whatIsTrue ? String(cur.whatIsTrue) : undefined,
    blockedMe: cur?.blockedMe === true,
    reporter: String(cur?.reporter ?? ""),
    sent: cur?.sent && typeof cur.sent === "object"
      ? { sink: String(cur.sent.sink ?? ""), at: String(cur.sent.at ?? ""), ref: cur.sent.ref ? String(cur.sent.ref) : undefined }
      : null,
  };
}

/**
 * Who filed this, for a maintainer triaging the export.
 *
 * The local git `user.name` — deliberately **never** the email. A report is a note
 * about a wiki page, not a reason to put someone's address in a file that gets pasted
 * into Slack.
 */
export function localReporter(): string {
  try {
    const n = execFileSync("git", ["config", "user.name"], { encoding: "utf8", env: process.env }).trim();
    if (n) return n;
  } catch {
    // no git identity configured — fall through
  }
  try { return userInfo().username; } catch { return "unknown"; }
}

/** Sortable, collision-resistant id. No dependency: timestamp prefix + random suffix. */
export function newReportId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const rand = Math.random().toString(16).slice(2, 8);
  return `${stamp}-${rand}`;
}

/**
 * Read every recorded report. Tolerant by design: a corrupt line is skipped rather
 * than failing the command, because a member's backlog of findings must never be
 * held hostage to one bad write.
 */
export function readStaleReports(): StaleReport[] {
  if (!existsSync(staleFile())) return [];
  const out: StaleReport[] = [];
  for (const line of readFileSync(staleFile(), "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(migrateStaleReport(JSON.parse(line))); } catch { /* skip a corrupt line */ }
  }
  return out;
}

/** Append one report. Never throws — a failed write must not lose the member's turn. */
export function appendStaleReport(r: StaleReport): void {
  mkdirSync(nerJarvisHome(), { recursive: true });
  appendFileSync(staleFile(), JSON.stringify(r) + "\n");
}

/** Rewrite the whole log — used by `rm` and by marking a batch sent. */
export function writeStaleReports(reports: StaleReport[]): void {
  mkdirSync(nerJarvisHome(), { recursive: true });
  writeFileSync(staleFile(), reports.map((r) => JSON.stringify(r)).join("\n") + (reports.length ? "\n" : ""));
}

/** Stamp `sent` on the given ids. Returns how many changed. */
export function markSent(ids: Set<string>, sink: string, at = new Date().toISOString()): number {
  const all = readStaleReports();
  let n = 0;
  for (const r of all) {
    if (!ids.has(r.id) || r.sent) continue;
    r.sent = { sink, at };
    n += 1;
  }
  if (n) writeStaleReports(all);
  return n;
}

/** Most-misleading first, then newest first — the order a maintainer wants to triage in. */
export function triageOrder(reports: StaleReport[]): StaleReport[] {
  return [...reports].sort((a, b) =>
    VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] ||
    Number(b.blockedMe) - Number(a.blockedMe) ||
    b.ts.localeCompare(a.ts));
}

/**
 * Render reports as a paste-ready Slack/Confluence block.
 *
 * This is the Phase 1 delivery mechanism on purpose: the member copies it into the
 * team's support channel. Nothing leaves the machine until they do. No channel name
 * is baked in here — channels get renamed and archived, which is the same drift this
 * feature exists to catch.
 */
export function exportMarkdown(reports: StaleReport[], toolVersion = ""): string {
  if (!reports.length) return "No stale-doc reports recorded.";
  const ordered = triageOrder(reports);
  const who = ordered[0]!.reporter || "unknown";
  const head = `**Stale docs — ${ordered.length} report${ordered.length === 1 ? "" : "s"}** ` +
    `(from ${who}${toolVersion ? `, ner-jarvis ${toolVersion}` : ""})`;
  const body = ordered.map((r, i) => {
    const lines = [
      `${i + 1}. **${r.verdict}** · ${r.target.title || "(untitled)"}${r.blockedMe ? " · _blocked me_" : ""}`,
      `   ${r.target.url}`,
      `   ${RUBRIC[r.dimension] ?? "Uncategorized"} (rubric ${r.dimension})`,
      `   Wrong: ${r.whatIsWrong}`,
    ];
    if (r.whatIsTrue) lines.push(`   True:  ${r.whatIsTrue}`);
    if (r.successor) lines.push(`   Newer: ${r.successor}`);
    return lines.join("\n");
  }).join("\n\n");
  return `${head}\n\n${body}`;
}

export type { StaleReport, StaleSent, StaleTargetKind, StaleVerdict };

import type { EmbeddedPayload } from "../types";
import { converge } from "./converge";
import type { RunSummary } from "../core/report";
import { CHANNEL } from "../channel";

/** True if semver-ish `a` is strictly newer than `b` (leading "v" ignored). */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pa = parse(a), pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** A human notice if a newer release exists, else null. Pure (no network). */
export function newerReleaseNotice(latest: string | null, current: string): string | null {
  if (!latest || !isNewer(latest, current)) return null;
  return `A newer ner-jarvis release is available: ${latest} (you have ${current}). Download it from GitHub Releases; this run continues with the current version.`;
}

export interface UpdateOpts { targets: string[]; force: boolean; dryRun: boolean; }
export interface UpdateDeps { channel?: "binary" | "npm"; getLatestReleaseTag?: () => string | null; }

export function update(payload: EmbeddedPayload, opts: UpdateOpts, deps: UpdateDeps = {}): RunSummary {
  const channel = deps.channel ?? CHANNEL;
  if (channel === "binary") {
    const notice = newerReleaseNotice(deps.getLatestReleaseTag?.() ?? null, payload.version);
    if (notice) console.log(notice); // report only — never self-replace (decision #6)
  }
  return converge(payload, { targets: opts.targets, force: opts.force, full: opts.targets.length === 0, dryRun: opts.dryRun, command: "update" });
}

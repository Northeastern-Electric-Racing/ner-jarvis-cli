export interface RunSummary {
  successes: string[];
  skipped: { item: string; reason: string }[];
  failures: { item: string; error: string }[];
}

export function exitCodeFor(s: RunSummary): number {
  return s.failures.length > 0 ? 1 : 0;
}

export function formatSummary(s: RunSummary): string {
  const lines: string[] = [];
  if (s.successes.length) {
    lines.push("Succeeded:");
    for (const item of s.successes) lines.push(`  ✓ ${item}`);
  }
  if (s.skipped.length) {
    lines.push("Skipped (left untouched):");
    for (const k of s.skipped) lines.push(`  - ${k.item}: ${k.reason}`);
  }
  if (s.failures.length) {
    lines.push("Failed:");
    for (const f of s.failures) lines.push(`  ✗ ${f.item}: ${f.error}`);
    lines.push("Some steps failed. Re-run `ner-jarvis update` (optionally naming just the failed items) to retry.");
  }
  if (!lines.length) lines.push("Nothing to do.");
  return lines.join("\n");
}

export function printSummary(s: RunSummary): void {
  console.log(formatSummary(s));
}

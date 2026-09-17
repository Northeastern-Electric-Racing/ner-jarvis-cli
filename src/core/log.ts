import { appendFileSync, mkdirSync } from "node:fs";
import { nerJarvisHome, logFile } from "./paths";

/** A single decision-log record (arbitrary non-secret fields). `ts` is added here. */
export type DecisionEvent = Record<string, unknown>;

/**
 * Append one timestamped JSON record to the decision log
 * (`~/.claude/ner-jarvis/log.jsonl`) — newline-delimited, append-only, never read back.
 *
 * Best-effort by design: a logging failure must never abort a run, so all errors are
 * swallowed. NEVER pass secrets (tokens, `claude` stdout/stderr) in `event`.
 */
export function logDecision(event: DecisionEvent): void {
  try {
    mkdirSync(nerJarvisHome(), { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
    appendFileSync(logFile(), line);
  } catch {
    // intentionally ignored — the log is a debug convenience, not a hard dependency
  }
}

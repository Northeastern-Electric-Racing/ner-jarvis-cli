import type { ParsedArgs } from "./types";

const KNOWN_COMMANDS = new Set(["setup", "update", "doctor", "uninstall", "undo", "roster", "stale"]);

export function parseArgs(argv: string[]): ParsedArgs {
  let command: ParsedArgs["command"] = "setup";
  let commandSet = false;
  const targets: string[] = [];
  let force = false, dryRun = false, version = false, help = false, yes = false, list = false, json = false;
  // Free-form flags for commands that need values (`stale --url=… --wrong=…`).
  // A bare `--flag` records "true". Previously these were silently dropped; nothing
  // reads `options` except the commands that opt in, so older behavior is unchanged.
  const options: Record<string, string> = {};

  for (const a of argv) {
    if (a === "--version" || a === "-v") version = true;
    else if (a === "--help" || a === "-h") help = true;
    else if (a === "--yes" || a === "-y") yes = true;
    else if (a === "--force") force = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--list") list = true;
    else if (a === "--json") json = true;
    else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq === -1) options[a.slice(2)] = "true";
      else options[a.slice(2, eq)] = a.slice(eq + 1);
    }
    else if (a.startsWith("-")) { /* unknown short flag: ignore */ }
    else if (!commandSet && KNOWN_COMMANDS.has(a)) { command = a as ParsedArgs["command"]; commandSet = true; }
    else targets.push(a);
  }

  if (help) command = "help";        // --help overrides everything
  else if (version) command = "version";
  return { command, targets, force, dryRun, yes, list, json, options };
}

import { execFileSync } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * The base command. Overridable via NER_JARVIS_CLAUDE_BIN for tests.
 *
 * Split on whitespace but honor `"quoted segments"`, so a path containing spaces
 * survives — on Windows the interpreter or the script routinely lives under
 * `C:\\Program Files\\...`, and a naive `.split(" ")` turns one argument into two
 * and the spawn fails with a misleading "not found".
 */
export function baseCmd(): string[] {
  const override = process.env.NER_JARVIS_CLAUDE_BIN;
  if (!override) return ["claude"];
  const parts = override.match(/"[^"]*"|\S+/g)?.map((s) => s.replace(/^"|"$/g, ""));
  return parts?.length ? parts : ["claude"];
}

/**
 * Run the `claude` CLI with the given args. Never throws: a non-zero exit is
 * surfaced as `code`. stdout/stderr are returned to the caller but never
 * logged or persisted by this wrapper.
 */
function spawnOnce(bin: string, argv: string[]): RunResult {
  try {
    // Pass `env` explicitly: Bun's execFileSync otherwise uses a stale env
    // snapshot from process start and ignores runtime `process.env` changes
    // (Node inherits the live env). Explicit env keeps both runtimes consistent
    // and lets the test seam (NER_JARVIS_CLAUDE_BIN etc.) reach the child.
    const stdout = execFileSync(bin, argv, { encoding: "utf8", env: process.env });
    return { code: 0, stdout, stderr: "" };
  } catch (e: any) {
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
    };
  }
}

/**
 * True when a result looks like the child never actually ran: non-zero exit with
 * **nothing** on either stream. A real `claude` failure always says something.
 */
const producedNothing = (r: RunResult) => r.code !== 0 && r.stdout === "" && r.stderr === "";

/**
 * Run the `claude` CLI with the given args. Never throws: a non-zero exit is
 * surfaced as `code`. stdout/stderr are returned to the caller but never
 * logged or persisted by this wrapper.
 *
 * **Windows retry.** Process creation on Windows fails transiently under load
 * (AV scanning a freshly-touched image, handle pressure): the spawn returns exit 1
 * with empty stdout AND stderr, and an immediate retry succeeds. Observed on CI as
 * unrelated tests failing at random — a bad `--version` probe reads as "claude not
 * found" and aborts setup at preflight. Retry once, and only on that exact
 * produced-nothing signature, so a genuine `claude` error (which always prints)
 * is never masked and never runs twice. POSIX is unaffected.
 */
export function runClaude(args: string[]): RunResult {
  const [bin, ...prefix] = baseCmd();
  const argv = [...prefix, ...args];
  const first = spawnOnce(bin, argv);
  if (process.platform === "win32" && producedNothing(first)) return spawnOnce(bin, argv);
  return first;
}

export const isClaudeAvailable = () => runClaude(["--version"]).code === 0;

// MCP
export const mcpAdd = (name: string, transport: string, url: string) =>
  runClaude(["mcp", "add", "--transport", transport, name, url, "--scope", "user"]);
export const mcpGet = (name: string) => runClaude(["mcp", "get", name]);
export const mcpRemove = (name: string) => runClaude(["mcp", "remove", name, "--scope", "user"]);
export const mcpListText = () => runClaude(["mcp", "list"]).stdout;

export type McpConnState = "connected" | "needs-auth" | "absent";

/**
 * Best-effort connection state for one MCP server, parsed from `claude mcp list`.
 * A plugin-provided server appears as `plugin:<marketplace>:<name>`; a directly-added
 * server appears under its bare `<name>`. The pivotal state is "needs-auth": the server
 * IS registered but the user hasn't finished the OAuth login — the fix is `/mcp`, NOT a
 * reinstall (tokens live per-endpoint and survive reinstall). Shared by `doctor` and the
 * setup wizard so both report auth identically.
 */
export function mcpServerStatus(name: string, listText: string): McpConnState {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rows = listText.split("\n").filter(Boolean);
  const row =
    rows.find((l) => new RegExp(`plugin:[^\\s:]*:${esc}(\\b|:|\\s)`).test(l)) ??
    rows.find((l) => l.includes(name));
  if (!row) return "absent";
  if (/pending|not connected|needs auth|unauthenticated|disconnected/i.test(row)) return "needs-auth";
  if (/connected|authenticated|✓|✔/i.test(row)) return "connected";
  return "needs-auth"; // a line exists but its state is unclear — never claim a false ✓
}

// Plugins
export const pluginMarketplaceAdd = (source: string) =>
  runClaude(["plugin", "marketplace", "add", source]);
export const pluginMarketplaceRemove = (name: string) =>
  runClaude(["plugin", "marketplace", "remove", name]);
export const pluginInstall = (plugin: string, mp: string) =>
  runClaude(["plugin", "install", `${plugin}@${mp}`]);
export const pluginUpdate = (plugin: string, mp: string) =>
  runClaude(["plugin", "update", `${plugin}@${mp}`]);
export const pluginUninstall = (plugin: string, mp: string) =>
  runClaude(["plugin", "uninstall", `${plugin}@${mp}`]);

export function pluginListJson(): { name: string; marketplace?: string; enabled?: boolean }[] {
  const r = runClaude(["plugin", "list", "--json"]);
  if (r.code !== 0) return [];
  try {
    const j = JSON.parse(r.stdout);
    const arr: any[] = Array.isArray(j) ? j : (j.plugins ?? []);
    // `claude plugin list --json` identifies each plugin by `id` ("<plugin>@<marketplace>"),
    // not a `name` field. Normalize to the bare plugin name + marketplace here so callers
    // never have to know the wire shape. Tolerate a `name` fallback for older/other outputs.
    return arr.map((p) => {
      const ref: string = p.id ?? p.name ?? "";
      const [name, marketplace] = ref.split("@");
      return { name, marketplace: marketplace ?? p.marketplace, enabled: p.enabled };
    });
  } catch {
    return [];
  }
}

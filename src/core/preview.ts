import type { SkillAction, SourceAction } from "../types";
import type { McpConnState } from "./claude";

/**
 * Turn the reconciler's planned actions into a human preview the setup wizard can
 * show BEFORE it prompts — so the user sees what actually differs (new / update /
 * up-to-date) instead of a blind "install everything?". Pure: no I/O, no claude.
 *
 * `planSkills`/`planSources` already do the real diffing (content-hash for skills,
 * live-view for sources); this only classifies + renders their output and reports
 * which items are genuine changes worth prompting for. Glyphs mirror `doctor`:
 *   ✓ up to date   ↑ update available   ⊕ new   ⚠ needs attention (not auto-acted)
 */

export interface SkillPreview {
  /** Status lines to print, in display order. */
  lines: string[];
  /** Skill names that need install/update — the set to approve if the user says yes. */
  changed: string[];
  hasChanges: boolean;
}

export function previewSkills(actions: SkillAction[]): SkillPreview {
  const upToDate: string[] = [];
  const updates: string[] = [];
  const installs: string[] = [];
  const warns: string[] = [];

  for (const a of actions) {
    switch (a.kind) {
      case "noop": upToDate.push(a.name); break;
      case "update": updates.push(a.name); break;
      case "install": installs.push(a.name); break;
      case "skip-modified":
      case "skip-foreign": warns.push(`⚠ ${a.name} — ${a.reason}`); break;
      case "remove": warns.push(`⚠ ${a.name} — will be removed`); break;
    }
  }

  const lines: string[] = [];
  if (upToDate.length) lines.push(`✓ ${upToDate.join(", ")} — up to date`);
  for (const n of updates) lines.push(`↑ ${n} — update available`);
  for (const n of installs) lines.push(`⊕ ${n} — new`);
  lines.push(...warns);

  const changed = [...updates, ...installs];
  return { lines, changed, hasChanges: changed.length > 0 };
}

export interface SourcePreviewItem {
  name: string;
  line: string;
  /** Optional indented follow-up (e.g. the /mcp auth hint for an installed-but-unauthed source). */
  hint?: string;
  /** true → a real change worth prompting for; false → already good / foreign (informational). */
  isChange: boolean;
  /** Imperative used to phrase the confirm prompt ("Install slack?"). Present only for changes. */
  verb?: string;
}
export interface SourcePreview {
  items: SourcePreviewItem[];
}

/**
 * Status line for a source that's already installed/present. Install-presence alone
 * isn't usability — a plugin can be installed yet unauthenticated — so when auth state
 * is known we distinguish connected (✓) from needs-auth (⚠ + a /mcp hint). ner-jarvis
 * can't complete the OAuth (that's Claude Code's `/mcp` flow), so we flag + guide, not act.
 */
function installedItem(name: string, kind: "plugin" | "mcp", auth: McpConnState | undefined): SourcePreviewItem {
  if (auth === "connected") return { name, line: `✓ ${name} (${kind}) — connected`, isChange: false };
  if (auth === "needs-auth" || auth === "absent") {
    return { name, line: `⚠ ${name} (${kind}) — installed, needs auth`, hint: "→ open Claude Code and run /mcp to log in", isChange: false };
  }
  // auth state unknown → report install presence without asserting a live connection.
  return { name, line: `✓ ${name} (${kind}) — ${kind === "plugin" ? "installed" : "connected"}`, isChange: false };
}

export function previewSources(
  actions: SourceAction[],
  authOf: (name: string) => McpConnState | undefined = () => undefined,
): SourcePreview {
  const items: SourcePreviewItem[] = [];
  for (const a of actions) {
    switch (a.kind) {
      case "plugin-install":
        items.push({ name: a.source.name, line: `⊕ ${a.source.name} (plugin) — not installed`, isChange: true, verb: "Install" });
        break;
      case "mcp-add":
        items.push({ name: a.source.name, line: `⊕ ${a.source.name} (mcp) — not connected`, isChange: true, verb: "Connect" });
        break;
      case "mcp-replace":
        items.push({ name: a.source.name, line: `↑ ${a.source.name} (mcp) — endpoint changed`, isChange: true, verb: "Update" });
        break;
      case "plugin-update":
        // Tracked + still installed: don't re-install/refresh — just report its auth state.
        items.push(installedItem(a.source.name, "plugin", authOf(a.source.name)));
        break;
      case "noop":
        // Only mcp sources noop (a present+tracked+unchanged server).
        items.push(installedItem(a.name, "mcp", authOf(a.name)));
        break;
      case "skip-foreign":
        items.push({ name: a.name, line: `⚠ ${a.name} — ${a.reason}`, isChange: false });
        break;
      // marketplace-add/prune, plugin-uninstall, mcp-remove: not user-facing in the
      // setup preview (marketplace is an implied dependency; removals don't occur here).
    }
  }
  return { items };
}

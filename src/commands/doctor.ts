import { existsSync } from "node:fs";
import { join } from "node:path";
import { readState } from "../core/state";
import { skillsDir } from "../core/paths";
import { currentSkillHash } from "./converge";
import { pluginListJson, mcpGet, mcpListText, mcpServerStatus, type McpConnState } from "../core/claude";
import { ghStatus } from "../core/gh";

export interface DoctorReport { ok: boolean; lines: string[]; }

/** Human label for an mcp-type source's status line. */
function mcpLabel(state: McpConnState, name: string): string {
  if (state === "connected") return "connected";
  if (state === "needs-auth") return `needs auth — open Claude Code and run /mcp (or \`claude mcp login ${name}\`)`;
  return "present; open Claude Code and run /mcp to confirm auth";
}

export function doctor(opts: { targets: string[] }): DoctorReport {
  const state = readState();
  const lines: string[] = [];
  if (!state) {
    lines.push("ner-jarvis is not set up here (no ~/.claude/ner-jarvis/state.json). Run `ner-jarvis setup`.");
    return { ok: false, lines };
  }
  const targets = opts.targets.length ? new Set(opts.targets) : null;
  const inScope = (n: string) => !targets || targets.has(n);
  let ok = true;

  for (const s of state.skills) {
    if (!inScope(s.name)) continue;
    const dir = join(skillsDir(), s.name);
    if (!existsSync(dir)) { lines.push(`✗ skill ${s.name}: missing — run \`ner-jarvis setup ${s.name}\``); ok = false; continue; }
    if (currentSkillHash(s.name) === s.hash) lines.push(`✓ skill ${s.name}`);
    else lines.push(`⚠ skill ${s.name}: modified since install (left as-is; \`ner-jarvis update ${s.name} --force\` to reset)`);
  }

  const installed = pluginListJson();
  const listText = mcpListText();
  for (const src of state.sources) {
    if (!inScope(src.name)) continue;
    if (src.type === "plugin") {
      // A plugin's usability turns on its MCP server's auth state (`claude mcp list`),
      // not merely whether the plugin is installed. Installed-but-unauthenticated used
      // to read as a bare ✓ (or, if the plugin registry didn't list it, as "not
      // installed") — it's really an AUTH gap, and the fix is /mcp, never a reinstall.
      const st = mcpServerStatus(src.name, listText);
      if (st === "connected") {
        lines.push(`✓ source ${src.name} (plugin): connected`);
      } else if (st === "needs-auth") {
        lines.push(`✗ source ${src.name} (plugin): installed but not authenticated — open Claude Code and run /mcp to log in (this is an auth step, not a reinstall)`);
        ok = false;
      } else {
        const installedAsPlugin = installed.some((p) => (p.name ?? "").split("@")[0] === src.plugin);
        if (installedAsPlugin) {
          lines.push(`⚠ source ${src.name} (plugin): installed, but its MCP server isn't connected yet — open Claude Code and run /mcp (restart Claude Code if it isn't listed)`);
        } else {
          lines.push(`✗ source ${src.name} (plugin): not installed — run \`ner-jarvis setup ${src.name}\``);
          ok = false;
        }
      }
    } else {
      if (mcpGet(src.name).code === 0) lines.push(`✓ source ${src.name} (mcp): ${mcpLabel(mcpServerStatus(src.name, listText), src.name)}`);
      else { lines.push(`✗ source ${src.name} (mcp): not registered — run \`ner-jarvis setup ${src.name}\``); ok = false; }
    }
  }

  // GitHub is accessed via the `gh` CLI (not a connected source) — check it here.
  if (inScope("github")) {
    const gh = ghStatus();
    if (gh.authed) lines.push("✓ github (gh CLI): authenticated");
    else if (gh.installed) { lines.push("✗ github (gh CLI): not authenticated — run `gh auth login`"); ok = false; }
    else { lines.push("✗ github (gh CLI): `gh` not found — install it (https://cli.github.com), then `gh auth login`"); ok = false; }
  }
  return { ok, lines };
}

export function printDoctor(r: DoctorReport): void { for (const l of r.lines) console.log(l); }

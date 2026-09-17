import { test, expect } from "bun:test";
import { previewSkills, previewSources } from "./preview";
import type { SkillAction, SourceAction, PluginSource, McpSource, Marketplace } from "../types";

// --- fixtures ---
function pluginSrc(name: string, mp = "mkt", plug = name): PluginSource {
  return { name, type: "plugin", marketplace: mp, plugin: plug };
}
function mcpSrc(name: string, url = "https://x"): McpSource {
  return { name, type: "mcp", transport: "http", url };
}
const mkt: Marketplace = { name: "mkt", source: "owner/mkt" };

// === previewSkills ===

test("previewSkills: all noop → one up-to-date line, no changes", () => {
  const pv = previewSkills([
    { kind: "noop", name: "a" },
    { kind: "noop", name: "b" },
  ]);
  expect(pv.hasChanges).toBe(false);
  expect(pv.changed).toEqual([]);
  expect(pv.lines).toEqual(["✓ a, b — up to date"]);
});

test("previewSkills: mix of new/update/unchanged → changed lists only new+updated", () => {
  const actions: SkillAction[] = [
    { kind: "noop", name: "keep" },
    { kind: "update", name: "changed" },
    { kind: "install", name: "fresh" },
  ];
  const pv = previewSkills(actions);
  expect(pv.hasChanges).toBe(true);
  expect(pv.changed.sort()).toEqual(["changed", "fresh"]);
  expect(pv.lines).toContain("✓ keep — up to date");
  expect(pv.lines).toContain("↑ changed — update available");
  expect(pv.lines).toContain("⊕ fresh — new");
});

test("previewSkills: skip-modified / skip-foreign are warnings, never counted as changes", () => {
  const pv = previewSkills([
    { kind: "skip-modified", name: "edited", reason: "edited since install; use --force to overwrite" },
    { kind: "skip-foreign", name: "theirs", reason: "not installed by ner-jarvis" },
  ]);
  expect(pv.hasChanges).toBe(false);
  expect(pv.changed).toEqual([]);
  expect(pv.lines.some((l) => l.startsWith("⚠ edited"))).toBe(true);
  expect(pv.lines.some((l) => l.startsWith("⚠ theirs"))).toBe(true);
});

// === previewSources ===

test("previewSources: fresh plugin → change with verb Install", () => {
  const { items } = previewSources([{ kind: "plugin-install", source: pluginSrc("slack") }]);
  expect(items.length).toBe(1);
  expect(items[0]).toMatchObject({ name: "slack", isChange: true, verb: "Install" });
  expect(items[0].line.startsWith("⊕")).toBe(true);
});

test("previewSources: fresh mcp → change with verb Connect", () => {
  const { items } = previewSources([{ kind: "mcp-add", source: mcpSrc("atlassian") }]);
  expect(items[0]).toMatchObject({ name: "atlassian", isChange: true, verb: "Connect" });
  expect(items[0].line.startsWith("⊕")).toBe(true);
});

test("previewSources: changed mcp endpoint → change with verb Update", () => {
  const { items } = previewSources([{ kind: "mcp-replace", source: mcpSrc("atlassian", "https://new") }]);
  expect(items[0]).toMatchObject({ name: "atlassian", isChange: true, verb: "Update" });
  expect(items[0].line.startsWith("↑")).toBe(true);
});

test("previewSources: already-installed plugin (plugin-update) and connected mcp (noop) are NOT changes", () => {
  const { items } = previewSources([
    { kind: "plugin-update", source: pluginSrc("slack") },
    { kind: "noop", name: "atlassian" },
  ]);
  expect(items.every((i) => i.isChange === false)).toBe(true);
  expect(items.every((i) => i.line.startsWith("✓"))).toBe(true);
});

test("previewSources: an installed plugin that needs auth is flagged ⚠ with a /mcp hint (not a change)", () => {
  const { items } = previewSources(
    [{ kind: "plugin-update", source: pluginSrc("atlassian") }],
    (n) => (n === "atlassian" ? "needs-auth" : undefined),
  );
  expect(items[0].isChange).toBe(false); // installed → never re-prompt to install
  expect(items[0].line.startsWith("⚠")).toBe(true);
  expect(items[0].line).toContain("needs auth");
  expect(items[0].hint).toContain("/mcp");
});

test("previewSources: an installed + connected plugin shows ✓ connected, no hint", () => {
  const { items } = previewSources(
    [{ kind: "plugin-update", source: pluginSrc("slack") }],
    () => "connected",
  );
  expect(items[0].line).toContain("✓");
  expect(items[0].line).toContain("connected");
  expect(items[0].hint).toBeUndefined();
});

test("previewSources: foreign source is a warning, not a change", () => {
  const { items } = previewSources([{ kind: "skip-foreign", name: "gh", reason: "already exists" }]);
  expect(items[0]).toMatchObject({ name: "gh", isChange: false });
  expect(items[0].line.startsWith("⚠")).toBe(true);
});

test("previewSources: marketplace-add is an implied dependency, not a user-facing item", () => {
  const { items } = previewSources([
    { kind: "marketplace-add", marketplace: mkt },
    { kind: "plugin-install", source: pluginSrc("slack") },
  ]);
  expect(items.map((i) => i.name)).toEqual(["slack"]);
});

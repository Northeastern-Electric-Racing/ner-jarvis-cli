import { test, expect } from "bun:test";
import { planSources, applySourceAction } from "./sources";
import type {
  EmbeddedPayload,
  Marketplace,
  PluginSource,
  McpSource,
  Source,
  State,
  ClaudeView,
  SourceAction,
} from "../types";

// --- fixtures ---
function marketplace(name: string, source = `owner/${name}`): Marketplace {
  return { name, source };
}
function plugin(name: string, mp: string, plug = name): PluginSource {
  return { name, type: "plugin", marketplace: mp, plugin: plug };
}
function mcp(name: string, url: string, transport: "http" | "sse" = "http"): McpSource {
  return { name, type: "mcp", transport, url };
}
function payloadOf(marketplaces: Marketplace[], sources: Source[]): EmbeddedPayload {
  return { version: "0.1.0", skills: [], marketplaces, sources };
}
function stateOf(marketplaces: Marketplace[], sources: Source[]): State {
  return {
    stateSchemaVersion: 1,
    migrationLevel: 0,
    version: "0.1.0",
    installedAt: "2026-07-06T00:00:00Z",
    updatedAt: "2026-07-06T00:00:00Z",
    skills: [],
    marketplaces,
    sources,
  };
}
function mkView(
  { installedPlugins = [], presentMcp = {} }: Partial<ClaudeView> = {},
): ClaudeView {
  return { installedPlugins, presentMcp };
}
const kinds = (actions: SourceAction[]) => actions.map((a) => a.kind);

// Scenario 1: plugin fresh → marketplace-add THEN plugin-install
test("planSources: fresh plugin whose marketplace is untracked → marketplace-add before plugin-install", () => {
  const mp = marketplace("mkt");
  const src = plugin("p", "mkt");
  const payload = payloadOf([mp], [src]);
  const actions = planSources(payload, null, mkView(), { force: false, full: true });

  const addIdx = actions.findIndex((a) => a.kind === "marketplace-add");
  const installIdx = actions.findIndex((a) => a.kind === "plugin-install");
  expect(addIdx).toBeGreaterThanOrEqual(0);
  expect(installIdx).toBeGreaterThanOrEqual(0);
  expect(addIdx).toBeLessThan(installIdx);
  expect(actions).toContainEqual({ kind: "marketplace-add", marketplace: mp });
  expect(actions).toContainEqual({ kind: "plugin-install", source: src });
});

// Scenario 2: plugin tracked AND still installed live → plugin-update, no marketplace-add
test("planSources: tracked plugin still installed live → plugin-update and no marketplace-add", () => {
  const mp = marketplace("mkt");
  const src = plugin("p", "mkt");
  const payload = payloadOf([mp], [src]);
  const state = stateOf([mp], [src]);
  const view = mkView({ installedPlugins: [{ name: "p" }] });
  const actions = planSources(payload, state, view, { force: false, full: true });

  expect(actions).toContainEqual({ kind: "plugin-update", source: src });
  expect(actions.some((a) => a.kind === "marketplace-add")).toBe(false);
});

// Scenario 2b (regression): plugin tracked in state but no longer installed live
// (e.g. uninstalled out-of-band) → reinstall, NOT update. A blind `plugin-update`
// here fails with "plugin is not installed" and, because state still lists it,
// repeats on every subsequent setup. Mirrors the skills "tracked but missing → restore".
test("planSources: tracked plugin no longer installed live → plugin-install (restore), not update", () => {
  const mp = marketplace("mkt");
  const src = plugin("p", "mkt");
  const payload = payloadOf([mp], [src]);
  const state = stateOf([mp], [src]); // we still track it…
  const actions = planSources(payload, state, mkView(), { force: false, full: true }); // …but it's absent live

  expect(actions).toContainEqual({ kind: "plugin-install", source: src });
  expect(actions.some((a) => a.kind === "plugin-update")).toBe(false);
  expect(actions.some((a) => a.kind === "marketplace-add")).toBe(false); // marketplace still tracked
});

// Scenario 3: plugin foreign → skip-foreign
test("planSources: plugin not in state but already installed live → skip-foreign", () => {
  const mp = marketplace("mkt");
  const src = plugin("p", "mkt");
  const payload = payloadOf([mp], [src]);
  const view = mkView({ installedPlugins: [{ name: "p" }] });
  const actions = planSources(payload, null, view, { force: false, full: true });

  expect(actions.length).toBe(1);
  expect(actions[0].kind).toBe("skip-foreign");
  expect((actions[0] as { name: string }).name).toBe("p");
  expect((actions[0] as { reason: string }).reason).toBeTruthy();
});

// Scenario 4: mcp fresh → mcp-add
test("planSources: fresh mcp absent from view → mcp-add", () => {
  const src = mcp("gh", "https://x");
  const payload = payloadOf([], [src]);
  const actions = planSources(payload, null, mkView(), { force: false, full: true });
  expect(actions).toEqual([{ kind: "mcp-add", source: src }]);
});

// Scenario 5: mcp changed → mcp-replace
test("planSources: tracked mcp present with a different url → mcp-replace", () => {
  const tracked = mcp("gh", "https://old");
  const src = mcp("gh", "https://new");
  const payload = payloadOf([], [src]);
  const state = stateOf([], [tracked]);
  const view = mkView({ presentMcp: { gh: {} } });
  const actions = planSources(payload, state, view, { force: false, full: true });
  expect(actions).toEqual([{ kind: "mcp-replace", source: src }]);
});

test("planSources: tracked mcp present with a different transport → mcp-replace", () => {
  const tracked = mcp("gh", "https://x", "http");
  const src = mcp("gh", "https://x", "sse");
  const payload = payloadOf([], [src]);
  const state = stateOf([], [tracked]);
  const view = mkView({ presentMcp: { gh: {} } });
  const actions = planSources(payload, state, view, { force: false, full: true });
  expect(actions).toEqual([{ kind: "mcp-replace", source: src }]);
});

// Scenario 6: mcp foreign → skip-foreign
test("planSources: mcp not in state but already present live → skip-foreign", () => {
  const src = mcp("gh", "https://x");
  const payload = payloadOf([], [src]);
  const view = mkView({ presentMcp: { gh: {} } });
  const actions = planSources(payload, null, view, { force: false, full: true });

  expect(actions.length).toBe(1);
  expect(actions[0].kind).toBe("skip-foreign");
  expect((actions[0] as { name: string }).name).toBe("gh");
  expect((actions[0] as { reason: string }).reason).toBeTruthy();
});

// Scenario 7: mcp tracked, present, unchanged → noop
test("planSources: tracked mcp present with identical url+transport → noop", () => {
  const src = mcp("gh", "https://x", "http");
  const payload = payloadOf([], [src]);
  const state = stateOf([], [mcp("gh", "https://x", "http")]);
  const view = mkView({ presentMcp: { gh: {} } });
  const actions = planSources(payload, state, view, { force: false, full: true });
  expect(actions).toEqual([{ kind: "noop", name: "gh" }]);
});

// Scenario 7b (regression): mcp tracked but no longer present live (removed out-of-band)
// → re-add (restore), NOT a silent noop. Same bug class as the plugin restore case.
test("planSources: tracked mcp no longer present live → mcp-add (restore)", () => {
  const src = mcp("gh", "https://x", "http");
  const payload = payloadOf([], [src]);
  const state = stateOf([], [mcp("gh", "https://x", "http")]);
  const actions = planSources(payload, state, mkView(), { force: false, full: true }); // presentMcp empty
  expect(actions).toEqual([{ kind: "mcp-add", source: src }]);
});

// Scenario 8: removal semantics
test("planSources: full untargeted run prunes dropped plugin, mcp, and orphaned marketplace", () => {
  const mp = marketplace("mkt");
  const droppedPlugin = plugin("p", "mkt");
  const droppedMcp = mcp("gh", "https://x");
  // payload no longer has p, gh, or mkt
  const payload = payloadOf([], []);
  const state = stateOf([mp], [droppedPlugin, droppedMcp]);
  const actions = planSources(payload, state, mkView(), { force: false, full: true });

  expect(actions).toContainEqual({ kind: "plugin-uninstall", source: droppedPlugin });
  expect(actions).toContainEqual({ kind: "mcp-remove", source: droppedMcp });
  expect(actions).toContainEqual({ kind: "marketplace-prune", marketplace: mp });
});

test("planSources: targeted run emits no uninstall/remove/prune", () => {
  const mp = marketplace("mkt");
  const droppedPlugin = plugin("p", "mkt");
  const droppedMcp = mcp("gh", "https://x");
  const keptMcp = mcp("kept", "https://kept");
  const payload = payloadOf([], [keptMcp]);
  const state = stateOf([mp], [droppedPlugin, droppedMcp, keptMcp]);
  const actions = planSources(payload, state, mkView(), {
    force: false,
    full: false,
    targets: [keptMcp.name],
  });

  expect(actions.some((a) => a.kind === "plugin-uninstall")).toBe(false);
  expect(actions.some((a) => a.kind === "mcp-remove")).toBe(false);
  expect(actions.some((a) => a.kind === "marketplace-prune")).toBe(false);
});

// Scenario 9: applier dry-run invokes no claude
test("applySourceAction: dry-run mcp-add returns [] (no claude invoked)", () => {
  const src = mcp("gh", "https://x");
  const results = applySourceAction({ kind: "mcp-add", source: src }, { dryRun: true });
  expect(results).toEqual([]);
});

import type {
  EmbeddedPayload, State, Source, PluginSource, McpSource,
  Marketplace, SourceAction, ReconcileOpts, ClaudeView,
} from "../types";
import {
  RunResult, pluginMarketplaceAdd, pluginMarketplaceRemove, pluginInstall, pluginUpdate,
  pluginUninstall, mcpAdd, mcpRemove, mcpGet, pluginListJson,
} from "./claude";

export function planSources(
  payload: EmbeddedPayload, state: State | null, view: ClaudeView, opts: ReconcileOpts,
): SourceAction[] {
  const actions: SourceAction[] = [];
  const targets = opts.targets && opts.targets.length ? new Set(opts.targets) : null;
  const inTarget = (name: string) => !targets || targets.has(name);
  const removalsAllowed = opts.full && !targets;

  const stateSources = new Map((state?.sources ?? []).map(s => [s.name, s]));
  const stateMarketplaces = new Map((state?.marketplaces ?? []).map(m => [m.name, m]));
  const payloadSources = new Map(payload.sources.map(s => [s.name, s]));
  const payloadMarketplaces = new Map(payload.marketplaces.map(m => [m.name, m]));
  const marketplacesAdded = new Set<string>();

  for (const src of payload.sources) {
    if (!inTarget(src.name)) continue;
    if (src.type === "plugin") {
      const tracked = stateSources.get(src.name);
      const installedNow = view.installedPlugins.some(p => p.name === src.plugin);
      if (installedNow) {
        // Present on the system: refresh if it's ours; leave a foreign install alone.
        if (tracked) actions.push({ kind: "plugin-update", source: src });
        else actions.push({ kind: "skip-foreign", name: src.name, reason: "a plugin with this name is already installed and was not added by ner-jarvis" });
      } else {
        // Not installed → (re)install, whether brand-new OR tracked-but-since-removed
        // (uninstalled out-of-band). Blindly updating a tracked-but-absent plugin fails
        // with "plugin is not installed" and, since state still lists it, repeats every
        // run — so restore it, mirroring the skills "tracked but missing → install".
        if (!stateMarketplaces.has(src.marketplace) && !marketplacesAdded.has(src.marketplace)) {
          const mp = payloadMarketplaces.get(src.marketplace);
          if (mp) { actions.push({ kind: "marketplace-add", marketplace: mp }); marketplacesAdded.add(src.marketplace); }
        }
        actions.push({ kind: "plugin-install", source: src });
      }
    } else {
      const tracked = stateSources.get(src.name) as McpSource | undefined;
      const present = view.presentMcp[src.name];
      if (!present) {
        // Not registered → (re)add: brand-new, or tracked-but-since-removed (restore).
        actions.push({ kind: "mcp-add", source: src });
      } else if (!tracked) {
        actions.push({ kind: "skip-foreign", name: src.name, reason: "an MCP server with this name already exists and was not added by ner-jarvis" });
      } else if (tracked.url !== src.url || tracked.transport !== src.transport) {
        actions.push({ kind: "mcp-replace", source: src });
      } else {
        actions.push({ kind: "noop", name: src.name });
      }
    }
  }

  if (removalsAllowed) {
    for (const [name, src] of stateSources) {
      if (payloadSources.has(name)) continue;
      if (src.type === "plugin") actions.push({ kind: "plugin-uninstall", source: src });
      else actions.push({ kind: "mcp-remove", source: src as McpSource });
    }
    const needed = new Set(payload.sources.filter(s => s.type === "plugin").map(s => (s as PluginSource).marketplace));
    for (const [name, mp] of stateMarketplaces) {
      if (!needed.has(name)) actions.push({ kind: "marketplace-prune", marketplace: mp });
    }
  }
  return actions;
}

/** Perform ONE source action. Returns the RunResult(s) of any claude commands run (empty for dryRun/skip/noop). */
export function applySourceAction(action: SourceAction, opts: { dryRun: boolean }): RunResult[] {
  if (opts.dryRun) return [];
  switch (action.kind) {
    case "marketplace-add":   return [pluginMarketplaceAdd(action.marketplace.source)];
    case "marketplace-prune": return [pluginMarketplaceRemove(action.marketplace.name)];
    case "plugin-install":    return [pluginInstall(action.source.plugin, action.source.marketplace)];
    case "plugin-update":     return [pluginUpdate(action.source.plugin, action.source.marketplace)];
    case "plugin-uninstall":  return [pluginUninstall(action.source.plugin, action.source.marketplace)];
    case "mcp-add":           return [mcpAdd(action.source.name, action.source.transport, action.source.url)];
    case "mcp-remove":        return [mcpRemove(action.source.name)];
    case "mcp-replace":       return [mcpRemove(action.source.name), mcpAdd(action.source.name, action.source.transport, action.source.url)];
    default:                  return []; // skip-foreign, noop
  }
}

/** Read-only snapshot of the live system, gathered before planning. Impure (calls claude). */
export function gatherClaudeView(payload: EmbeddedPayload): ClaudeView {
  // pluginListJson already normalizes each entry to a bare plugin name + marketplace.
  const installedPlugins = pluginListJson().map(p => ({ name: p.name, marketplace: p.marketplace }));
  const presentMcp: Record<string, { transport?: string; url?: string } | undefined> = {};
  for (const src of payload.sources) {
    if (src.type === "mcp") presentMcp[src.name] = mcpGet(src.name).code === 0 ? {} : undefined;
  }
  return { installedPlugins, presentMcp };
}

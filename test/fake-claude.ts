import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeShim } from "./helpers";

const SHIM = `import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const LOG = process.env.NERJ_LOG, STORE = process.env.NERJ_STORE;
if (LOG) appendFileSync(LOG, JSON.stringify(argv) + "\\n");
const [a0, a1] = argv;
if (a0 === "mcp" && a1 === "add" && argv[4] === process.env.NERJ_FAIL_MCP_ADD) process.exit(7); // injected failure
if (a0 === "plugin" && a1 === "install" && String(argv[2] ?? "").split("@")[0] === process.env.NERJ_FAIL_PLUGIN_INSTALL) process.exit(8); // injected failure
const store = STORE && existsSync(STORE) ? JSON.parse(readFileSync(STORE, "utf8")) : { mcp: [], plugins: [] };
const save = () => { if (STORE) writeFileSync(STORE, JSON.stringify(store)); };
if (a0 === "--version" || argv[0] === "-v") process.exit(0);
if (a0 === "mcp") {
  if (a1 === "add") { const n = argv[4]; if (n && !store.mcp.includes(n)) { store.mcp.push(n); save(); } process.exit(0); }
  if (a1 === "get") { process.exit(store.mcp.includes(argv[2]) ? 0 : 1); }
  if (a1 === "remove") { store.mcp = store.mcp.filter((n) => n !== argv[2]); save(); process.exit(0); }
  if (a1 === "list") { process.stdout.write(store.mcp.map((n) => n + "  Connected").join("\\n") + "\\n"); process.exit(0); }
  process.exit(0);
}
if (a0 === "plugin") {
  if (a1 === "marketplace") process.exit(0);
  if (a1 === "install") { const [p, mp] = String(argv[2] ?? "").split("@"); if (p && !store.plugins.some((x) => x.name === p)) { store.plugins.push({ name: p, marketplace: mp ?? "" }); save(); } process.exit(0); }
  if (a1 === "update") process.exit(0);
  if (a1 === "uninstall") { const [p] = String(argv[2] ?? "").split("@"); store.plugins = store.plugins.filter((x) => x.name !== p); save(); process.exit(0); }
  if (a1 === "list") { process.stdout.write(JSON.stringify(store.plugins)); process.exit(0); }
  process.exit(0);
}
process.exit(0);
`;

/** Fake `gh`: `--version` (and anything) exits 0; `auth status` exits per NERJ_GH_AUTHED. */
const GH_SHIM = `const a = process.argv.slice(2); if (a[0] === "auth" && a[1] === "status") process.exit(process.env.NERJ_GH_AUTHED === "0" ? 1 : 0); process.exit(0);`;

export interface FakeOpts {
  initialMcp?: string[];
  initialPlugins?: { name: string; marketplace: string }[];
  failMcpAdd?: string;
  failPluginInstall?: string;
  gh?: "healthy" | "unauthed" | "missing";
}

const created: string[] = [];
const saved = { bin: process.env.NER_JARVIS_CLAUDE_BIN, log: process.env.NERJ_LOG, store: process.env.NERJ_STORE, fail: process.env.NERJ_FAIL_MCP_ADD, failPlugin: process.env.NERJ_FAIL_PLUGIN_INSTALL, gh: process.env.NER_JARVIS_GH_BIN, ghAuthed: process.env.NERJ_GH_AUTHED };

/** Create a fresh stateful fake claude and point the wrapper at it (via env). */
export function installFakeClaude(opts: FakeOpts = {}): { logPath: string; storePath: string } {
  const dir = mkdtempSync(join(tmpdir(), "nerj-fake-"));
  created.push(dir);
  const shimPath = join(dir, "shim.ts");
  const logPath = join(dir, "argv.log");
  const storePath = join(dir, "store.json");
  writeShim(shimPath, SHIM);
  writeFileSync(storePath, JSON.stringify({ mcp: opts.initialMcp ?? [], plugins: opts.initialPlugins ?? [] }));
  process.env.NER_JARVIS_CLAUDE_BIN = `bun "${shimPath}"`;
  process.env.NERJ_LOG = logPath;
  process.env.NERJ_STORE = storePath;
  if (opts.failMcpAdd) process.env.NERJ_FAIL_MCP_ADD = opts.failMcpAdd; else delete process.env.NERJ_FAIL_MCP_ADD;
  if (opts.failPluginInstall) process.env.NERJ_FAIL_PLUGIN_INSTALL = opts.failPluginInstall; else delete process.env.NERJ_FAIL_PLUGIN_INSTALL;
  // Fake `gh` so github checks are hermetic (default: installed + authenticated).
  const gh = opts.gh ?? "healthy";
  if (gh === "missing") { process.env.NER_JARVIS_GH_BIN = "/nonexistent/nerj-gh"; delete process.env.NERJ_GH_AUTHED; }
  else {
    const ghPath = join(dir, "gh.ts");
    writeFileSync(ghPath, GH_SHIM);
    process.env.NER_JARVIS_GH_BIN = `bun ${ghPath}`;
    process.env.NERJ_GH_AUTHED = gh === "unauthed" ? "0" : "1";
  }
  return { logPath, storePath };
}

/** Every argv the fake has been invoked with, JSON-parsed. */
export function readInvocations(logPath: string): string[][] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** Restore env and remove temp dirs. Call from afterEach. */
export function cleanupFakeClaude(): void {
  for (const k of ["NER_JARVIS_CLAUDE_BIN", "NERJ_LOG", "NERJ_STORE", "NERJ_FAIL_MCP_ADD", "NERJ_FAIL_PLUGIN_INSTALL", "NER_JARVIS_GH_BIN", "NERJ_GH_AUTHED"] as const) {
    const orig = ({ NER_JARVIS_CLAUDE_BIN: saved.bin, NERJ_LOG: saved.log, NERJ_STORE: saved.store, NERJ_FAIL_MCP_ADD: saved.fail, NERJ_FAIL_PLUGIN_INSTALL: saved.failPlugin, NER_JARVIS_GH_BIN: saved.gh, NERJ_GH_AUTHED: saved.ghAuthed } as Record<string, string | undefined>)[k];
    if (orig === undefined) delete process.env[k]; else process.env[k] = orig;
  }
  while (created.length) rmSync(created.pop()!, { recursive: true, force: true });
}

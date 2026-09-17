import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  baseCmd,
  mcpAdd,
  mcpGet,
  pluginInstall,
  pluginListJson,
  pluginMarketplaceRemove,
} from "./claude";
import { writeShim } from "../../test/helpers";

// Inline fake shim: logs each argv to NERJ_LOG, canned JSON for `plugin list`,
// otherwise exits with NERJ_EXIT (default 0). Real `claude` is never invoked.
const SHIM = `import { appendFileSync } from "node:fs";
const a = process.argv.slice(2);
if (process.env.NERJ_LOG) appendFileSync(process.env.NERJ_LOG, JSON.stringify(a) + "\\n");
if (a[0] === "plugin" && a[1] === "list") {
  // Real \`claude plugin list --json\` identifies each plugin by \`id\` ("<plugin>@<marketplace>"),
  // NOT a \`name\` field. Emit the real shape so the parser is tested against reality.
  process.stdout.write(JSON.stringify([{ id: "slack@claude-plugins-official", scope: "user", enabled: true }]));
  process.exit(0);
}
process.exit(Number(process.env.NERJ_EXIT ?? "0"));
`;

let dir: string;
let shimPath: string;
let logPath: string;
const saved = {
  bin: process.env.NER_JARVIS_CLAUDE_BIN,
  log: process.env.NERJ_LOG,
  exit: process.env.NERJ_EXIT,
};

/** Return the last JSON-parsed argv line the shim logged. */
function lastArgv(): string[] {
  const lines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nerj-claude-"));
  shimPath = join(dir, "shim.ts");
  logPath = join(dir, "argv.log");
  writeShim(shimPath, SHIM);
  process.env.NER_JARVIS_CLAUDE_BIN = `bun "${shimPath}"`;
  process.env.NERJ_LOG = logPath;
  delete process.env.NERJ_EXIT;
});

afterEach(() => {
  // Restore env so later test files see a clean environment.
  if (saved.bin === undefined) delete process.env.NER_JARVIS_CLAUDE_BIN;
  else process.env.NER_JARVIS_CLAUDE_BIN = saved.bin;
  if (saved.log === undefined) delete process.env.NERJ_LOG;
  else process.env.NERJ_LOG = saved.log;
  if (saved.exit === undefined) delete process.env.NERJ_EXIT;
  else process.env.NERJ_EXIT = saved.exit;
  rmSync(dir, { recursive: true, force: true });
});

test("mcpAdd logs the verified mcp add argv with --transport and --scope user", () => {
  mcpAdd("github", "http", "https://x");
  expect(lastArgv()).toEqual([
    "mcp",
    "add",
    "--transport",
    "http",
    "github",
    "https://x",
    "--scope",
    "user",
  ]);
});

test("pluginInstall logs `plugin install <plugin>@<marketplace>`", () => {
  pluginInstall("p", "m");
  expect(lastArgv()).toEqual(["plugin", "install", "p@m"]);
});

test("pluginListJson normalizes `claude plugin list --json` (id → bare name + marketplace)", () => {
  expect(pluginListJson()).toEqual([
    { name: "slack", marketplace: "claude-plugins-official", enabled: true },
  ]);
});

test("a non-zero exit is returned as a code, not thrown", () => {
  process.env.NERJ_EXIT = "3";
  const r = mcpGet("x");
  expect(r.code).toBe(3);
});

test("pluginMarketplaceRemove logs `plugin marketplace remove <name>`", () => {
  pluginMarketplaceRemove("m");
  expect(lastArgv()).toEqual(["plugin", "marketplace", "remove", "m"]);
});

// --- baseCmd argument splitting -------------------------------------------
// Regression: a naive `.split(" ")` turned `bun "C:\Program Files\x\shim.ts"`
// into four argv entries, so the spawn failed with a misleading "claude not
// found" (this is what reddened Windows CI). Quoted segments must stay whole.

test("baseCmd defaults to claude when the override is unset", () => {
  const saved = process.env.NER_JARVIS_CLAUDE_BIN;
  delete process.env.NER_JARVIS_CLAUDE_BIN;
  try { expect(baseCmd()).toEqual(["claude"]); }
  finally { if (saved !== undefined) process.env.NER_JARVIS_CLAUDE_BIN = saved; }
});

test("baseCmd keeps a quoted path with spaces as one argument", () => {
  const saved = process.env.NER_JARVIS_CLAUDE_BIN;
  process.env.NER_JARVIS_CLAUDE_BIN = 'bun "C:\\Program Files\\ner\\shim.ts"';
  try {
    expect(baseCmd()).toEqual(["bun", "C:\\Program Files\\ner\\shim.ts"]);
  } finally {
    if (saved === undefined) delete process.env.NER_JARVIS_CLAUDE_BIN;
    else process.env.NER_JARVIS_CLAUDE_BIN = saved;
  }
});

test("baseCmd still splits an unquoted space-free override", () => {
  const saved = process.env.NER_JARVIS_CLAUDE_BIN;
  process.env.NER_JARVIS_CLAUDE_BIN = "bun /tmp/shim.ts";
  try { expect(baseCmd()).toEqual(["bun", "/tmp/shim.ts"]); }
  finally {
    if (saved === undefined) delete process.env.NER_JARVIS_CLAUDE_BIN;
    else process.env.NER_JARVIS_CLAUDE_BIN = saved;
  }
});

import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSelfArgv, runSelf } from "./self";
import { writeShim } from "../../test/helpers";

// --- buildSelfArgv is PURE (no spawn) — unit-test the argv it builds directly ---

test("buildSelfArgv: an explicit binaryPath runs that exe with the args", () => {
  const saved = process.env.NER_JARVIS_SELF_BIN;
  delete process.env.NER_JARVIS_SELF_BIN;
  try {
    expect(buildSelfArgv({ binaryPath: "/v/0.2.0/ner-jarvis", version: "0.2.0" }, ["undo", "--runId", "R"]))
      .toEqual(["/v/0.2.0/ner-jarvis", "undo", "--runId", "R"]);
  } finally {
    if (saved === undefined) delete process.env.NER_JARVIS_SELF_BIN; else process.env.NER_JARVIS_SELF_BIN = saved;
  }
});

test("buildSelfArgv: no binaryPath → npx -y ner-jarvis@<npxVersion> …", () => {
  const saved = process.env.NER_JARVIS_SELF_BIN;
  delete process.env.NER_JARVIS_SELF_BIN;
  try {
    expect(buildSelfArgv({ npxVersion: "0.1.5", version: "0.2.0" }, ["undo", "--runId", "R"]))
      .toEqual(["npx", "-y", "ner-jarvis@0.1.5", "undo", "--runId", "R"]);
    // falls back to `version` when npxVersion is absent
    expect(buildSelfArgv({ version: "0.2.0" }, ["undo"]))
      .toEqual(["npx", "-y", "ner-jarvis@0.2.0", "undo"]);
  } finally {
    if (saved === undefined) delete process.env.NER_JARVIS_SELF_BIN; else process.env.NER_JARVIS_SELF_BIN = saved;
  }
});

test("buildSelfArgv: NER_JARVIS_SELF_BIN override wins and is split on spaces", () => {
  const saved = process.env.NER_JARVIS_SELF_BIN;
  process.env.NER_JARVIS_SELF_BIN = "bun /tmp/shim.ts";
  try {
    expect(buildSelfArgv({ binaryPath: "/ignored", npxVersion: "9.9.9", version: "0.2.0" }, ["undo", "--yes"]))
      .toEqual(["bun", "/tmp/shim.ts", "undo", "--yes"]);
  } finally {
    if (saved === undefined) delete process.env.NER_JARVIS_SELF_BIN; else process.env.NER_JARVIS_SELF_BIN = saved;
  }
});

// --- runSelf spawns argv[0] with the rest of argv and returns its exit code ---

const SHIM = `import { appendFileSync } from "node:fs";
const a = process.argv.slice(2);
if (process.env.NERJ_SELF_LOG) appendFileSync(process.env.NERJ_SELF_LOG, JSON.stringify(a) + "\\n");
process.exit(Number(process.env.NERJ_SELF_EXIT ?? "0"));
`;

let dir: string;
let shimPath: string;
let logPath: string;
const saved = {
  bin: process.env.NER_JARVIS_SELF_BIN,
  log: process.env.NERJ_SELF_LOG,
  exit: process.env.NERJ_SELF_EXIT,
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nerj-self-"));
  shimPath = join(dir, "shim.ts");
  logPath = join(dir, "argv.log");
  writeShim(shimPath, SHIM);
  process.env.NER_JARVIS_SELF_BIN = `bun ${shimPath}`;
  process.env.NERJ_SELF_LOG = logPath;
  delete process.env.NERJ_SELF_EXIT;
});

afterEach(() => {
  if (saved.bin === undefined) delete process.env.NER_JARVIS_SELF_BIN; else process.env.NER_JARVIS_SELF_BIN = saved.bin;
  if (saved.log === undefined) delete process.env.NERJ_SELF_LOG; else process.env.NERJ_SELF_LOG = saved.log;
  if (saved.exit === undefined) delete process.env.NERJ_SELF_EXIT; else process.env.NERJ_SELF_EXIT = saved.exit;
  rmSync(dir, { recursive: true, force: true });
});

test("runSelf spawns the override with the given args and returns exit 0", () => {
  const code = runSelf({ binaryPath: "/ignored", version: "0.2.0" }, ["undo", "--runId", "R1", "--yes"]);
  expect(code).toBe(0);
  const lines = existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  expect(lines).toEqual([["undo", "--runId", "R1", "--yes"]]);
});

test("runSelf propagates a non-zero exit code from the delegated binary", () => {
  process.env.NERJ_SELF_EXIT = "3";
  const code = runSelf({ npxVersion: "0.1.0", version: "0.2.0" }, ["undo", "--runId", "R2"]);
  expect(code).toBe(3);
});

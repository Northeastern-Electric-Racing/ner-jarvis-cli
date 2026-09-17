import { test, expect, beforeEach, afterEach } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTempEnv, writeShim } from "./helpers";
import { undoDir, skillsDir } from "../src/core/paths";
import { migrateState, CURRENT_STATE_SCHEMA_VERSION } from "../src/core/state";
import { readUndoIndex } from "../src/core/undo";
import { undo } from "../src/commands/undo";

// Compat guarantees (docs/adr/0004): the CURRENT binary must (a) forward-migrate an
// old-shape state.json via the pure schema chain, and (b) for a run made by a FOREIGN
// version, delegate rollback to the binary that made it — via the NER_JARVIS_SELF_BIN
// seam — WITHOUT ever parsing that version's (possibly unknown-shaped) undo record.
// Everything runs through shims: no real old binary, no real `claude`, no real `npx`.

const FIX = join(import.meta.dir, "fixtures", "legacy");

// A self-bin shim: logs its argv to NERJ_SELF_LOG and exits 0. Stands in for the
// archived/pinned binary that would actually reverse the foreign-version run.
const SELF_SHIM = `import { appendFileSync } from "node:fs";
const a = process.argv.slice(2);
if (process.env.NERJ_SELF_LOG) appendFileSync(process.env.NERJ_SELF_LOG, JSON.stringify(a) + "\\n");
process.exit(0);
`;

let dir: string;
let shimPath: string;
let logPath: string;
const saved = { bin: process.env.NER_JARVIS_SELF_BIN, log: process.env.NERJ_SELF_LOG };

function selfArgvLines(): string[][] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nerj-compat-"));
  shimPath = join(dir, "self-shim.ts");
  logPath = join(dir, "self-argv.log");
  writeShim(shimPath, SELF_SHIM);
  process.env.NER_JARVIS_SELF_BIN = `bun ${shimPath}`;
  process.env.NERJ_SELF_LOG = logPath;
});

afterEach(() => {
  if (saved.bin === undefined) delete process.env.NER_JARVIS_SELF_BIN; else process.env.NER_JARVIS_SELF_BIN = saved.bin;
  if (saved.log === undefined) delete process.env.NERJ_SELF_LOG; else process.env.NERJ_SELF_LOG = saved.log;
  rmSync(dir, { recursive: true, force: true });
});

// (a) — the current binary forward-migrates an old-shape state.json.
test("compat: the current binary migrates an old state.json via the schema chain", () => {
  const raw = JSON.parse(readFileSync(join(FIX, "state-v0.json"), "utf8"));
  expect(raw.stateSchemaVersion).toBeUndefined(); // fixture predates the field
  const s = migrateState(raw);
  expect(s.stateSchemaVersion).toBe(CURRENT_STATE_SCHEMA_VERSION);
  expect(s.migrationLevel).toBe(0); // pre-field install → 0 until converge stamps it
  expect(s.version).toBe("0.0.3");
  expect(s.skills).toEqual([{ name: "ner-onboard", hash: "deadbeef" }]);
});

// (b) — a foreign-version index entry is DELEGATED (via the real runSelf → shim),
// and the current binary never parses the foreign, unknown-shaped record.
test("compat: a foreign-version run is delegated via NER_JARVIS_SELF_BIN, not parsed in-process", () => {
  withTempEnv(() => {
    // Lay down the frozen fixture journal as if written by ner-jarvis 0.0.3.
    mkdirSync(undoDir(), { recursive: true });
    copyFileSync(join(FIX, "undo-index-foreign.json"), join(undoDir(), "index.json"));
    copyFileSync(join(FIX, "undo-record-foreign.json"), join(undoDir(), "2026-06-01T00-00-00.000Z-setup.json"));

    // A skill the (opaque) record nominally installed — must be LEFT for the delegate.
    mkdirSync(join(skillsDir(), "legacy-skill"), { recursive: true });
    writeFileSync(join(skillsDir(), "legacy-skill", "SKILL.md"), "legacy");

    // Current binary is a different version → must delegate (real runSelf → self shim).
    const summary = undo({ force: false, dryRun: false, yes: true }, { currentVersion: "9.9.9", logDecision: () => {} });

    // The self shim was invoked with the run id + --yes passthrough.
    expect(selfArgvLines()).toEqual([["undo", "--runId", "2026-06-01T00-00-00.000Z-setup", "--yes"]]);
    // Delegation surfaced as a success; nothing reversed in-process.
    expect(summary.successes.some((x) => /2026-06-01/.test(x))).toBe(true);
    expect(existsSync(join(skillsDir(), "legacy-skill"))).toBe(true);
    // The delegate owns markUndone — the current binary leaves the index untouched here.
    expect(readUndoIndex().entries[0].undone).toBeUndefined();
  });
});

// (c) — the persisted-schema snapshot guard still passes (structural signatures match
// the committed golden). Re-checked here so the compat suite fails loudly if a shipped
// shape drifts without a version bump + migration + golden update.
test("compat: persisted schemas still match the committed golden signatures", () => {
  function sig(v: any): any {
    if (Array.isArray(v)) return [v.length ? sig(v[0]) : "any"];
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sig(v[k])]));
    return typeof v;
  }
  const SAMPLES: Record<string, any> = {
    state: { stateSchemaVersion: 1, migrationLevel: 1, version: "0.1.0", installedAt: "t", updatedAt: "t",
             skills: [{ name: "x", hash: "h" }], marketplaces: [{ name: "m", source: "s" }],
             sources: [{ name: "slack", type: "plugin", marketplace: "m", plugin: "slack" }] },
    undoRecord: { undoSchemaVersion: 1, runId: "r", version: "0.1.0", command: "setup", createdAt: "t",
                  installed: [{ kind: "skill", name: "x", installedHash: "h", priorFiles: [{ path: "p", contents: "c" }] }] },
    undoIndex: { indexSchemaVersion: 1, entries: [{ runId: "r", version: "0.1.0", command: "setup", createdAt: "t",
                 recordPath: "r.json", undone: true, binaryPath: "p", npxVersion: "v" }] },
  };
  const golden = JSON.parse(readFileSync(join(import.meta.dir, "schema", "golden.json"), "utf8"));
  for (const [name, sample] of Object.entries(SAMPLES)) {
    expect({ name, sig: sig(sample) }).toEqual({ name, sig: golden[name]?.sig });
  }
});

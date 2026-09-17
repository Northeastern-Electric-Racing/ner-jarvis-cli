# ner-jarvis Versioning, Rollback & Migrations Implementation Plan

> **Historical record — completed.** Kept for the *why*, not the *where*. File
> paths below are pre-migration: this plan was written when the CLI lived in a
> `cli/` subdirectory of `bracyw/ner-onboarding-agent`. It is now the root of
> `Northeastern-Electric-Racing/ner-jarvis-cli`, so read `cli/src/...` as
> `src/...`. Do not "fix" the paths here — that would falsify the record.

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ner-jarvis a versioned migration framework, a per-run undo journal, and version-based rollback (`ner-jarvis undo`) so it can safely evolve its on-disk structure and precisely reverse any install/update — without the current binary carrying a back-compatibility tax.

**Architecture:** Three independently-committable phases on one foundation — a monotonic `migrationLevel` in `state.json`. Phase 1 adds two migration ladders (pure schema migrations at read; side-effecting environment migrations in `converge`) plus a schema-snapshot guard that forces a validated migration whenever a persisted shape changes. Phase 2 makes every `setup`/`update` write a simple undo record (what was installed + where, plus prior content of anything overwritten) and adds interactive `ner-jarvis undo` replayed by the current binary. Phase 3 archives each version's binary and makes `undo` delegate rollback to the binary that made the run, so a new binary never needs to understand an old version's undo logic.

**Tech Stack:** TypeScript on Bun, `node:` builtins only in shipped `src/`. Tests via `bun test` with a fake-`claude` shim (`NER_JARVIS_CLAUDE_BIN`), temp-HOME baseline (`test/preload.ts` + `withTempEnv`), and scripted prompters. Decision on file layout, state shape, reconciliation, and exit codes is governed by `behavior.md` (authoritative — every phase updates it). Design rationale: `docs/adr/0004-versioned-rollback-and-migrations.md`.

---

## Ground rules for every task

- **TDD:** write the failing test, run it and watch it fail for the right reason, implement the minimum, run it green, commit.
- **Never touch the real `~/.claude`.** All tests run under the temp-HOME preload; use `withTempEnv` in unit tests. Never invoke the real `claude` or `gh`; use the shims. Never push; commit locally only.
- **`node:` builtins only** in `src/`. No new dependencies.
- **No secrets** in any persisted file (state, undo records, decision log) — footprint + shipped content only.
- **Run the suite** with `cd cli && bun test`. Scope to one file with `bun test src/core/<file>.test.ts`. Regenerate the embedded payload once before running e2e: `bun run embed`.
- **Baseline:** the suite is green at 125 tests before this plan starts. Keep it green after every task.

## File Structure

**New files**
- `cli/src/core/migrations.ts` — schema-migration chain (pure) + environment-migration ladder (side-effecting) + runner. `migrations.test.ts` alongside.
- `cli/src/core/undo.ts` — `UndoRecord`/`UndoIndex` types, record writer + index append, and reverse-action application. `undo.test.ts` alongside.
- `cli/src/commands/undo.ts` — interactive `ner-jarvis undo` command. `undo.test.ts` alongside.
- `cli/src/core/archive.ts` — per-version binary archival + GC. `archive.test.ts` alongside.
- `cli/src/core/self.ts` — invoke-a-copy-of-myself seam (archived binary / npx). `self.test.ts` alongside.
- `cli/test/schema-guard.test.ts` — persisted-schema snapshot guard.
- `cli/test/schema/golden.json` — committed structural signatures of every persisted type.
- `cli/test/fixtures/legacy/` — old-shape `state.json` / undo records / layouts for compat tests.

**Modified files**
- `cli/src/types.ts` — `State.migrationLevel`; `undo` in the command union; `--list`; undo/index types re-exported.
- `cli/src/core/state.ts` — default `migrationLevel`; location-tolerant `readState`; schema chain; drop the FS-moving legacy call.
- `cli/src/core/paths.ts` — `undoDir()`, `undoIndexFile()`, `versionsDir()`.
- `cli/src/commands/converge.ts` — run env-migrations; capture prior content; emit undo record; stamp `migrationLevel`.
- `cli/src/cli.ts`, `cli/src/index.ts` — parse + wire `undo` and `--list`.
- `cli/src/commands/uninstall.ts` — clear/settle undo index on full teardown.
- `behavior.md`, `cli/README.md`, project `CLAUDE.md`, memory.

---

## Chunk 1 (Phase 1): Versioning + migration ladders

Makes structural change safe and restores `doctor`'s read-only contract. No user-facing command changes yet.

### Task 1.1: Add `migrationLevel` to state

**Files:** Modify `cli/src/types.ts`, `cli/src/core/state.ts`; Test `cli/src/core/state.test.ts`.

- [ ] **Step 1: Failing test** — in `state.test.ts`, add:

```ts
test("migrateState defaults migrationLevel to 0 for pre-field state", () => {
  const s = migrateState({ version: "0.1.0", skills: [], marketplaces: [], sources: [] } as any);
  expect(s.migrationLevel).toBe(0);
});
test("migrateState preserves an existing migrationLevel", () => {
  const s = migrateState({ migrationLevel: 3, skills: [], marketplaces: [], sources: [] } as any);
  expect(s.migrationLevel).toBe(3);
});
```

- [ ] **Step 2: Run** `bun test src/core/state.test.ts` → FAIL (`migrationLevel` undefined).
- [ ] **Step 3: Implement** — add `migrationLevel: number;` to `State` in `types.ts`; in `migrateState` add `migrationLevel: typeof raw?.migrationLevel === "number" ? raw.migrationLevel : 0,`.
- [ ] **Step 4: Run** → PASS. Then `bun test` (whole suite) — fix any object-literal `State` construction that now needs `migrationLevel` (e.g. `converge.ts` `writeState` — set it in Task 1.5; for now use `prev?.migrationLevel ?? 0` to keep the suite green).
- [ ] **Step 5: Commit** `feat(state): add monotonic migrationLevel field`.

### Task 1.2: Pure schema-migration chain

**Files:** Modify `cli/src/core/state.ts`; Test `cli/src/core/state.test.ts`.

Establish the pattern even though v1 has a single step. `migrateState` becomes: read `stateSchemaVersion` (absent → 0), apply ordered pure transforms up to `CURRENT_STATE_SCHEMA_VERSION`, normalize.

- [ ] **Step 1: Failing test:**

```ts
test("migrateState coerces unknown/older shapes to the current schema version", () => {
  const s = migrateState({ stateSchemaVersion: 0, skills: "oops" } as any);
  expect(s.stateSchemaVersion).toBe(CURRENT_STATE_SCHEMA_VERSION);
  expect(Array.isArray(s.skills)).toBe(true);
});
```

- [ ] **Step 2: Run** → confirm current behavior; keep this green (it documents the coerce).
- [ ] **Step 3: Implement** — refactor `migrateState` to a `SCHEMA_MIGRATIONS: ((raw:any)=>any)[]` array indexed by from-version (index 0 = v0→v1 = today's coerce), applied in a loop, followed by the final normalize returning `State`. Pure — **no fs**.
- [ ] **Step 4: Run** `bun test src/core/state.test.ts` → PASS.
- [ ] **Step 5: Commit** `refactor(state): make schema migration an ordered pure chain`.

### Task 1.3: Environment-migration ladder + `migrateLegacyLayout` as migration #1

**Files:** Create `cli/src/core/migrations.ts`, `cli/src/core/migrations.test.ts`; Modify `cli/src/core/state.ts` (move the legacy-move logic out).

- [ ] **Step 1: Failing test** (`migrations.test.ts`):

```ts
import { withTempEnv } from "../../test/helpers";
test("env migration #1 relocates a pre-0.x loose dotfile into ~/.claude/ner-jarvis/", () => {
  withTempEnv(() => {
    mkdirSync(claudeHome(), { recursive: true });
    writeFileSync(legacyStateFile(), '{"version":"0.0.1"}');
    const { actions, level } = runEnvMigrations(0, { dryRun: false });
    expect(existsSync(stateFile())).toBe(true);
    expect(existsSync(legacyStateFile())).toBe(false);
    expect(level).toBe(CURRENT_MIGRATION_LEVEL);
    expect(actions.some(a => a.id === "legacy-layout" && a.outcome === "applied")).toBe(true);
  });
});
test("runEnvMigrations skips migrations at or below fromLevel and is a dry-run no-op", () => {
  withTempEnv(() => {
    mkdirSync(claudeHome(), { recursive: true });
    writeFileSync(legacyStateFile(), "{}");
    const r = runEnvMigrations(CURRENT_MIGRATION_LEVEL, { dryRun: false });
    expect(existsSync(legacyStateFile())).toBe(true); // nothing ran
    const d = runEnvMigrations(0, { dryRun: true });
    expect(existsSync(legacyStateFile())).toBe(true); // dry-run moved nothing
    expect(d.actions.some(a => a.id === "legacy-layout")).toBe(true); // but reported
  });
});
```

- [ ] **Step 2: Run** `bun test src/core/migrations.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `migrations.ts`:

```ts
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { nerJarvisHome, stateFile, logFile, legacyStateFile, legacyLogFile } from "./paths";

export interface MigrationDeps { dryRun: boolean; }
export interface MigrationAction { id: string; outcome: "applied" | "noop"; detail?: string; }
export interface EnvMigration { level: number; id: string; apply(deps: MigrationDeps): MigrationAction[]; }

const legacyLayout: EnvMigration = {
  level: 1, id: "legacy-layout",
  apply({ dryRun }) {
    const moves: [string, string][] = [[legacyStateFile(), stateFile()], [legacyLogFile(), logFile()]];
    const pending = moves.filter(([from, to]) => existsSync(from) && !existsSync(to));
    if (!pending.length) return [{ id: "legacy-layout", outcome: "noop" }];
    if (dryRun) return [{ id: "legacy-layout", outcome: "applied", detail: `would relocate ${pending.length} legacy file(s)` }];
    mkdirSync(nerJarvisHome(), { recursive: true });
    for (const [from, to] of pending) renameSync(from, to);
    return [{ id: "legacy-layout", outcome: "applied", detail: `relocated ${pending.length} legacy file(s)` }];
  },
};

export const ENV_MIGRATIONS: EnvMigration[] = [legacyLayout].sort((a, b) => a.level - b.level);
export const CURRENT_MIGRATION_LEVEL = ENV_MIGRATIONS.reduce((m, x) => Math.max(m, x.level), 0);

/** Run every migration with level > fromLevel, in order. Returns actions + the level to stamp. */
export function runEnvMigrations(fromLevel: number, deps: MigrationDeps): { actions: MigrationAction[]; level: number } {
  const actions: MigrationAction[] = [];
  for (const m of ENV_MIGRATIONS) {
    if (m.level <= fromLevel) continue;
    for (const a of m.apply(deps)) actions.push(a);
  }
  return { actions, level: CURRENT_MIGRATION_LEVEL };
}
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(migrations): add environment-migration ladder (legacy-layout = #1)`.

### Task 1.4: Make `readState` pure (location-tolerant read, no move)

**Files:** Modify `cli/src/core/state.ts`; Rewrite the legacy test in `cli/src/core/state.test.ts`.

- [ ] **Step 1: Update tests** — replace the old "readState migrates the loose dotfile" test with:

```ts
test("readState reads a pre-0.x loose dotfile IN PLACE without moving it", () => {
  withTempEnv(() => {
    mkdirSync(claudeHome(), { recursive: true });
    writeFileSync(legacyStateFile(), JSON.stringify({ version: "0.0.1", skills: [] }));
    const s = readState();
    expect(s?.version).toBe("0.0.1");
    expect(existsSync(legacyStateFile())).toBe(true);   // NOT moved
    expect(existsSync(stateFile())).toBe(false);
  });
});
```

- [ ] **Step 2: Run** → FAIL (old readState moves the file).
- [ ] **Step 3: Implement** — remove `migrateLegacyLayout` from `state.ts` (now lives in `migrations.ts` as migration #1) and drop its call from `readState`. New `readState`:

```ts
export function readState(): State | null {
  const f = existsSync(stateFile()) ? stateFile() : existsSync(legacyStateFile()) ? legacyStateFile() : null;
  if (!f) return null;
  return migrateState(JSON.parse(readFileSync(f, "utf8")));
}
```

- [ ] **Step 4: Run** `bun test` → PASS. Add a `doctor.test.ts` assertion that running `doctor` against a legacy layout does NOT create `stateFile()` or delete `legacyStateFile()` (doctor is read-only).
- [ ] **Step 5: Commit** `fix(state): readState is read-only; relocation is now a migration (doctor no longer mutates)`.

### Task 1.5: Run env-migrations inside `converge`; stamp `migrationLevel`

**Files:** Modify `cli/src/commands/converge.ts`; Test `cli/src/commands/converge.test.ts`.

- [ ] **Step 1: Failing test** — seed a legacy dotfile, run a full `setup`/`converge`, assert the dotfile was relocated, `state.migrationLevel === CURRENT_MIGRATION_LEVEL`, and the summary reports the migration. Add a dry-run variant asserting no relocation and no state write.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — near the top of `converge`, after `const prev = readState();`:

```ts
const fromLevel = prev?.migrationLevel ?? 0;
const mig = runEnvMigrations(fromLevel, { dryRun: opts.dryRun });
for (const a of mig.actions) if (a.outcome === "applied") summary.successes.push(`migration ${a.id}${a.detail ? ` — ${a.detail}` : ""}`);
```

Then in the `writeState({...})` call add `migrationLevel: mig.level,`. (Because migration #1 may relocate the legacy state file, re-`readState()` after migrations if `prev` was null but a legacy file existed — or simply compute `prev` after running migration #1. Keep it simple: run migrations first, then `readState()` for planning. Reorder so migrations precede the `readState` used for planning.)

- [ ] **Step 4: Run** `bun test` → PASS.
- [ ] **Step 5: Commit** `feat(converge): run pending env-migrations and stamp migrationLevel`.

### Task 1.6: Schema-snapshot guard + legacy fixtures scaffold

**Files:** Create `cli/test/schema-guard.test.ts`, `cli/test/schema/golden.json`, `cli/test/fixtures/legacy/state-v0.json`.

- [ ] **Step 1: Write the guard test:**

```ts
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Recursive structural signature: objects → sorted `key:typeof`; arrays → `[elemSig]`. */
function sig(v: any): any {
  if (Array.isArray(v)) return [v.length ? sig(v[0]) : "any"];
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, sig(v[k])]));
  return typeof v;
}

// One representative sample per persisted type, at its CURRENT shape.
const SAMPLES: Record<string, any> = {
  state: { stateSchemaVersion: 1, migrationLevel: 1, version: "0.1.0", installedAt: "t", updatedAt: "t",
           skills: [{ name: "x", hash: "h" }], marketplaces: [{ name: "m", source: "s" }],
           sources: [{ name: "slack", type: "plugin", marketplace: "m", plugin: "slack" }] },
  // undoRecord + undoIndex samples are ADDED in Phase 2 (Task 2.1).
};

test("persisted schemas match the committed golden signatures", () => {
  const golden = JSON.parse(readFileSync(join(import.meta.dir, "schema/golden.json"), "utf8"));
  for (const [name, sample] of Object.entries(SAMPLES)) {
    expect({ name, sig: sig(sample) }).toEqual({ name, sig: golden[name]?.sig });
    // If this fails: you changed a persisted shape. Bump its schemaVersion, ADD a
    // fixtured migration, then update test/schema/golden.json to match.
  }
});
```

- [ ] **Step 2:** Generate `golden.json` from the current samples once (print `sig(sample)` and paste), committing it as `{ "state": { "version": 1, "sig": { ... } } }`.
- [ ] **Step 3: Run** `bun test src/../test/schema-guard.test.ts` → PASS. Then deliberately add a bogus field to the `state` sample, confirm it FAILS with the guard message, and revert.
- [ ] **Step 4:** Add `test/fixtures/legacy/state-v0.json` (a pre-`migrationLevel`, pre-`stateSchemaVersion` state) and a test that `migrateState(fixture)` yields `stateSchemaVersion === CURRENT` and `migrationLevel === 0`.
- [ ] **Step 5: Commit** `test(schema): add snapshot guard forcing a migration on any persisted-shape change`.

### Task 1.7: Docs for Phase 1

**Files:** Modify `behavior.md`, `cli/README.md`.

- [ ] **Step 1:** In `behavior.md`, document: `migrationLevel` in the state shape; the two ladders (schema = pure at read; environment = side-effecting, run in `converge` under setup/update only, never in `readState`/`doctor`); that `doctor`/`readState` are read-only; the schema-guard/validated-migration rule. In `cli/README.md`, note the state now carries `migrationLevel` and that structural changes are migration-governed.
- [ ] **Step 2:** `bun test` green; `git commit -m "docs: describe versioning + migration ladders (behavior.md, README)"`.

**Chunk 1 done → dispatch plan-document-reviewer (or general-purpose review) before Chunk 2.**

---

## Chunk 2 (Phase 2): Undo journal + `ner-jarvis undo`

Every `setup`/`update` records what it did; `ner-jarvis undo` reverses a run interactively, replayed by the **current** binary (delegation comes in Phase 3).

### Task 2.1: Undo types + paths + schema samples

**Files:** Modify `cli/src/types.ts`, `cli/src/core/paths.ts`, `cli/test/schema-guard.test.ts`; Test `cli/src/core/paths.test.ts`.

- [ ] **Step 1: Failing test** (`paths.test.ts`): assert `undoDir()`, `undoIndexFile()`, `versionsDir()` end with `.claude/ner-jarvis/undo`, `.../undo/index.json`, `.../ner-jarvis/versions`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — add the three path helpers to `paths.ts`. Add to `types.ts`:

```ts
export type FileBlob = { path: string; contents: string };
export type UndoEntry =
  | { kind: "skill"; name: string; installedHash: string; priorFiles?: FileBlob[] }
  | { kind: "plugin"; name: string; plugin: string; marketplace: string; wasInstalledByUs: boolean }
  | { kind: "mcp"; name: string; transport: "http" | "sse"; url: string; prior?: { transport: "http" | "sse"; url: string } }
  | { kind: "marketplace"; name: string; source: string; wasAddedByUs: boolean }
  | { kind: "global-note" };

export interface UndoRecord {
  undoSchemaVersion: number;   // CURRENT = 1
  runId: string; version: string; command: "setup" | "update";
  createdAt: string; installed: UndoEntry[];
}
export interface UndoIndexEntry { runId: string; version: string; command: string; createdAt: string; recordPath: string; undone?: boolean; binaryPath?: string; npxVersion?: string; }
export interface UndoIndex { indexSchemaVersion: number; entries: UndoIndexEntry[]; } // CURRENT = 1
```

Add `undo` to `ParsedArgs["command"]` and a `list: boolean` field.

- [ ] **Step 4:** Add `undoRecord` and `undoIndex` samples to `SCHEMA_SAMPLES` in `schema-guard.test.ts` and their golden entries. Run the guard → PASS.
- [ ] **Step 5: Commit** `feat(types): undo record/index schemas + undo paths`.

### Task 2.2: Undo record writer + frozen index append

**Files:** Create `cli/src/core/undo.ts`, `cli/src/core/undo.test.ts`.

- [ ] **Step 1: Failing test** — `writeUndoRecord(record)` writes `undo/<runId>.json` and appends a matching entry to `undo/index.json`; `readUndoIndex()` returns it; a second call appends (never truncates). Assert `indexSchemaVersion`/`undoSchemaVersion` are stamped.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `undo.ts`: `CURRENT_UNDO_SCHEMA_VERSION`, `CURRENT_UNDO_INDEX_SCHEMA_VERSION`, `readUndoIndex()`, `writeUndoRecord(record, meta)` (mkdirs `undoDir()`, writes record, appends index entry with `recordPath` relative to `undoDir()`), `markUndone(runId)`. Best-effort like the decision log but these are read back, so surface parse errors as an empty index rather than throwing.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(undo): record writer + append-only index`.

### Task 2.3: `converge` captures prior content + emits an undo record

**Files:** Modify `cli/src/commands/converge.ts`, `cli/src/core/skills.ts` (add `currentSkillFiles`); Test `cli/src/commands/converge.test.ts`.

This is the heaviest change — do it in small steps.

- [ ] **Step 1: Failing test A** — a fresh full `converge` (install) writes an undo record whose `installed` lists the skill (no `priorFiles`), the plugin (`wasInstalledByUs:true`), and the mcp (no `prior`), and an index entry pointing at it.
- [ ] **Step 2: Failing test B** — an `--force` update over an edited skill records `priorFiles` equal to the pre-overwrite contents; an `mcp-replace` records `prior` = the previous url/transport.
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement:**
  - Add `currentSkillFiles(name): FileBlob[] | undefined` to `skills.ts` (walk dir, same relative-path convention as `currentSkillHash`).
  - In `converge`, accumulate `const installed: UndoEntry[] = []` as actions apply:
    - skill `install` → `{ kind:"skill", name, installedHash }` (no priorFiles).
    - skill `update`/`remove` → read `currentSkillFiles(name)` **before** applying → `priorFiles`.
    - `plugin-install` → `{ kind:"plugin", ..., wasInstalledByUs:true }`; `marketplace-add` → `{ kind:"marketplace", ..., wasAddedByUs:true }`.
    - `mcp-add` → `{ kind:"mcp", ... }`; `mcp-replace` → include `prior` from the tracked source.
    - global-note add (in `setup`, not converge) — see Step 6.
  - After the `writeState`, if `!opts.dryRun && installed.length`, call `writeUndoRecord({ undoSchemaVersion, runId, version: payload.version, command, createdAt, installed }, { binaryPath?/npxVersion? left for Phase 3 })`. `runId = <ISO-with-colons-replaced>-<command>`. `converge` needs to know the command — add `command: "setup" | "update"` to `ConvergeOpts` (default "setup").
- [ ] **Step 5: Run** → PASS both tests.
- [ ] **Step 6: Global note** — the global-CLAUDE.md add happens in `setup.ts`, not `converge`. Have `setup` append a `{ kind:"global-note" }` entry to the record. Simplest: `setup` collects an extra `UndoEntry[]` and `converge`/`setup` merge into one record for the run. Keep the record per-run: let `setup` pass its extra entries into `converge` (add optional `extraUndo?: UndoEntry[]` to `ConvergeOpts`) OR have `setup` append to the just-written record. Choose the `extraUndo` approach; add a test that a full interactive setup which adds the note records a `global-note` entry.
- [ ] **Step 7: Commit** `feat(converge): capture prior content and write a per-run undo record`.

### Task 2.4: Reverse-action application

**Files:** Modify `cli/src/core/undo.ts`; Test `cli/src/core/undo.test.ts`.

- [ ] **Step 1: Failing tests** — `applyUndoEntry(entry, {dryRun, force})` returns a result and:
  - skill w/o priorFiles → removes the dir (hash-guard: if on-disk hash ≠ `installedHash` and not `force` → skip with reason, leave in place).
  - skill w/ priorFiles → restores those files (write), hash-guard as above.
  - plugin `wasInstalledByUs` → issues `plugin uninstall`; else noop.
  - mcp w/ `prior` → `mcp-replace` back to prior; w/o prior → `mcp remove`.
  - marketplace → **never** issues `marketplace remove` (SAFETY — matches uninstall); tracking-only.
  - global-note → `removeGlobalContext()`.
  - dry-run issues no commands / writes nothing.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `applyUndoEntry` reusing `applySkillAction`, `pluginUninstall`, `mcpRemove`/`mcpAdd`, `removeGlobalContext`. Return `{ outcome: "undone" | "skipped" | "failed"; label: string; reason?: string }`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(undo): reverse-action application with skill hash-guard`.

### Task 2.5: `commands/undo.ts` (in-process, current version)

**Files:** Create `cli/src/commands/undo.ts`, `cli/src/commands/undo.test.ts`.

- [ ] **Step 1: Failing tests** (mirror `uninstall.test.ts` harness — shim logs argv, `withTempEnv`, `scriptedPrompter`):
  - `undo` with no runs → skipped "nothing to undo".
  - `undo --list` → prints the index (returns a summary, no changes).
  - `undo` (default = most recent, current version) interactive: per-entry prompt (Enter=undo / n=keep); a declined entry stays; marks the run `undone` only when all its entries were undone (else leaves it tracked). Reuses `RunSummary`/`exitCodeFor`.
  - `--yes` undoes every entry without prompting.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — signature `undo(opts: UndoOpts, deps: UndoDeps = {})` mirroring `uninstall`'s three modes (`minimal`/`assume-yes`/`interactive`), `list` short-circuits. Pick the target run: most recent `!undone` entry in the index (respect an optional `runId` target). **Phase-2 scope:** only handle runs whose `version === loadPayload().version` in-process; if a run's version differs, skip it with reason `"made by ner-jarvis <v>; delegation added in a later release"` (Phase 3 replaces this with real delegation). Prompt per `UndoEntry` label, call `applyUndoEntry`, fold into summary, log decisions, `markUndone` when fully reversed. Honor `--dry-run`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(undo): interactive ner-jarvis undo (current-version, in-process)`.

### Task 2.6: Wire `undo` + `--list` into the CLI

**Files:** Modify `cli/src/cli.ts`, `cli/src/index.ts`; Test `cli/src/cli.test.ts`.

- [ ] **Step 1: Failing test** — `parseArgs(["undo","--list"])` → `{command:"undo", list:true}`; `parseArgs(["undo","--dry-run"])` → dryRun.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — add `"undo"` to `KNOWN_COMMANDS`; parse `--list` → `list`; add `list` to `ParsedArgs` (default false). In `index.ts` add a `case "undo"` mirroring the `uninstall` case (TTY prompter, `isTTY`, `printSummary`, `exitCodeFor`); add `undo` to `HELP`.
- [ ] **Step 4: Run** `bun test` → PASS.
- [ ] **Step 5: Commit** `feat(cli): wire undo command + --list`.

### Task 2.7: Docs for Phase 2

**Files:** Modify `behavior.md`, `cli/README.md`, project `CLAUDE.md`.

- [ ] Document the undo journal (record shape, index, where stored), `ner-jarvis undo`/`--list` command surface + exit codes, and that a full run writes a record. Add `undo` to the README command list and the CLAUDE.md "ner-jarvis CLI" section. `bun test` green; commit `docs: undo journal + ner-jarvis undo`.

**Chunk 2 done → review before Chunk 3.**

---

## Chunk 3 (Phase 3): Per-version binary archival + delegation

`undo` delegates a run to the binary that made it, so the current binary never parses an old version's records/logic.

### Task 3.1: Per-version binary archival

**Files:** Create `cli/src/core/archive.ts`, `cli/src/core/archive.test.ts`; Modify `cli/src/commands/converge.ts`.

- [ ] **Step 1: Failing tests** — with a fake exec path (inject via a param/seam, not the real `process.execPath`): `archiveCurrentBinary("0.2.0")` on the binary channel copies the exe to `versions/0.2.0/<binName>` and is a no-op if already present (dedupe); on the npm channel it stores nothing and returns `null`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `archive.ts`: `archiveCurrentBinary(version, deps?: { channel?; execPath?; })` → binary channel copies `execPath` (default `process.execPath`) into `versionsDir()/version/`; npm returns null. Add `gcVersion(version)` that removes `versions/<version>/` when the index has no entries for it. In `converge`, after a successful non-dry-run write **when the version changed** (`prev?.version !== payload.version`), call `archiveCurrentBinary(payload.version)` and store the returned `binaryPath`/`npxVersion` on the undo index entry (extend `writeUndoRecord` meta).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(archive): store the running binary per version (binary channel), with GC`.

### Task 3.2: Invoke-a-copy-of-myself seam

**Files:** Create `cli/src/core/self.ts`, `cli/src/core/self.test.ts`.

- [ ] **Step 1: Failing test** — with `NER_JARVIS_SELF_BIN` pointed at a shim that logs argv, `runSelf({ binaryPath, npxVersion }, ["undo","--runId","R"])` invokes the override with those args and returns its exit code. Assert npx path builds `npx -y ner-jarvis@<version> ...` when `binaryPath` is absent.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `self.ts`: resolve the target argv — `NER_JARVIS_SELF_BIN` override wins (tests); else `binaryPath` (archived exe); else `["npx","-y",`ner-jarvis@${npxVersion}`]`. Spawn with `spawnSync(bin, args, { stdio: "inherit", env: process.env })` so interactive prompts pass through; return `status ?? 1`. `node:child_process` only.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(self): subprocess-of-self seam for version delegation`.

### Task 3.3: `undo` delegates foreign-version runs

**Files:** Modify `cli/src/commands/undo.ts`; Test `cli/src/commands/undo.test.ts`.

- [ ] **Step 1: Failing test** — an index entry with `version` ≠ current and a `binaryPath` (or `npxVersion`): `undo` (via injected `runSelf`) delegates with `["undo","--runId",<id>]` (+ pass-through `--yes`/`--dry-run`) instead of reversing in-process; a same-version run still runs in-process.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — replace the Phase-2 skip: when the target run's `version !== currentVersion`, call `runSelf(entry, [...])` (injectable via `deps.runSelf`), map its exit code into the summary, and let the delegated binary do `markUndone`. When equal, in-process as before.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(undo): delegate foreign-version rollback to the archived/pinned binary`.

### Task 3.4: GC an archived binary once its runs are all undone

**Files:** Modify `cli/src/commands/undo.ts` (or `core/undo.ts`); Test.

- [ ] **Step 1: Failing test** — after undoing the last live run for a version, `versions/<version>/` is removed; while a live run for that version remains, it is kept.
- [ ] **Step 2–4:** After `markUndone`, if no index entry for that version is still `!undone`, call `gcVersion(version)`. Run → PASS.
- [ ] **Step 5: Commit** `feat(undo): GC a version's archived binary when its runs are fully undone`.

### Task 3.5: Legacy/compat fixtures in CI

**Files:** Create `cli/test/fixtures/legacy/` records; `cli/test/compat.test.ts`.

- [ ] **Step 1: Tests** — (a) current binary reads a legacy `state.json` fixture and migrates it (schema chain); (b) current binary reads a frozen `index.json` fixture written by an "old" version and, for a foreign-version entry, calls `runSelf` (fake self-bin shim) rather than parsing the old record itself; (c) the schema guard still passes. All via shims — no real old binary, no real `claude`.
- [ ] **Step 2–4:** Add fixtures + assertions; run → PASS.
- [ ] **Step 5: Commit** `test(compat): current binary migrates old state + delegates foreign-version undo`.

### Task 3.6: Docs for Phase 3

**Files:** `behavior.md`, `cli/README.md`, project `CLAUDE.md`, `memory/project_ner_jarvis.md`.

- [ ] Document per-version archival + GC, delegation (binary channel vs npx), the `NER_JARVIS_SELF_BIN` seam, and the compat-fixture guarantee. Update the memory pointer + status/test count. `bun test` green; commit `docs: per-version rollback + delegation`.

---

## Final verification

- [ ] `cd cli && bun run embed && bun test` — full suite green.
- [ ] `bun run build:binary` succeeds; `./dist/ner-jarvis --help` lists `undo`.
- [ ] Manual pty smoke (like `scratchpad/pty_uninstall.py`): a full `setup` writes an undo record + index entry; `ner-jarvis undo` interactively reverses it; `undo --list` shows the stack.
- [ ] `behavior.md`, `README`, ADR-0004, CLAUDE.md, and memory all reflect the shipped behavior.
- [ ] Do **not** push; report the branch and let the user open the PR.

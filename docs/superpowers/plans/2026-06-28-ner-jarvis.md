# ner-jarvis Implementation Plan

> **Historical record — completed.** Kept for the *why*, not the *where*. File
> paths below are pre-migration: this plan was written when the CLI lived in a
> `cli/` subdirectory of `bracyw/ner-onboarding-agent`. It is now the root of
> `Northeastern-Electric-Racing/ner-jarvis-cli`, so read `cli/src/...` as
> `src/...`. Do not "fix" the paths here — that would falsify the record.

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `ner-jarvis`, a cross-platform CLI that installs NER's five Claude Code skills and connects its data sources (each by plugin *or* MCP) in one command, with idempotent, non-destructive, targetable `setup`/`update`/`doctor`/`uninstall`.

**Architecture:** ner-jarvis is its own standalone repo (local-only for now, at `~/Desktop/ner/app_software/ner-jarvis`), split into a payload (`.claude/skills/` + `sources.json`) and a `cli/` where the implementation language lives. `cli/` is a thin orchestrator: it copies skill directories into `~/.claude/skills/`, shells out to `claude plugin …` / `claude mcp …` to wire sources, and records what it did in `~/.claude/.ner-jarvis.json` so re-runs reconcile against that state. The payload — the repo's `.claude/skills/` plus `sources.json` — is embedded into the compiled binary at build time. Placing the skills in `.claude/skills/` makes them both the canonical payload source and the project-scoped skills active in Claude Code when working in this repo (dogfooding).

**Tech Stack:** TypeScript on Bun (runtime, test runner, `bun build --compile`). **`node:` builtins only** (`node:child_process`, `node:crypto`, `node:fs`, `node:os`, `node:path`) so the same code runs under both Bun (binary) and Node (npx). No runtime dependencies. GitHub Actions for the cross-platform binary matrix + npm publish.

---

## Source of truth

Spec: `docs/superpowers/specs/2026-06-28-ner-jarvis-cli-design.md` (copied into this repo under `docs/superpowers/` so it is self-contained). The spec is the behavior contract; this plan implements it. Where they ever disagree, the spec wins — fix the plan.

## Decisions this plan locks in (resolving spec §12)

1. **Cross-runtime:** production code imports only `node:` builtins. No `Bun.*` APIs in shipped code (Bun is the build tool + test runner only). This is what lets one codebase feed both channels.
2. **Payload embedding:** `scripts/embed-payload.ts` reads the repo's `.claude/skills/` + `sources.json` and emits `cli/src/payload.generated.ts` (git-ignored) exporting a typed `EMBEDDED_PAYLOAD`. `bun build --compile` inlines it.
3. **Standalone-repo topology / skills sourcing:** ner-jarvis is its own repo (local-only for now — `git init`, no GitHub remote). The five skills are transferred into `.claude/skills/` at the repo root, which is the **single source of truth**: the build embeds it directly (no vendoring, no sync script, no drift), and it doubles as the project-scoped skill set active in Claude Code when developing here (dogfooding). Publishing to a `Northeastern-Electric-Racing/ner-jarvis` remote later is a `git remote add` + push, not a rebuild.
4. **`sources.json` seed:** `slack` → `plugin`; `atlassian` + `github` → `mcp`. This mirrors the maintainer's working setup and forces both code paths to exist from day one. Exact marketplace/plugin ids and MCP URLs are confirmed in Task 2.
5. **`claude` invocation seam:** `claude.ts` reads `NER_JARVIS_CLAUDE_BIN` (a command string, default `"claude"`) for testability. Tests point it at a fake shim; production leaves it unset.
6. **No network in v1 update self-update:** `update` *detects* a newer release and instructs the user (binary channel) rather than rewriting a running executable. Auto-replace is deferred (spec §12).

## Testing approach (applies to every task below)

Use @superpowers:test-driven-development. Tests are co-located (`foo.ts` ↔ `foo.test.ts`) and run with `bun test`. Two layers:

- **Unit:** pure functions (hashing, state I/O, command construction, reconciliation planning) with no real `claude` and a temp `HOME`.
- **Integration:** command functions run in-process against (a) a temp `HOME` dir and (b) a **fake `claude` shim** (built in Task 18, used earlier via a small inline version in Task 7). The shim logs every argv to a file and returns canned stdout/exit codes. Production code finds it via `NER_JARVIS_CLAUDE_BIN`.

**Test isolation helper** (built in Task 4, reused everywhere): `withTempEnv(fn)` creates a temp dir, sets `HOME`/`USERPROFILE` to it, restores env after. Never touch the real `~/.claude` in tests.

## File structure (standalone `ner-jarvis` repo)

**Path convention:** everything lives in the standalone `ner-jarvis` repo (local-only for now, at `~/Desktop/ner/app_software/ner-jarvis`). The CLI package is at `cli/`; `bun`/`git` commands for the package run from `cli/`, so bare `src/…` / `test/…` paths are relative to it. The five skills live at `.claude/skills/` (repo root) — the canonical source, embedded directly at build time.

```
<repo root: ner-jarvis — standalone, local-only for now>
  .claude/skills/              # the 5 skill dirs — canonical source, embedded directly; active in-repo (dogfooded)
  sources.json                 # { marketplaces:[…], sources:[ plugin|mcp … ] }
  behavior.md                  # the language-agnostic contract (adapted from the design spec)
  README.md                    # tool usage
  docs/superpowers/            # spec + this plan (copied in so the repo is self-contained)
  .github/workflows/
    ci.yml                     # build matrix + smoke tests (working-directory: cli)
    release.yml                # binaries → Release; npm publish
  cli/
    package.json
    tsconfig.json
    .gitignore                 # ignores src/payload.generated.ts, dist/, node_modules/
    scripts/
      embed-payload.ts         # ../../.claude/skills/ + ../../sources.json → src/payload.generated.ts
    src/
      index.ts                 # entry: parse argv → dispatch → process.exit(code)
      cli.ts                   # arg parser → { command, targets[], force, dryRun }
      types.ts                 # Payload, Source (PluginSource|McpSource), State, actions
      payload.generated.ts     # GENERATED (git-ignored): EMBEDDED_PAYLOAD
      core/
        paths.ts               # ~/.claude, skills dir, state-file path
        payload.ts             # load + validate EMBEDDED_PAYLOAD → Payload
        hash.ts                # stable content hash of a skill directory
        state.ts               # read/write/migrate ~/.claude/.ner-jarvis.json
        claude.ts              # the ONLY place that builds & runs `claude …` commands
        preflight.ts           # claude on PATH? git? ~/.claude writable?
        skills.ts              # planSkills() + applySkillAction() (non-destructive)
        sources.ts             # planSources() + applySourceAction() (plugin|mcp)
        report.ts              # run summary + exit-code aggregation
      commands/
        setup.ts               # the 7-step wizard
        update.ts              # release check + reconcile (full or targeted)
        doctor.ts              # read-only health check
        uninstall.ts           # remove only what we installed
    test/
      helpers.ts               # withTempEnv()
      fake-claude.ts           # canonical fake `claude` shim builder
      e2e.test.ts              # end-to-end lifecycle tests
```

Each `core/*` module is small and single-purpose; command files only orchestrate them.

---

## Chunk 1: Repo scaffold & payload

### Task 1: Initialize the standalone `ner-jarvis` repo and Bun project

**Files:**
- Create: repo at `~/Desktop/ner/app_software/ner-jarvis` (`git init`, local-only — no GitHub remote)
- Create: `.claude/skills/` (the 5 skill dirs, transferred in) and root `.gitignore`
- Create: `cli/package.json`, `cli/tsconfig.json`, `cli/.gitignore`
- Create: directories `cli/src/core/`, `cli/src/commands/`, `cli/test/`, `cli/scripts/`

- [ ] **Step 1: Create the standalone repo.** `git init` a new local repo at `~/Desktop/ner/app_software/ner-jarvis` — no GitHub remote for v1. Transfer the five NER skills into `.claude/skills/` (canonical source of truth; also makes them active in Claude Code when working in this repo).
- [ ] **Step 2: Create the cli skeleton.** `mkdir -p` the `cli/` directories above.
- [ ] **Step 3: Write `cli/package.json`.** Name `ner-jarvis`, `"type": "module"`, `"bin": { "ner-jarvis": "./dist/index.js" }`, scripts: `test` (`bun test`), `embed` (`bun run scripts/embed-payload.ts`), `build:binary`, `build:npm` (filled in Chunk 5). No `dependencies`.
- [ ] **Step 4: Write `cli/tsconfig.json`.** `strict: true`, `module`/`moduleResolution` for bundler, `types: ["bun-types"]` (dev only), target ES2022.
- [ ] **Step 5: Write `cli/.gitignore`.** Ignore `src/payload.generated.ts`, `dist/`, `node_modules/`.
- [ ] **Step 6: Smoke-check Bun.** Run: `bun --version`. Expected: prints a version (Bun is the toolchain).
- [ ] **Step 7: Commit.** `git add -A && git commit -m "chore: scaffold ner-jarvis standalone repo + bun project"`

> **Note (done ahead of execution):** the repo, the `.claude/skills/` transfer, and the `cli/` scaffold (package.json/tsconfig/.gitignore + dir tree) were stood up during design so the repo is real. Re-verify they match this task; execution effectively begins at Task 2.

### Task 2: Author the source manifest (`sources.json`)

The five skills already live at `.claude/skills/` (transferred in Task 1) and are embedded directly (decision #3) — nothing more to vendor.

**Files:**
- Create: `sources.json` (repo root)

- [ ] **Step 1: Confirm the source delivery facts.** For each source, confirm against the live `claude` CLI and the providers' docs: Slack's marketplace source + plugin name; Atlassian's and GitHub's remote MCP URL + transport. Record findings in `behavior.md` (repo root). (This resolves the spec §12 "decide per source" item.)
- [ ] **Step 2: Write `sources.json` (repo root).** Shape:

```json
{
  "marketplaces": [
    { "name": "<slack-marketplace-name>", "source": "<owner/repo-or-url>" }
  ],
  "sources": [
    { "name": "slack", "type": "plugin", "marketplace": "<slack-marketplace-name>", "plugin": "<slack-plugin-name>" },
    { "name": "atlassian", "type": "mcp", "transport": "<http|sse>", "url": "<atlassian-mcp-url>" },
    { "name": "github", "type": "mcp", "transport": "<http|sse>", "url": "<github-mcp-url>" }
  ]
}
```

- [ ] **Step 3: Commit.** `git add sources.json && git commit -m "feat: add sources.json manifest"`

### Task 3: Payload embedding + loader

**Files:**
- Create: `cli/scripts/embed-payload.ts`
- Create: `cli/src/types.ts`
- Create: `cli/src/core/payload.ts`, `cli/src/core/payload.test.ts`

- [ ] **Step 1: Define types** in `types.ts`:

```ts
export interface Marketplace { name: string; source: string; }
export interface PluginSource { name: string; type: "plugin"; marketplace: string; plugin: string; }
export interface McpSource { name: string; type: "mcp"; transport: "http" | "sse"; url: string; }
export type Source = PluginSource | McpSource;

export interface EmbeddedSkill { name: string; files: { path: string; contents: string }[]; }
export interface EmbeddedPayload {
  version: string;
  skills: EmbeddedSkill[];
  marketplaces: Marketplace[];
  sources: Source[];
}
export type Payload = EmbeddedPayload; // loader returns the validated embedded payload
```

- [ ] **Step 2: Write the embed script.** `embed-payload.ts` walks the repo's `.claude/skills/*` (each dir → `{ name, files:[{path,contents}] }`), reads `sources.json`, reads `version` from `cli/package.json`, and writes `cli/src/payload.generated.ts` exporting `export const EMBEDDED_PAYLOAD: EmbeddedPayload = {…}` (JSON-stringified, typed). Resolve the repo root from the script's own location (`cli/scripts/` → `../../`). Use `node:fs`.
- [ ] **Step 3: Write the failing test** `payload.test.ts`:

```ts
import { test, expect } from "bun:test";
import { loadPayload } from "./payload";

test("loadPayload returns 5 skills and validated sources", () => {
  const p = loadPayload();
  expect(p.skills.length).toBe(5);
  expect(p.skills.every(s => s.files.some(f => f.path.endsWith("SKILL.md")))).toBe(true);
  for (const src of p.sources) expect(["plugin", "mcp"]).toContain(src.type);
  expect(p.version).toMatch(/\d+\.\d+\.\d+/);
});

test("loadPayload rejects a malformed source", () => {
  expect(() => validatePayload({ version: "1.0.0", skills: [], marketplaces: [],
    sources: [{ name: "x", type: "mcp" }] as any })).toThrow();
});
```

- [ ] **Step 4: Run it, expect FAIL** (`loadPayload`/`validatePayload` not defined). Run: `bun test src/core/payload.test.ts`
- [ ] **Step 5: Implement `payload.ts`.** Run `bun run embed` first. `loadPayload()` imports `EMBEDDED_PAYLOAD`, runs `validatePayload()` (every source has a known `type`; `plugin` has `marketplace`+`plugin`; `mcp` has `transport`+`url`; each `plugin` source's `marketplace` exists in `marketplaces`), returns it. Throw a clear error on any violation.
- [ ] **Step 6: Run tests, expect PASS.**
- [ ] **Step 7: Commit.** `git add -A && git commit -m "feat: embed + validate payload"`

---

## Chunk 2: Core primitives

### Task 4: Paths + test harness

**Files:**
- Create: `cli/src/core/paths.ts`, `cli/src/core/paths.test.ts`
- Create: `cli/test/helpers.ts`

- [ ] **Step 1: Write `test/helpers.ts`** with `withTempEnv()`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Run `fn` with HOME/USERPROFILE pointed at a fresh temp dir; restore after. */
export function withTempEnv<T>(fn: (home: string) => T): T {
  const home = mkdtempSync(join(tmpdir(), "nerj-"));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home; process.env.USERPROFILE = home;
  try { return fn(home); }
  finally {
    process.env.HOME = saved.HOME; process.env.USERPROFILE = saved.USERPROFILE;
    rmSync(home, { recursive: true, force: true });
  }
}
```

- [ ] **Step 2: Write failing test** `paths.test.ts`: under `withTempEnv`, `skillsDir()` ends with `.claude/skills` and is under the temp home; `stateFile()` ends with `.claude/.ner-jarvis.json`.
- [ ] **Step 3: Run it, expect FAIL.** Run: `bun test src/core/paths.test.ts`
- [ ] **Step 4: Implement `paths.ts`** using `node:os` `homedir()` and `node:path` `join()`: `claudeHome()`, `skillsDir()`, `stateFile()`. (`homedir()` reads `HOME`/`USERPROFILE`, so `withTempEnv` redirects it.)
- [ ] **Step 5: Run tests, expect PASS. Commit.** `git commit -m "feat: path resolution + temp-env test harness"`

### Task 5: Content hashing

**Files:** Create `cli/src/core/hash.ts`, `cli/src/core/hash.test.ts`

- [ ] **Step 1: Write failing test:** `hashSkill(files)` is stable regardless of input file order; differs when any file's `contents` or `path` changes.

```ts
test("hashSkill is order-independent and content-sensitive", () => {
  const a = [{ path: "SKILL.md", contents: "x" }, { path: "ref.md", contents: "y" }];
  const b = [{ path: "ref.md", contents: "y" }, { path: "SKILL.md", contents: "x" }];
  expect(hashSkill(a)).toBe(hashSkill(b));
  expect(hashSkill(a)).not.toBe(hashSkill([{ path: "SKILL.md", contents: "z" }, ...]));
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** with `node:crypto`: sort files by `path`, feed `path + "\0" + contents + "\0"` for each into one `createHash("sha256")`, return hex.
- [ ] **Step 4: Run, expect PASS. Commit.** `git commit -m "feat: stable skill content hashing"`

### Task 6: State file (read/write/migrate)

**Files:** Create `cli/src/core/state.ts`, `cli/src/core/state.test.ts`. Add `State`, `SkillState` to `types.ts`:

```ts
export interface SkillState { name: string; hash: string; }
export interface State {
  stateSchemaVersion: number;            // CURRENT = 1
  version: string;
  installedAt: string; updatedAt: string;
  skills: SkillState[];
  marketplaces: Marketplace[];
  sources: Source[];
}
```

- [ ] **Step 1: Write failing tests** (under `withTempEnv`): `readState()` returns `null` when the file is absent; `writeState(s)` then `readState()` round-trips; `readState()` on an unknown/older `stateSchemaVersion` runs `migrateState` and returns a current-shape object (v1: just stamp the version, no field changes yet).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** `readState()` → `null` if `stateFile()` missing, else parse JSON and pass through `migrateState`. `writeState()` → `mkdirSync(claudeHome(),{recursive:true})` then write pretty JSON. `migrateState(raw)` → switch on `stateSchemaVersion` (default/unknown → coerce to v1, never throw away unknown sources). Use `node:fs`.
- [ ] **Step 4: Run, expect PASS. Commit.** `git commit -m "feat: state read/write/migrate"`

### Task 7: `claude` command wrapper (the single shell-out seam)

**Files:** Create `cli/src/core/claude.ts`, `cli/src/core/claude.test.ts`

- [ ] **Step 1: Verify the real command surface FIRST.** Against the installed CLI, run and record (into `behavior.md`) the exact synopsis of: `claude mcp add --help` (confirm `--transport` values, `--scope` default, and the `<name> <url>` arg order), `claude mcp get/list/remove --help`, whether `claude mcp login` exists (and if not, that re-auth is `/mcp`-only), `claude plugin marketplace add/remove --help`, `claude plugin install/update/uninstall --help` (confirm `<plugin>@<marketplace>` form), and that `claude plugin list --json` emits machine-readable JSON. Also run `claude mcp list` and record the **literal status-marker strings** it prints (the exact "connected" / "pending authentication" / failure wording) — `doctor` (Task 15) parses these best-effort, so capture them verbatim rather than guessing. The wrapper below must match what you record.
- [ ] **Step 2: Write failing tests** using an inline fake shim (point `NER_JARVIS_CLAUDE_BIN` at a temp script that echoes its argv to a log): assert `mcpAdd("github","http","https://x")` invokes `claude mcp add --transport http github https://x --scope user` (or whatever Step 1 confirmed); assert `pluginInstall("p","m")` invokes `claude plugin install p@m`; assert `pluginListJson()` parses the shim's canned JSON; assert a non-zero shim exit surfaces as `code !== 0` (not a throw).
- [ ] **Step 3: Run, expect FAIL.**
- [ ] **Step 4: Implement `claude.ts`:**

```ts
import { execFileSync } from "node:child_process";

export interface RunResult { code: number; stdout: string; stderr: string; }

function baseCmd(): string[] {
  const override = process.env.NER_JARVIS_CLAUDE_BIN;
  return override ? override.split(" ") : ["claude"];
}
export function runClaude(args: string[]): RunResult {
  const [bin, ...prefix] = baseCmd();
  try {
    const stdout = execFileSync(bin, [...prefix, ...args], { encoding: "utf8" });
    return { code: 0, stdout, stderr: "" };
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}
export const isClaudeAvailable = () => runClaude(["--version"]).code === 0;

// Sources — exact flags per Step 1 findings:
export const mcpAdd = (name: string, transport: string, url: string) =>
  runClaude(["mcp", "add", "--transport", transport, name, url, "--scope", "user"]);
export const mcpGet = (name: string) => runClaude(["mcp", "get", name]);
export const mcpRemove = (name: string) => runClaude(["mcp", "remove", name, "--scope", "user"]);
export const mcpListText = () => runClaude(["mcp", "list"]).stdout;
export const pluginMarketplaceAdd = (source: string) => runClaude(["plugin", "marketplace", "add", source]);
export const pluginInstall = (plugin: string, mp: string) => runClaude(["plugin", "install", `${plugin}@${mp}`]);
export const pluginUpdate = (plugin: string, mp: string) => runClaude(["plugin", "update", `${plugin}@${mp}`]);
export const pluginUninstall = (plugin: string, mp: string) => runClaude(["plugin", "uninstall", `${plugin}@${mp}`]);
export function pluginListJson(): { name: string; marketplace?: string; enabled?: boolean }[] {
  const r = runClaude(["plugin", "list", "--json"]);
  if (r.code !== 0) return [];
  try { const j = JSON.parse(r.stdout); return Array.isArray(j) ? j : (j.plugins ?? []); }
  catch { return []; }
}
```

> NOTE: never log or persist secrets — `runClaude` returns stdout/stderr to callers; callers must not print MCP auth output. `claude mcp get`/`list` have no `--json`; `doctor` parses their text best-effort (Task 15).

- [ ] **Step 5: Run, expect PASS. Commit.** `git commit -m "feat: claude CLI wrapper (verified command surface)"`

### Task 8: Preflight checks

**Files:** Create `cli/src/core/preflight.ts`, `cli/src/core/preflight.test.ts`

- [ ] **Step 1: Write failing test:** `preflight()` returns `{ ok:false, problems:[…] }` listing a clear message when `claude` is unavailable (point `NER_JARVIS_CLAUDE_BIN` at a missing path); `ok:true` when the shim is present and `~/.claude` is writable.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement:** check `isClaudeAvailable()`; check `git` similarly (`execFileSync("git",["--version"])`); check `~/.claude` is creatable/writable (`mkdirSync` + access). Aggregate problems with actionable install guidance.
- [ ] **Step 4: Run, expect PASS. Commit.** `git commit -m "feat: preflight checks"`

---

## Chunk 3: Reconciliation logic

### Task 9: Skills reconciliation

**Files:** Create `cli/src/core/skills.ts`, `cli/src/core/skills.test.ts`. Add to `types.ts`:

```ts
export type SkillAction =
  | { kind: "install" | "update" | "remove"; name: string }
  | { kind: "skip-foreign" | "skip-modified"; name: string; reason: string }
  | { kind: "noop"; name: string };
export interface ReconcileOpts { targets?: string[]; force: boolean; full: boolean; }
```

- [ ] **Step 1: Write failing tests** for `planSkills(payload, state, onDiskHashes, opts)` (pure function; `onDiskHashes: Record<name,hash|undefined>`):
  - fresh system (empty state, nothing on disk) → all `install`.
  - skill in state, on-disk hash == recorded, payload hash differs → `update`.
  - skill in state, on-disk hash == recorded, payload hash same → `noop`.
  - skill on disk but absent from state → `skip-foreign`.
  - skill in state but on-disk hash != recorded (user-edited), no `--force` → `skip-modified`; with `--force` → `update`.
  - **full run:** skill in state, gone from payload, on-disk == recorded → `remove`. **targeted run** (`targets:["x"]`): never emits `remove`; only acts on named skills.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `planSkills`** exactly per those rules (targeting filters the candidate set to `targets`; `full` gates removal). Then `applySkillAction(action, payload, {dryRun})`: `install`/`update` → write the skill's files under `skillsDir()/name/…`; `remove` → `rmSync` that dir; `skip-*`/`noop` → nothing. When `dryRun`, perform no FS writes (return what would happen). Use `node:fs`.
- [ ] **Step 4: Add an applier test** (under `withTempEnv`): `install` writes `SKILL.md`; `dryRun install` writes nothing; `remove` deletes only the named dir.
- [ ] **Step 5: Run, expect PASS. Commit.** `git commit -m "feat: non-destructive skills reconciliation"`

### Task 10: Sources reconciliation (plugin | mcp dispatch)

**Files:** Create `cli/src/core/sources.ts`, `cli/src/core/sources.test.ts`. Add to `types.ts`:

```ts
export type SourceAction =
  | { kind: "marketplace-add"; marketplace: Marketplace }
  | { kind: "plugin-install" | "plugin-update" | "plugin-uninstall"; source: PluginSource }
  | { kind: "mcp-add" | "mcp-replace" | "mcp-remove"; source: McpSource }
  | { kind: "marketplace-prune"; marketplace: Marketplace }
  | { kind: "skip-foreign"; name: string; reason: string }
  | { kind: "noop"; name: string };

/** What the live system currently shows, gathered read-only before planning. */
export interface ClaudeView {
  installedPlugins: { name: string; marketplace?: string }[]; // from `claude plugin list --json`
  presentMcp: Record<string, { transport?: string; url?: string } | undefined>; // from `claude mcp get`
}
```

- [ ] **Step 1: Write failing tests** for `planSources(payload, state, view, opts)` (pure):
  - **plugin source**, marketplace not in state → `marketplace-add` then `plugin-install`.
  - plugin already installed and tracked in state → `plugin-update`.
  - plugin present in `view.installedPlugins` but NOT in our state → `skip-foreign` (never clobber).
  - **mcp source** absent from `view.presentMcp` and state → `mcp-add`.
  - mcp tracked in state but payload `url`/`transport` differs → `mcp-replace`.
  - mcp present in `view` but NOT in our state → `skip-foreign`.
  - mcp tracked + identical → `noop`.
  - **full run:** plugin/mcp in state but gone from payload → `plugin-uninstall` / `mcp-remove`; a marketplace we added that no remaining plugin needs → `marketplace-prune`. **targeted run:** never emits any remove/uninstall/prune.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `planSources`** per those rules, dispatching on `source.type`. Then `applySourceAction(action, {dryRun})` mapping each kind to the `claude.ts` helper (`pluginMarketplaceAdd`/`pluginInstall`/`pluginUpdate`/`pluginUninstall`, `mcpAdd`/`mcpRemove`, `mcp-replace` = `mcpRemove` then `mcpAdd`). `dryRun` → describe only, run nothing. Return each helper's `RunResult` so the caller can record success/failure.
- [ ] **Step 4: Add a `gatherClaudeView()` helper** (impure, in `sources.ts`): builds `ClaudeView` from `pluginListJson()` and a `mcpGet(name)` probe per payload source name. Tested via the fake shim in Task 18.
- [ ] **Step 5: Run unit tests, expect PASS. Commit.** `git commit -m "feat: source reconciliation for plugin + mcp"`

### Task 11: Run summary + exit codes

**Files:** Create `cli/src/core/report.ts`, `cli/src/core/report.test.ts`

- [ ] **Step 1: Write failing tests:** `exitCodeFor(summary)` → `0` when no failures (skips don't count as failures); non-zero when ≥1 failure. `printSummary` lists successes / skips (with reason) / failures (with retry hint).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `RunSummary { successes:string[]; skipped:{item,reason}[]; failures:{item,error}[] }`, `printSummary`, `exitCodeFor`. Never include secret-bearing strings.
- [ ] **Step 4: Run, expect PASS. Commit.** `git commit -m "feat: run summary + exit-code aggregation"`

---

## Chunk 4: Commands & CLI

### Task 12: Argument parser

**Files:** Create `cli/src/cli.ts`, `cli/src/cli.test.ts`. Add `ParsedArgs` to `types.ts`.

```ts
export interface ParsedArgs {
  command: "setup" | "update" | "doctor" | "uninstall" | "version" | "help";
  targets: string[]; force: boolean; dryRun: boolean;
}
```

- [ ] **Step 1: Write failing tests:** `parseArgs([])` → `setup`, no targets. `parseArgs(["update"])` → `update`. `parseArgs(["setup","slack"])` → command `setup`, `targets:["slack"]`. `parseArgs(["doctor","github","--dry-run"])` → targets `["github"]`, `dryRun:true`. `parseArgs(["--force","setup","ner-onboard"])` → `force:true`. `parseArgs(["--version"])` → `version`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `parseArgs(argv)`:** `--version/-v`→`version`, `--help/-h`→`help` (override). `--force`→force, `--dry-run`→dryRun. The **first** non-flag token, if one of `setup|update|doctor|uninstall`, sets `command` (default `setup`); every **subsequent** non-flag token is a target. No external deps.
- [ ] **Step 4: Run, expect PASS. Commit.** `git commit -m "feat: argument parser (commands, targets, flags)"`

### Task 13: `converge()` core + `setup` command

**Files:** Create `cli/src/commands/converge.ts`, `cli/src/commands/setup.ts` (+ `.test.ts` for each). `converge()` is the shared engine reused by `update` (DRY).

- [ ] **Step 1: Write failing tests** (integration, under `withTempEnv` + fake shim — see Task 18 helper, build a minimal version inline here):
  - `setup` on a clean system → all 5 skills written to disk; each source action dispatched (assert shim recorded `plugin marketplace add`/`plugin install` for the plugin source and `mcp add` for the mcp sources); state file written with version, skills (name+hash), marketplaces, sources.
  - `setup` run twice → second run makes no skill writes and records only `noop`/`plugin-update` (idempotent).
  - `setup slack` (targeted) → touches only the `slack` source; skills untouched; nothing removed.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `converge(payload, opts): RunSummary`:** compute on-disk skill hashes (`hash.ts`) → `planSkills` → `applySkillAction` each; `gatherClaudeView()` → `planSources` → `applySourceAction` each; collect successes/skips/failures into a `RunSummary`; write the new `State` (preserving items outside the target set on targeted runs). Honor `dryRun` (no writes, no `claude` mutations — only the read-only `gatherClaudeView`).
- [ ] **Step 4: Implement `setup`:** run `preflight()` (stop, non-zero, on hard failure) → `converge({full:true,…})` → **guide auth** (print exact next step: open `claude`, run `/mcp`, authenticate each source; or `claude mcp login <name>` if Step-1/Task-7 confirmed it exists) → **verify** by invoking `doctor`'s checks (Task 15) → print "Next: open Claude Code and try the `ner-onboard` skill" → return `RunSummary`.
- [ ] **Step 5: Run, expect PASS. Commit.** `git commit -m "feat: converge engine + setup wizard"`

### Task 14: `update` command

**Files:** Create `cli/src/commands/update.ts`, `cli/src/commands/update.test.ts`

- [ ] **Step 1: Write failing tests:** after a payload change (add a skill, change an mcp `url`, drop a source) a **full** `update` produces the right install/update/replace/remove actions; `update slack` (targeted) reconciles only `slack` and removes nothing. On the binary channel a newer release version is *reported* (mock the version check), not auto-applied.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `update`:** Determine the distribution channel from a build-time constant (`CHANNEL: "binary" | "npm"`, injected by each build script in Task 19). On the `binary` channel, fetch the latest release tag from the GitHub Releases API and compare to the embedded `version`; if newer, print upgrade guidance (per decision #6 it only *reports* — it never rewrites the running executable; tests mock this fetch). On `npm`, skip the check (`npx` already resolves `@latest`). Then `converge({ full: targets.length === 0, targets, force, dryRun })` — reuse `converge`, no duplicated reconciliation logic.
- [ ] **Step 4: Run, expect PASS. Commit.** `git commit -m "feat: update command (release check + reconcile)"`

### Task 15: `doctor` command (read-only)

**Files:** Create `cli/src/commands/doctor.ts`, `cli/src/commands/doctor.test.ts`

- [ ] **Step 1: Write failing tests** (fake shim + temp HOME): with no state → reports "not set up here" and exits non-zero. After a `setup`: a present skill → ✓; a deleted skill dir → ✗ missing; an edited skill (hash mismatch) → ⚠ modified. A plugin source present in `plugin list --json` → ✓; an mcp source where `mcp get` exits 0 → present; auth status parsed best-effort from `mcp list` text (shim returns a line with a "Pending"/"Connected" marker) and degrades to "run /mcp to confirm" when unparseable. `doctor github` scopes to one source. **Never writes** (assert state file unchanged).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `doctor`:** read state; for each (optionally targeted) skill check dir + hash; for each source check presence (`pluginListJson` for plugin, `mcpGet` for mcp) and parse `mcpListText` best-effort for auth/connection markers (exact marker strings per Task 7 Step 1). Print a status table + concrete fixes. Exit non-zero if anything is missing/unhealthy (so CI can gate). Read-only: calls only `--version`/`list`/`get`.
- [ ] **Step 4: Run, expect PASS. Commit.** `git commit -m "feat: doctor read-only health check"`

### Task 16: `uninstall` command

**Files:** Create `cli/src/commands/uninstall.ts`, `cli/src/commands/uninstall.test.ts`

- [ ] **Step 1: Write failing tests:** `uninstall` removes only state-tracked skills whose on-disk hash still matches (user-edited ones are preserved + warned); runs `plugin uninstall`/`mcp remove` for tracked sources and prunes only marketplaces it added; deletes the state file last. A foreign same-named skill/source is left intact. `--dry-run` removes nothing.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `uninstall`** as the inverse of `converge` against state (not payload): reuse `applySkillAction({kind:"remove"})` guarded by the hash check, and source removals via `claude.ts`. Honor `--dry-run`/`--force`. Remove the state file only after the rest succeeds.
- [ ] **Step 4: Run, expect PASS. Commit.** `git commit -m "feat: uninstall (removes only what we installed)"`

### Task 17: Entry point wiring

**Files:** Create `cli/src/index.ts`, `cli/src/index.test.ts`

- [ ] **Step 1: Write failing test:** `run(["--version"])` prints the embedded version and resolves exit `0`; `run(["doctor"])` on a clean temp HOME resolves a non-zero code; an unknown command prints help and exits non-zero.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** `run(argv): number` → `parseArgs` → dispatch to the command, map its `RunSummary` through `exitCodeFor`; `version`/`help` handled directly. `index.ts` top-level: `process.exit(run(process.argv.slice(2)))`. Add a `#!/usr/bin/env node` shebang for the npm/npx build.
- [ ] **Step 4: Run, expect PASS. Commit.** `git commit -m "feat: CLI entry point + dispatch"`

---

## Chunk 5: Integration, build & release

### Task 18: End-to-end integration tests + the canonical fake shim

**Files:** Create `cli/test/fake-claude.ts` (the reusable shim builder) and `cli/test/e2e.test.ts`

- [ ] **Step 1: Build the fake-claude shim builder.** `makeFakeClaude({responses})` writes a small executable script to a temp dir, returns `{ binEnv, logPath }` where `binEnv` is the value for `NER_JARVIS_CLAUDE_BIN` (e.g. `"bun /abs/path/shim.ts"` so it runs cross-platform via the current runtime). The shim appends each argv (JSON line) to `logPath` and emits canned stdout + exit code keyed by the subcommand (e.g. `plugin list --json` → configured JSON; `mcp get <known>` → 0; `mcp get <unknown>` → non-zero; `mcp list` → text with status markers). Provide `readInvocations(logPath)`.
- [ ] **Step 2: Write the e2e tests** (each under `withTempEnv` + a fresh fake claude):
  - **Full lifecycle:** `setup` → `doctor` (all ✓, exit 0) → `update` with an unchanged payload (idempotent: no skill writes) → `uninstall` (state file gone; skills removed; `plugin uninstall`/`mcp remove` invoked).
  - **Targeting:** `setup slack` on a clean system installs only `slack`'s source and no skills; removes nothing.
  - **Non-destructive:** pre-create a foreign skill dir + a foreign mcp (in the shim's view) of the same name → `setup` skips them with warnings and does NOT overwrite; with `--force`, a state-tracked but user-edited skill is overwritten.
  - **Partial failure → exit code:** make the shim fail one `mcp add` → run completes, summarizes the failure, and the process exit code is non-zero (per spec §10).
  - **dry-run:** `setup --dry-run` writes no skill files, mutates no state, records zero `claude` mutations in the shim log.
- [ ] **Step 3: Run the full suite, expect PASS.** Run: `bun test`
- [ ] **Step 4: Commit.** `git commit -m "test: end-to-end lifecycle, targeting, safety, exit codes"`

### Task 19: Build — binary + npm bundle

**Files:** Modify `cli/package.json`; create `cli/scripts/build.ts`

- [ ] **Step 1: Wire `embed` into builds.** Both build scripts run `bun run scripts/embed-payload.ts` first so `payload.generated.ts` is current.
- [ ] **Step 2: Binary build.** `build:binary` runs `bun build ./src/index.ts --compile --outfile dist/ner-jarvis` per target (`--target=bun-darwin-arm64|bun-darwin-x64|bun-linux-x64|bun-linux-arm64|bun-windows-x64`).
- [ ] **Step 3: npm bundle.** `build:npm` runs `bun build ./src/index.ts --target=node --outfile dist/index.js` (Node-compatible, since we used only `node:` builtins). Set `package.json` `"bin"`, `"files": ["dist/index.js"]`, `"engines"`.
- [ ] **Step 4: Smoke test both.** Run the compiled binary and `node dist/index.js`, each with `--version` and `doctor` against a temp HOME + fake claude; expect matching behavior.
- [ ] **Step 5: Commit.** `git commit -m "build: bun --compile binary + node npm bundle"`

### Task 20: CI + release automation

**Files:** Create `.github/workflows/ci.yml`, `.github/workflows/release.yml` (at the repo root; all build/test steps set `working-directory: cli`)

- [ ] **Step 1: `ci.yml`** — matrix `{macos, ubuntu, windows}`: `oven-sh/setup-bun`, `bun install`, `bun test`, `bun run build:binary` (host target), run the binary's `--version` smoke test. Triggers on PR + push.
- [ ] **Step 2: `release.yml`** — on tag `v*`: build all binary targets, attach them to the GitHub Release; build the npm bundle and `npm publish` (token from secrets). One tag = one config version (spec §5).
- [ ] **Step 3: Verify** CI is green on a draft PR before relying on `release.yml`.
- [ ] **Step 4: Commit.** `git commit -m "ci: cross-platform build/test + release publishing"`

### Task 21: Contract doc + README

**Files:** Create `behavior.md`, `README.md` (repo root)

- [ ] **Step 1: Write `behavior.md`** — the language-agnostic contract: command surface, the 7 wizard steps, state shape, the exact `claude` invocations (as verified in Task 7 Step 1), reconciliation rules, exit codes. This is what a future re-implementation in another language targets.
- [ ] **Step 2: Write `README.md`** — install (binary `curl` line + `npx ner-jarvis@latest`), the four commands with targeting/`--dry-run`/`--force` examples, the "you authenticate each source yourself" note, and a troubleshooting pointer to `doctor`.
- [ ] **Step 3: Commit.** `git commit -m "docs: behavior contract + README"`

---

## Chunk 6: v2 — interactive setup + workspace clone

Implements spec §14. Adds a prompt layer, a workspace clone/open, and a decision log;
`converge` (Chunk 4) is **reused unchanged** — `setup` prompts, then calls it with the
approved targets. New seams keep it hermetic: a scripted prompter, a local temp git
repo, and the existing `NER_JARVIS_CLAUDE_BIN` shim.

### Task 22: Payload `workspace` + `--yes` flag

**Files:** Modify `sources.json`, `cli/src/types.ts`, `cli/scripts/embed-payload.ts`, `cli/src/core/payload.ts`, `cli/src/cli.ts`, `cli/src/index.ts`; tests in `payload.test.ts`, `cli.test.ts`.

- [ ] Add `workspace: { repo, dirName }` to `sources.json` (repo `https://github.com/bracyw/ner-jarvis.git`, dirName `ner-jarvis`) and to `EmbeddedPayload` (optional). Include it in the embed script; pass through the loader (if present, `repo` + `dirName` are non-empty strings).
- [ ] Add `yes: boolean` to `ParsedArgs`; parse `--yes`/`-y`. Failing test → implement → pass.
- [ ] Commit.

### Task 23: Prompt module

**Files:** Create `cli/src/core/prompt.ts`, `cli/src/core/prompt.test.ts`.

- [ ] Failing tests (scripted line source): `confirm` → true on `""`(Enter)/`y`/`yes`, false on `n`/`no`, re-asks on junk then honors the next line; `askPath` → default on `""`, else the typed (trimmed) path.
- [ ] Implement `makeStreamPrompter(readLine, out)` with that parse logic; `autoPrompter()` (never reads — returns defaults); `ttyPrompter()` (reads a line from fd 0 via `node:fs` `readSync`, EAGAIN-tolerant); `scriptedPrompter(lines)` for tests. `node:` builtins only.
- [ ] Pass. Commit.

### Task 24: Decision log

**Files:** Modify `cli/src/core/paths.ts`; create `cli/src/core/log.ts`, `cli/src/core/log.test.ts`.

- [ ] Add `logFile()` → `~/.claude/.ner-jarvis.log`.
- [ ] Failing test (under `withTempEnv`): `logDecision({…})` appends one timestamped JSON line per call; calls accumulate; creates `~/.claude` if missing; never throws.
- [ ] Implement (append-only, `node:fs`, stamps `ts`). Pass. Commit.

### Task 25: Workspace clone/open

**Files:** Create `cli/src/core/workspace.ts`, `cli/src/core/workspace.test.ts`.

- [ ] Failing tests: `resolveWorkspaceDest(base, dirName)` → `join(base, dirName)`; `cloneWorkspace(repo, dest)` clones a **local temp bare repo** (offline) → ok; refuses (skipped, runs no git) when `dest` exists.
- [ ] Implement: `resolveWorkspaceDest` (pure); `cloneWorkspace` via `execFileSync("git", ["clone", repo, dest], {env})` + existing-dir guard; `openClaude(dir)` spawns `claude` (via the `NER_JARVIS_CLAUDE_BIN` seam) with `cwd: dir`, stdio inherited. Pass. Commit.

### Task 26: Interactive `setup`

**Files:** Modify `cli/src/commands/setup.ts`; tests in `setup.test.ts` (+ update `e2e.test.ts`).

- [ ] Failing tests (scripted prompter + stub `cloneWorkspace`/`openClaude` + fake claude):
  - **interactive:** declining "skills" installs none but still connects confirmed sources; declining a source skips only it; clone uses the entered path (Enter = cwd) and open is invoked with the clone dir.
  - **--yes:** all steps auto-run, clone→cwd, open invoked; prompter never read.
  - **minimal (no TTY, no yes):** legacy full converge; `cloneWorkspace`/`openClaude` **never called**.
  - every run appends decision-log lines.
- [ ] Implement the three paths; inject deps `{ prompter, cloneWorkspace, openClaude, logDecision, cwd, isTTY }` (real defaults wired in `index.ts`). Reuse `converge` with the approved `targets`. Pass.
- [ ] Update existing `e2e.test.ts` calls (non-TTY, no-yes → minimal path); assert no clone/open occurs. Commit.

### Task 27: Wire `index.ts` + rebuild

**Files:** Modify `cli/src/index.ts`; then rebuild.

- [ ] Construct the prompter (`process.stdin.isTTY && !yes ? ttyPrompter() : autoPrompter()`) and real deps (`cloneWorkspace`, `openClaude`, `logDecision`, `cwd: process.cwd()`, `isTTY`); pass `yes` through. Add `--yes` + the workspace steps to `HELP`.
- [ ] `bun test` green; `bun run scripts/build.ts binary`; smoke-test `--help` (shows `--yes`), `doctor`, and a piped interactive `setup` (`printf 'n\nn\nn\nn\nn\n' | ner-jarvis setup`). Commit.

## Definition of done

- `bun test` green across the matrix; a from-clean `setup` installs 5 skills + connects 3 sources; `doctor` reports healthy; `update` is idempotent; `uninstall` removes only what was installed; targeting and `--dry-run`/`--force` behave per spec §9; partial failures exit non-zero; no secret is ever logged or written.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-28-ner-jarvis.md`. Ready to execute?**

This harness has subagents, so execution uses @superpowers:subagent-driven-development (fresh subagent per task + two-stage review), working in the standalone `ner-jarvis` repo (`~/Desktop/ner/app_software/ner-jarvis`, local-only) — not in-session batch execution.

**Before execution, one maintainer action (need your go-ahead):**
1. Confirm the Task 2 source facts (Slack marketplace/plugin id; Atlassian + GitHub MCP URLs/transports) so `sources.json` ships real values — the read-only live-`claude` verification we can run first.

ner-jarvis is a standalone local repo; adding a `Northeastern-Electric-Racing/ner-jarvis` (or other) GitHub remote later is a `git remote add` + push, not a blocker.



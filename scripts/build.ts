/**
 * Build orchestrator. Run as `bun run scripts/build.ts <npm|binary> [target]`.
 *
 * Always embeds the payload first (writes src/payload.generated.ts), then:
 *   - npm:    a Node-targeted single-file bundle at dist/index.js (executable,
 *             `#!/usr/bin/env node` shebang guaranteed).
 *   - binary: a standalone Bun executable via `--compile`. With no `target`
 *             arg it builds for the HOST platform (no download); with a target
 *             (e.g. `bun-linux-x64`) it cross-compiles to
 *             dist/ner-jarvis-<target> (used by CI's matrix in Task 20).
 *
 * `node:` builtins + Bun's own `bun build` only — no extra deps.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// scripts/build.ts -> scripts -> repo root (the CLI is the repo)
const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const cliDir = join(scriptDir, "..");

const NODE_SHEBANG = "#!/usr/bin/env node\n";

/** Run a command from the repo root, inheriting stdio; throws (non-zero exit) on failure. */
function run(cmd: string, args: string[]): void {
  execFileSync(cmd, args, { cwd: cliDir, stdio: "inherit" });
}

function embed(): void {
  run("bun", ["run", "scripts/embed-payload.ts"]);
}

function buildNpm(): void {
  const outfile = join(cliDir, "dist", "index.js");
  run("bun", [
    "build",
    "./src/index.ts",
    "--target=node",
    // Two-arg form: bun wants `--define NAME=value`, not esbuild's `--define:NAME=value`.
    // The literal quotes make the value a JS string (not an identifier reference).
    "--define",
    `NERJ_CHANNEL="npm"`,
    "--outfile",
    outfile,
  ]);
  // Bun may strip a leading shebang from the bundle; the npm `bin` needs one.
  const contents = readFileSync(outfile, "utf8");
  if (!contents.startsWith("#!")) {
    writeFileSync(outfile, NODE_SHEBANG + contents);
  }
  chmodSync(outfile, 0o755);
}

/**
 * The file `bun build --compile` actually writes for a target.
 *
 * Bun appends `.exe` for Windows targets whether or not the `--outfile` says so, so
 * naming it ourselves keeps the built path predictable for CI's upload step. Getting
 * this wrong is silent: the release action only *warns* on a pattern that matches no
 * files, so v0.1.0 shipped without a Windows binary while the job reported success.
 */
export function binaryOutName(target?: string): string {
  if (!target) return "ner-jarvis";
  return `ner-jarvis-${target}${target.includes("windows") ? ".exe" : ""}`;
}

function buildBinary(target?: string): void {
  const outfile = join(cliDir, "dist", binaryOutName(target));
  const args = [
    "build",
    "./src/index.ts",
    "--compile",
    // See buildNpm: two-arg `--define NAME=value` with literal quotes for a string value.
    "--define",
    `NERJ_CHANNEL="binary"`,
  ];
  // No target -> host platform (no download). A target -> cross-compile.
  if (target) args.push(`--target=${target}`);
  args.push("--outfile", outfile);
  run("bun", args);
}

function main(): void {
  const [channel, target] = process.argv.slice(2);
  if (channel !== "npm" && channel !== "binary") {
    console.error("usage: bun run scripts/build.ts <npm|binary> [target]");
    process.exit(2);
  }
  embed();
  if (channel === "npm") buildNpm();
  else buildBinary(target);
}

if (import.meta.main) main();

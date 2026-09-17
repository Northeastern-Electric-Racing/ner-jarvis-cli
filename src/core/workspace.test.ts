import { test, expect, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkspaceDest, cloneWorkspace, openClaude, workspaceStatus, pullWorkspace } from "./workspace";
import { writeShim } from "../../test/helpers";

const temps: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
}
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

test("resolveWorkspaceDest joins base + dirName", () => {
  expect(resolveWorkspaceDest("/a/b", "ner-jarvis")).toBe(join("/a/b", "ner-jarvis"));
});

test("cloneWorkspace clones a local repo into <dest> (offline)", () => {
  const src = tmp("nerj-src-");
  execFileSync("git", ["init", "-q", src], { env: process.env });
  writeFileSync(join(src, "README.md"), "hi");
  execFileSync("git", ["-C", src, "add", "-A"], { env: process.env });
  execFileSync(
    "git",
    ["-C", src, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"],
    { env: process.env },
  );

  const dest = resolveWorkspaceDest(tmp("nerj-dest-"), "clone");
  const r = cloneWorkspace(src, dest);
  expect(r.ok).toBe(true);
  expect(existsSync(join(dest, "README.md"))).toBe(true);
});

test("cloneWorkspace refuses when dest already exists (runs no git)", () => {
  const dest = resolveWorkspaceDest(tmp("nerj-dest2-"), "clone");
  mkdirSync(dest, { recursive: true }); // pre-existing; no subprocess needed
  const r = cloneWorkspace("/definitely/not/a/repo.git", dest);
  expect(r.ok).toBe(false);
  expect(r.skipped).toBeDefined();
});

// --- workspaceStatus / pullWorkspace (real local git, offline) ---------------

/** Run a git command in `cwd` with a canned identity, output silenced. */
function gitC(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    env: process.env,
    stdio: "ignore",
  });
}
/** A source repo with one commit, plus a clone of it. Returns both paths. */
function srcAndClone(): { src: string; clone: string } {
  const src = tmp("nerj-wsrc-");
  execFileSync("git", ["init", "-q", src], { env: process.env });
  writeFileSync(join(src, "README.md"), "v1");
  gitC(src, "add", "-A");
  gitC(src, "commit", "-q", "-m", "init");
  const clone = resolveWorkspaceDest(tmp("nerj-wdest-"), "clone");
  execFileSync("git", ["clone", "-q", src, clone], { env: process.env });
  return { src, clone };
}
/** Add a second commit on the source's checked-out branch. */
function advance(src: string): void {
  writeFileSync(join(src, "README.md"), "v2");
  gitC(src, "add", "-A");
  gitC(src, "commit", "-q", "-m", "second");
}

test("workspaceStatus: a path that doesn't exist → absent", () => {
  expect(workspaceStatus(join(tmp("nerj-abs-"), "nope")).state).toBe("absent");
});

test("workspaceStatus: an existing non-git directory → not-git", () => {
  expect(workspaceStatus(tmp("nerj-plain-")).state).toBe("not-git");
});

test("workspaceStatus: a fresh clone with nothing new upstream → up-to-date", () => {
  const { clone } = srcAndClone();
  expect(workspaceStatus(clone).state).toBe("up-to-date");
});

test("workspaceStatus: origin advanced, working tree clean → behind-clean with a count", () => {
  const { src, clone } = srcAndClone();
  advance(src);
  const st = workspaceStatus(clone);
  expect(st.state).toBe("behind-clean");
  expect(st.behind).toBe(1);
});

test("workspaceStatus: behind origin but with local uncommitted edits → behind-dirty (never pull)", () => {
  const { src, clone } = srcAndClone();
  advance(src);
  writeFileSync(join(clone, "README.md"), "local edit"); // dirty the tracked file
  const st = workspaceStatus(clone);
  expect(st.state).toBe("behind-dirty");
  expect(st.dirty).toBe(true);
});

test("workspaceStatus: a git repo with no upstream branch → no-upstream", () => {
  const solo = tmp("nerj-solo-");
  execFileSync("git", ["init", "-q", solo], { env: process.env });
  writeFileSync(join(solo, "f.txt"), "x");
  gitC(solo, "add", "-A");
  gitC(solo, "commit", "-q", "-m", "init");
  expect(workspaceStatus(solo).state).toBe("no-upstream");
});

test("pullWorkspace: fast-forwards a behind-clean clone and updates files", () => {
  const { src, clone } = srcAndClone();
  advance(src);
  const r = pullWorkspace(clone);
  expect(r.ok).toBe(true);
  expect(readFileSync(join(clone, "README.md"), "utf8")).toBe("v2");
  expect(workspaceStatus(clone).state).toBe("up-to-date"); // no longer behind
});

test("openClaude launches the claude bin with cwd = the given dir", () => {
  const shimDir = tmp("nerj-shim-");
  const shim = join(shimDir, "shim.ts");
  const cwdOut = join(shimDir, "cwd.txt");
  writeShim(
    shim,
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(cwdOut)}, process.cwd());\nprocess.exit(0);\n`,
  );
  const saved = process.env.NER_JARVIS_CLAUDE_BIN;
  process.env.NER_JARVIS_CLAUDE_BIN = `bun "${shim}"`;
  try {
    const target = tmp("nerj-open-");
    const r = openClaude(target);
    expect(r.code).toBe(0);
    expect(realpathSync(readFileSync(cwdOut, "utf8").trim())).toBe(realpathSync(target));
  } finally {
    if (saved === undefined) delete process.env.NER_JARVIS_CLAUDE_BIN;
    else process.env.NER_JARVIS_CLAUDE_BIN = saved;
  }
});

import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ghStatus } from "./gh";

const saved = process.env.NER_JARVIS_GH_BIN;
const dirs: string[] = [];

/** A fake `gh`: `--version` (and everything) exits 0; `auth status` exits per `authed`. */
function fakeGh(authed: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "nerj-gh-"));
  dirs.push(dir);
  const p = join(dir, "gh.ts");
  writeFileSync(p, `const a=process.argv.slice(2); if(a[0]==="auth"&&a[1]==="status")process.exit(${authed ? 0 : 1}); process.exit(0);`);
  return `bun ${p}`;
}

afterEach(() => {
  if (saved === undefined) delete process.env.NER_JARVIS_GH_BIN;
  else process.env.NER_JARVIS_GH_BIN = saved;
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

test("ghStatus: installed + authenticated", () => {
  process.env.NER_JARVIS_GH_BIN = fakeGh(true);
  expect(ghStatus()).toEqual({ installed: true, authed: true });
});

test("ghStatus: installed but not authenticated", () => {
  process.env.NER_JARVIS_GH_BIN = fakeGh(false);
  const s = ghStatus();
  expect(s.installed).toBe(true);
  expect(s.authed).toBe(false);
});

test("ghStatus: not installed (bogus bin) → installed:false, authed:false", () => {
  process.env.NER_JARVIS_GH_BIN = "/nonexistent/gh-xyz";
  expect(ghStatus()).toEqual({ installed: false, authed: false });
});

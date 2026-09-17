import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTempEnv, writeShim } from "../../test/helpers";
import { preflight } from "./preflight";

// Capture the ambient value at module load so we can restore it after each
// test — other test files rely on a clean env.
const savedClaudeBin = process.env.NER_JARVIS_CLAUDE_BIN;

afterEach(() => {
  if (savedClaudeBin === undefined) delete process.env.NER_JARVIS_CLAUDE_BIN;
  else process.env.NER_JARVIS_CLAUDE_BIN = savedClaudeBin;
});

describe("preflight", () => {
  it("fails when claude is unavailable", () => {
    withTempEnv(() => {
      process.env.NER_JARVIS_CLAUDE_BIN = "/nonexistent/definitely-not-claude";
      const result = preflight();
      expect(result.ok).toBe(false);
      expect(result.problems.some((p) => /claude/i.test(p))).toBe(true);
    });
  });

  it("passes when claude and git are available and ~/.claude is writable", () => {
    const shimDir = mkdtempSync(join(tmpdir(), "nerj-shim-"));
    const shimPath = join(shimDir, "claude-shim.ts");
    // Any `claude …` invocation (including `--version`) exits 0.
    writeShim(shimPath, "process.exit(0);\n");
    try {
      withTempEnv(() => {
        process.env.NER_JARVIS_CLAUDE_BIN = `bun "${shimPath}"`;
        const result = preflight();
        expect(result.ok).toBe(true);
        expect(result.problems).toEqual([]);
      });
    } finally {
      rmSync(shimDir, { recursive: true, force: true });
    }
  });
});

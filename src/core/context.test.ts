import { test, expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { withTempEnv } from "../../test/helpers";
import { claudeHome, globalContextFile } from "./paths";
import {
  CONTEXT_BEGIN,
  CONTEXT_END,
  CONTEXT_LINE,
  hasContextBlock,
  withContextBlock,
  withSyncedBlock,
  withoutContextBlock,
  addGlobalContext,
  removeGlobalContext,
  hasGlobalContext,
  globalContextStatus,
} from "./context";

// --- pure block helpers ---

test("withContextBlock: appends the marked block to empty text", () => {
  const out = withContextBlock("");
  expect(hasContextBlock(out)).toBe(true);
  expect(out).toContain(CONTEXT_LINE);
});

test("withContextBlock: is idempotent — never adds the block twice", () => {
  const once = withContextBlock("hello\n");
  const twice = withContextBlock(once);
  expect(twice).toBe(once);
  expect((twice.match(/ner-jarvis:begin/g) || []).length).toBe(1);
});

test("withContextBlock: append-only — preserves existing content", () => {
  const out = withContextBlock("# My notes\nkeep me\n");
  expect(out.startsWith("# My notes\nkeep me")).toBe(true);
  expect(hasContextBlock(out)).toBe(true);
});

test("withoutContextBlock: removes our block but keeps other content", () => {
  const out = withoutContextBlock(withContextBlock("# My notes\n"));
  expect(hasContextBlock(out)).toBe(false);
  expect(out).toContain("My notes");
});

test("withoutContextBlock: no-op when the block is absent", () => {
  expect(withoutContextBlock("nothing here\n")).toBe("nothing here\n");
});

test("round-trip: add then remove returns the original content", () => {
  const orig = "# Global\nline one\n";
  expect(withoutContextBlock(withContextBlock(orig))).toBe(orig);
});

// --- effectful helpers (temp HOME) ---

test("addGlobalContext: creates the file when absent; removeGlobalContext deletes an only-ours file", () => {
  withTempEnv(() => {
    const r = addGlobalContext();
    expect(r.changed).toBe(true);
    expect(r.created).toBe(true);
    expect(hasGlobalContext()).toBe(true);

    const rm = removeGlobalContext();
    expect(rm.changed).toBe(true);
    expect(existsSync(globalContextFile())).toBe(false); // existed only for our block → gone
  });
});

test("addGlobalContext: a second call is a no-op (idempotent on disk)", () => {
  withTempEnv(() => {
    addGlobalContext();
    const again = addGlobalContext();
    expect(again.changed).toBe(false);
    expect(again.skipped).toBeDefined();
    const txt = readFileSync(globalContextFile(), "utf8");
    expect((txt.match(/ner-jarvis:begin/g) || []).length).toBe(1);
  });
});

test("addGlobalContext: preserves a user's existing CLAUDE.md; removal keeps their content", () => {
  withTempEnv(() => {
    mkdirSync(claudeHome(), { recursive: true });
    writeFileSync(globalContextFile(), "# mine\nkeep\n");
    addGlobalContext();
    expect(readFileSync(globalContextFile(), "utf8")).toContain("# mine");

    removeGlobalContext();
    const txt = readFileSync(globalContextFile(), "utf8");
    expect(txt).toContain("# mine");
    expect(hasContextBlock(txt)).toBe(false);
  });
});

test("removeGlobalContext: no-op when there is no global CLAUDE.md", () => {
  withTempEnv(() => {
    const r = removeGlobalContext();
    expect(r.changed).toBe(false);
  });
});

// --- diff-check / in-place refresh (keep our markers, sync the content) ---

test("withSyncedBlock: appends when our markers are absent (append-only parity)", () => {
  const out = withSyncedBlock("# mine\nkeep\n");
  expect(out.startsWith("# mine\nkeep")).toBe(true);
  expect(out).toContain(CONTEXT_LINE);
  expect((out.match(/ner-jarvis:begin/g) || []).length).toBe(1);
});

test("withSyncedBlock: no-op when the current block is already present", () => {
  const once = withSyncedBlock("hello\n");
  expect(withSyncedBlock(once)).toBe(once);
});

test("withSyncedBlock: refreshes a STALE block in place, keeping position + surrounding text", () => {
  const stale = `# top\n\n${CONTEXT_BEGIN}\nOLD outdated NER note.\n${CONTEXT_END}\n\n# after\nkeep me\n`;
  const out = withSyncedBlock(stale);
  expect(out).toContain(CONTEXT_LINE); // refreshed to current text
  expect(out).not.toContain("OLD outdated"); // stale text gone
  expect((out.match(/ner-jarvis:begin/g) || []).length).toBe(1); // still exactly one region
  expect(out.indexOf("# top")).toBeLessThan(out.indexOf(CONTEXT_BEGIN)); // block stayed in place
  expect(out.indexOf(CONTEXT_END)).toBeLessThan(out.indexOf("# after")); // content after preserved
  expect(out).toContain("keep me");
});

test("addGlobalContext: diff-check refreshes a stale on-disk block, preserving the user's content", () => {
  withTempEnv(() => {
    mkdirSync(claudeHome(), { recursive: true });
    const stale = `# mine\nkeep\n\n${CONTEXT_BEGIN}\nOLD note text.\n${CONTEXT_END}\n`;
    writeFileSync(globalContextFile(), stale);

    const r = addGlobalContext();
    expect(r.changed).toBe(true);
    expect(r.updated).toBe(true);
    expect(r.created).toBeFalsy();

    const txt = readFileSync(globalContextFile(), "utf8");
    expect(txt).toContain(CONTEXT_LINE); // current content
    expect(txt).not.toContain("OLD note text"); // stale gone
    expect(txt).toContain("# mine"); // user content preserved
    expect((txt.match(/ner-jarvis:begin/g) || []).length).toBe(1);

    // now content matches → a second call is a no-op (idempotent on current content)
    const again = addGlobalContext();
    expect(again.changed).toBe(false);
    expect(again.skipped).toBeDefined();
  });
});

// --- read-only status (what the wizard checks before prompting) ---

test("globalContextStatus: absent with no file, and absent when a file lacks our markers", () => {
  withTempEnv(() => {
    expect(globalContextStatus()).toBe("absent"); // no file at all
    mkdirSync(claudeHome(), { recursive: true });
    writeFileSync(globalContextFile(), "# just mine\n");
    expect(globalContextStatus()).toBe("absent"); // file exists, but not our note
  });
});

test("globalContextStatus: current after add, stale when the note text drifts", () => {
  withTempEnv(() => {
    addGlobalContext();
    expect(globalContextStatus()).toBe("current");

    // same markers, older body → stale (would refresh in place)
    writeFileSync(globalContextFile(), `${CONTEXT_BEGIN}\nOLD note.\n${CONTEXT_END}\n`);
    expect(globalContextStatus()).toBe("stale");
  });
});

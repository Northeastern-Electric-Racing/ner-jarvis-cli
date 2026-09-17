import { test, expect } from "bun:test";
import { join } from "node:path";
import { withTempEnv } from "../../test/helpers";
import { skillsDir, stateFile, logFile, nerJarvisHome, undoDir, undoIndexFile, versionsDir } from "./paths";

test("skillsDir() is <home>/.claude/skills inside a temp env", () => {
  withTempEnv((home) => {
    const dir = skillsDir();
    expect(dir.endsWith(join(".claude", "skills"))).toBe(true);
    expect(dir.startsWith(home)).toBe(true);
  });
});

test("nerJarvisHome() / stateFile() / logFile() live under <home>/.claude/ner-jarvis", () => {
  withTempEnv((home) => {
    expect(nerJarvisHome().endsWith(join(".claude", "ner-jarvis"))).toBe(true);
    expect(stateFile().endsWith(join(".claude", "ner-jarvis", "state.json"))).toBe(true);
    expect(logFile().endsWith(join(".claude", "ner-jarvis", "log.jsonl"))).toBe(true);
    expect(stateFile().startsWith(home)).toBe(true);
  });
});

test("undoDir() / undoIndexFile() / versionsDir() live under <home>/.claude/ner-jarvis", () => {
  withTempEnv((home) => {
    expect(undoDir().endsWith(join(".claude", "ner-jarvis", "undo"))).toBe(true);
    expect(undoIndexFile().endsWith(join(".claude", "ner-jarvis", "undo", "index.json"))).toBe(true);
    expect(versionsDir().endsWith(join(".claude", "ner-jarvis", "versions"))).toBe(true);
    expect(undoDir().startsWith(home)).toBe(true);
  });
});

import { test, expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { withTempEnv } from "../../test/helpers";
import { versionsDir } from "./paths";
import { writeUndoRecord, CURRENT_UNDO_SCHEMA_VERSION } from "./undo";
import { archiveCurrentBinary, gcVersion } from "./archive";

/** Write a throwaway "binary" file the archiver can copy, returns its path. */
function fakeExe(home: string, name = "ner-jarvis", body = "#!binary\n"): string {
  const dir = join(home, "bin");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
}

test("archiveCurrentBinary (binary channel) copies the exe into versions/<version>/ and returns its path", () => {
  withTempEnv((home) => {
    const exe = fakeExe(home, "ner-jarvis", "the-binary-bytes");
    const dest = archiveCurrentBinary("0.2.0", { channel: "binary", execPath: exe });
    expect(dest).toBe(join(versionsDir(), "0.2.0", basename(exe)));
    expect(existsSync(dest!)).toBe(true);
    expect(readFileSync(dest!, "utf8")).toBe("the-binary-bytes");
  });
});

test("archiveCurrentBinary (binary channel) is a no-op when the version is already archived (dedupe)", () => {
  withTempEnv((home) => {
    const exe = fakeExe(home, "ner-jarvis", "v1-bytes");
    const dest = archiveCurrentBinary("0.2.0", { channel: "binary", execPath: exe });
    // A later run on the same version with different on-disk bytes must NOT overwrite.
    writeFileSync(exe, "v2-bytes-different");
    const again = archiveCurrentBinary("0.2.0", { channel: "binary", execPath: exe });
    expect(again).toBe(dest);
    expect(readFileSync(dest!, "utf8")).toBe("v1-bytes"); // dedupe: original kept
  });
});

test("archiveCurrentBinary (npm channel) stores nothing and returns null", () => {
  withTempEnv((home) => {
    const exe = fakeExe(home);
    const dest = archiveCurrentBinary("0.2.0", { channel: "npm", execPath: exe });
    expect(dest).toBeNull();
    expect(existsSync(join(versionsDir(), "0.2.0"))).toBe(false);
  });
});

test("gcVersion removes versions/<version>/ only when the index has no entry for it", () => {
  withTempEnv((home) => {
    const exe = fakeExe(home, "ner-jarvis", "bytes");
    archiveCurrentBinary("0.2.0", { channel: "binary", execPath: exe });
    expect(existsSync(join(versionsDir(), "0.2.0"))).toBe(true);

    // An index entry for 0.2.0 exists → gc must keep the archived binary.
    writeUndoRecord({
      undoSchemaVersion: CURRENT_UNDO_SCHEMA_VERSION, runId: "R1", version: "0.2.0",
      command: "setup", createdAt: "t", installed: [{ kind: "global-note" }],
    });
    gcVersion("0.2.0");
    expect(existsSync(join(versionsDir(), "0.2.0"))).toBe(true);

    // A version with NO index entries → gc removes it.
    archiveCurrentBinary("0.9.9", { channel: "binary", execPath: exe });
    expect(existsSync(join(versionsDir(), "0.9.9"))).toBe(true);
    gcVersion("0.9.9");
    expect(existsSync(join(versionsDir(), "0.9.9"))).toBe(false);
  });
});

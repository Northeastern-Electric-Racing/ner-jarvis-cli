import { test, expect } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withTempEnv } from "../../test/helpers";
import { skillsDir } from "../core/paths";
import { roster } from "./roster";

const DOC = JSON.stringify({
  asOf: "Test 2026",
  areas: [
    {
      area: "Software",
      chief: "Chris Pyle",
      subteams: [
        { name: "FinishLine", head: "Waverly Hassman", leads: [] },
        { name: "Application Software", head: "Wyatt Bracy", leads: [{ role: "Argos Lead", name: "Jeff Kuo" }] },
      ],
    },
  ],
});

/** Write roster.json into the temp HOME's installed-skills location. */
function installRoster(): void {
  const dir = join(skillsDir(), "ner-roster");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "roster.json"), DOC);
}

test("roster term query reads the installed roster.json and finds a lead", () => {
  withTempEnv(() => {
    installRoster();
    const r = roster({ targets: ["argos"], json: false });
    expect(r.ok).toBe(true);
    const text = r.lines.join("\n");
    expect(text).toContain("Jeff Kuo");
    expect(text).toContain("Application Software");
    expect(text).not.toContain("Waverly"); // filtered out
  });
});

test("roster --json emits parseable JSON of the matched rows", () => {
  withTempEnv(() => {
    installRoster();
    const r = roster({ targets: ["finishline"], json: true });
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.lines.join("\n"))).toEqual([
      { area: "Software", subteam: "FinishLine", role: "Head", name: "Waverly Hassman", isHead: true },
    ]);
  });
});

test("roster with no terms lists everyone", () => {
  withTempEnv(() => {
    installRoster();
    const r = roster({ targets: [], json: true });
    expect(JSON.parse(r.lines.join("\n")).length).toBe(3); // 2 heads + 1 lead
  });
});

test("roster verbs: heads / head / leads / system / who / systems", () => {
  withTempEnv(() => {
    installRoster();
    const names = (t: string[]) => JSON.parse(roster({ targets: t, json: true }).lines.join("\n")).map((r: { name: string }) => r.name);

    expect(names(["heads"]).sort()).toEqual(["Waverly Hassman", "Wyatt Bracy"]);
    expect(names(["head", "finishline"])).toEqual(["Waverly Hassman"]);
    expect(names(["leads", "application", "software"])).toEqual(["Jeff Kuo"]); // multi-word arg, head excluded
    expect(names(["system", "argos"])).toEqual(["Jeff Kuo"]);
    expect(names(["who", "bracy"])).toEqual(["Wyatt Bracy"]);

    // `systems` returns a string list, not rows
    expect(JSON.parse(roster({ targets: ["systems"], json: true }).lines.join("\n"))).toEqual(["Argos"]);
  });
});

test("a singular verb with no argument falls back to free-text search", () => {
  withTempEnv(() => {
    installRoster();
    // "head" alone isn't a lookup — it's a term; matches the two rows whose role is "Head"
    const r = roster({ targets: ["head"], json: true });
    expect(JSON.parse(r.lines.join("\n")).map((x: { name: string }) => x.name).sort()).toEqual([
      "Waverly Hassman",
      "Wyatt Bracy",
    ]);
  });
});

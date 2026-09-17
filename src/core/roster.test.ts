import { test, expect } from "bun:test";
import {
  flattenRoster,
  queryRoster,
  heads,
  headOf,
  leadsOf,
  inArea,
  inSubteam,
  byRole,
  byPerson,
  systems,
  systemOwners,
  systemName,
  chiefOf,
  type RosterDoc,
} from "./roster";

const DOC: RosterDoc = {
  asOf: "Test 2026",
  executiveBoard: [
    { role: "President", name: "Riyana Roy" },
    { role: "Chief Software", name: "Chris Pyle" },
  ],
  areas: [
    {
      area: "Software",
      chief: "Chris Pyle",
      subteams: [
        { name: "FinishLine", head: "Waverly Hassman", leads: [{ role: "Tech Lead", name: "Grace Theobald" }] },
        {
          name: "Application Software",
          head: "Wyatt Bracy",
          leads: [
            { role: "Argos Lead", name: "Jeff Kuo" },
            { role: "NERO Lead", name: "Dev Chechi" },
          ],
        },
      ],
    },
    { area: "Business", chief: null, leads: [{ role: "Social Media Lead", name: "Katy Silva" }] },
  ],
};

test("flattenRoster emits exec-board, heads, leads, and area-level leads", () => {
  const rows = flattenRoster(DOC);
  // 2 eboard + (FinishLine: head+1) + (App: head+2) + 1 business area-lead = 8
  expect(rows.length).toBe(8);
  expect(rows.filter((r) => r.area === "Executive Board").length).toBe(2);
  const head = rows.find((r) => r.subteam === "FinishLine" && r.isHead);
  expect(head?.role).toBe("Head");
  expect(head?.name).toBe("Waverly Hassman");
  // area-level lead has empty subteam
  expect(rows.find((r) => r.name === "Katy Silva")?.subteam).toBe("");
});

test("flattenRoster keeps FinishLine and Application Software as distinct subteams", () => {
  const rows = flattenRoster(DOC);
  const fl = rows.find((r) => r.name === "Waverly Hassman");
  const app = rows.find((r) => r.name === "Wyatt Bracy");
  expect(fl?.subteam).toBe("FinishLine");
  expect(app?.subteam).toBe("Application Software");
  expect(fl?.subteam).not.toBe(app?.subteam);
});

test("queryRoster filters case-insensitively and ANDs multiple terms", () => {
  const rows = flattenRoster(DOC);
  expect(queryRoster(rows, ["ARGOS"]).map((r) => r.name)).toEqual(["Jeff Kuo"]);
  expect(queryRoster(rows, ["finishline"]).map((r) => r.name).sort()).toEqual(["Grace Theobald", "Waverly Hassman"]);
  // AND: "application" (subteam) + "nero" (role) → only Dev Chechi
  expect(queryRoster(rows, ["application", "nero"]).map((r) => r.name)).toEqual(["Dev Chechi"]);
  expect(queryRoster(rows, []).length).toBe(rows.length);
  expect(queryRoster(rows, ["nonexistent"]).length).toBe(0);
});

test("heads / headOf return subteam heads (not leads)", () => {
  const rows = flattenRoster(DOC);
  expect(heads(rows).map((r) => r.name).sort()).toEqual(["Waverly Hassman", "Wyatt Bracy"]);
  expect(headOf(rows, "finishline")?.name).toBe("Waverly Hassman"); // case-insensitive
  expect(headOf(rows, "Application Software")?.name).toBe("Wyatt Bracy");
  expect(headOf(rows, "no-such-team")).toBeUndefined();
});

test("leadsOf excludes the head; inSubteam / inArea include everyone", () => {
  const rows = flattenRoster(DOC);
  expect(leadsOf(rows, "Application Software").map((r) => r.name).sort()).toEqual(["Dev Chechi", "Jeff Kuo"]);
  expect(leadsOf(rows, "Application Software").some((r) => r.isHead)).toBe(false);
  expect(inSubteam(rows, "FinishLine").map((r) => r.name).sort()).toEqual(["Grace Theobald", "Waverly Hassman"]);
  expect(inArea(rows, "Software").length).toBe(5); // 2 heads + 3 leads, no eboard/business
});

test("byRole is exact; byPerson is a substring match", () => {
  const rows = flattenRoster(DOC);
  expect(byRole(rows, "Argos Lead").map((r) => r.name)).toEqual(["Jeff Kuo"]);
  expect(byRole(rows, "argos lead").length).toBe(1); // case-insensitive
  expect(byPerson(rows, "chechi").map((r) => r.role)).toEqual(["NERO Lead"]);
});

test("systemName strips a trailing 'Lead'; systems/systemOwners work over roles", () => {
  expect(systemName("Argos Lead")).toBe("Argos");
  expect(systemName("Data Visualization Lead")).toBe("Data Visualization");
  expect(systemName("Head")).toBeUndefined();
  expect(systemName("President")).toBeUndefined();

  const rows = flattenRoster(DOC);
  expect(systems(rows)).toEqual(["Argos", "NERO", "Social Media", "Tech"]);
  expect(systems(rows, { subteam: "Application Software" })).toEqual(["Argos", "NERO"]);
  expect(systemOwners(rows, "argos").map((r) => r.name)).toEqual(["Jeff Kuo"]);
  expect(systemOwners(rows, "nero").map((r) => r.name)).toEqual(["Dev Chechi"]);
});

test("chiefOf reads the area chief from the doc", () => {
  expect(chiefOf(DOC, "Software")).toBe("Chris Pyle");
  expect(chiefOf(DOC, "Business")).toBeUndefined(); // chief: null
  expect(chiefOf(DOC, "Nope")).toBeUndefined();
});

import { createHash } from "node:crypto";

export function hashSkill(files: { path: string; contents: string }[]): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const h = createHash("sha256");
  for (const f of sorted) h.update(f.path + "\0" + f.contents + "\0");
  return h.digest("hex");
}

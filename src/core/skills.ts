import { rmSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { EmbeddedPayload, State, SkillAction, ReconcileOpts, FileBlob } from "../types";
import { skillsDir } from "./paths";
import { hashSkill } from "./hash";

/**
 * Snapshot a skill dir's current on-disk files (paths relative to the dir, matching
 * `currentSkillHash`/the embed script), so an overwrite/removal can be reversed by
 * restoring them. Returns `undefined` if the skill isn't present. `node:` fs only.
 */
export function currentSkillFiles(name: string): FileBlob[] | undefined {
  const dir = join(skillsDir(), name);
  if (!existsSync(dir)) return undefined;
  const files: FileBlob[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else files.push({ path: relative(dir, full), contents: readFileSync(full, "utf8") });
    }
  };
  walk(dir);
  return files;
}

export function planSkills(
  payload: EmbeddedPayload,
  state: State | null,
  onDiskHashes: Record<string, string | undefined>,
  opts: ReconcileOpts,
): SkillAction[] {
  const actions: SkillAction[] = [];
  const recordedByName = new Map((state?.skills ?? []).map(s => [s.name, s.hash]));
  const payloadByName = new Map(payload.skills.map(s => [s.name, hashSkill(s.files)]));
  const targets = opts.targets && opts.targets.length ? new Set(opts.targets) : null;
  const inTarget = (name: string) => !targets || targets.has(name);
  const removalsAllowed = opts.full && !targets;   // targeted runs never remove

  for (const [name, payloadHash] of payloadByName) {
    if (!inTarget(name)) continue;
    const recorded = recordedByName.get(name);
    const onDisk = onDiskHashes[name];
    if (recorded === undefined) {
      if (onDisk === undefined) actions.push({ kind: "install", name });
      else actions.push({ kind: "skip-foreign", name, reason: "a skill with this name already exists and was not installed by ner-jarvis" });
    } else if (onDisk === undefined) {
      actions.push({ kind: "install", name }); // tracked but missing on disk → restore
    } else if (onDisk !== recorded) {
      if (opts.force) actions.push({ kind: "update", name });
      else actions.push({ kind: "skip-modified", name, reason: "edited since install; use --force to overwrite" });
    } else if (payloadHash !== recorded) {
      actions.push({ kind: "update", name });
    } else {
      actions.push({ kind: "noop", name });
    }
  }

  if (removalsAllowed) {
    for (const [name, recorded] of recordedByName) {
      if (payloadByName.has(name)) continue;
      const onDisk = onDiskHashes[name];
      if (onDisk === undefined) continue;
      if (onDisk === recorded) actions.push({ kind: "remove", name });
      else actions.push({ kind: "skip-modified", name, reason: "removed from payload but edited since install; left in place" });
    }
  }
  return actions;
}

export function applySkillAction(action: SkillAction, payload: EmbeddedPayload, opts: { dryRun: boolean }): void {
  if (opts.dryRun) return;
  if (action.kind === "install" || action.kind === "update") {
    const skill = payload.skills.find(s => s.name === action.name);
    if (!skill) return;
    for (const f of skill.files) {
      const dest = join(skillsDir(), skill.name, f.path);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, f.contents);
    }
  } else if (action.kind === "remove") {
    rmSync(join(skillsDir(), action.name), { recursive: true, force: true });
  }
  // skip-foreign / skip-modified / noop: nothing
}

#!/usr/bin/env node
import { parseArgs } from "./cli";
import { loadPayload } from "./core/payload";
import { setup } from "./commands/setup";
import { update } from "./commands/update";
import { doctor, printDoctor } from "./commands/doctor";
import { uninstall } from "./commands/uninstall";
import { undo } from "./commands/undo";
import { roster, printRoster } from "./commands/roster";
import { stale, printStale } from "./commands/stale";
import { printSummary, exitCodeFor } from "./core/report";
import { autoPrompter, ttyPrompter } from "./core/prompt";

const HELP = `ner-jarvis — configure Claude Code for Northeastern Electric Racing

Usage:
  ner-jarvis [setup] [name…]     install skills, connect sources, clone the workspace
                                 + open Claude Code (interactive by default on a TTY)
  ner-jarvis update [name…]      re-apply the latest payload (skills + sources)
  ner-jarvis doctor [name…]      read-only health check
  ner-jarvis uninstall [name…]   remove what ner-jarvis installed
  ner-jarvis undo                reverse the most recent setup/update run
  ner-jarvis undo --list         show the recorded run stack
  ner-jarvis roster [term…]      query the NER leadership roster (grounding truth)
                                 verbs: heads · head <team> · leads <team> ·
                                        systems [scope] · system <name> · who <name>
  ner-jarvis stale [verb]        report docs that misled you; stays on your machine
                                 verbs: add · list · export · rm <id>

Flags:
  --yes, -y    assume "yes" to every prompt (non-interactive full run)
  --force      overwrite items ner-jarvis installed but you've since edited
  --dry-run    show what would change; write nothing
  --list       (undo) list recorded runs instead of reversing one
  --json       (roster, stale) emit JSON instead of a table
  --version    print the payload/release version
  --help       show this help`;

export function run(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.command === "version") { console.log(loadPayload().version); return 0; }
  if (args.command === "help") { console.log(HELP); return 0; }

  const opts = { targets: args.targets, force: args.force, dryRun: args.dryRun };
  switch (args.command) {
    case "setup": {
      const isTTY = !!process.stdin.isTTY;
      const prompter = isTTY && !args.yes ? ttyPrompter() : autoPrompter();
      const s = setup(loadPayload(), { ...opts, yes: args.yes }, { prompter, cwd: process.cwd(), isTTY });
      printSummary(s); return exitCodeFor(s);
    }
    case "update":    { const s = update(loadPayload(), opts); printSummary(s); return exitCodeFor(s); }
    case "uninstall": {
      const isTTY = !!process.stdin.isTTY;
      const prompter = isTTY && !args.yes ? ttyPrompter() : autoPrompter();
      const s = uninstall({ ...opts, yes: args.yes }, { prompter, isTTY });
      printSummary(s); return exitCodeFor(s);
    }
    case "undo": {
      const isTTY = !!process.stdin.isTTY;
      const prompter = isTTY && !args.yes ? ttyPrompter() : autoPrompter();
      const s = undo({ force: args.force, dryRun: args.dryRun, yes: args.yes, list: args.list }, { prompter, isTTY });
      if (!args.list) printSummary(s);
      return exitCodeFor(s);
    }
    case "doctor":    { const r = doctor({ targets: args.targets }); printDoctor(r); return r.ok ? 0 : 1; }
    case "roster":    { const r = roster({ targets: args.targets, json: args.json }); printRoster(r); return r.ok ? 0 : 1; }
    case "stale": {
      const isTTY = !!process.stdin.isTTY;
      const prompter = isTTY && !args.yes ? ttyPrompter() : autoPrompter();
      const r = stale(
        { targets: args.targets, options: args.options, json: args.json, toolVersion: loadPayload().version },
        { prompter, isTTY },
      );
      printStale(r); return r.ok ? 0 : 1;
    }
  }
  console.log(HELP); return 1; // defensive: parseArgs always yields a known command
}

if (import.meta.main) process.exit(run(process.argv.slice(2)));

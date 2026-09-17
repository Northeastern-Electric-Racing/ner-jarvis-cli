import { readSync } from "node:fs";

/**
 * A minimal interactive prompter. Two questions:
 *   - `confirm`  → yes/no, where **Enter accepts the default** and `n`/`no` declines.
 *   - `askPath`  → a path, where **Enter accepts the default** and any other line is
 *                  taken verbatim (trimmed).
 *
 * Implementations differ only in where the line comes from: a real TTY, a scripted
 * queue (tests), or nowhere at all (auto — always returns the default).
 */
export interface Prompter {
  confirm(question: string, defaultYes?: boolean): boolean;
  askPath(question: string, defaultPath: string): string;
}

type ReadLine = () => string | null; // one line without its newline, or null at EOF
type Write = (s: string) => void;

/**
 * Build a prompter over an injected line reader + writer. This is the single place
 * the Enter/`n` semantics live, so it's the same for the TTY and scripted prompters.
 */
export function makeStreamPrompter(readLine: ReadLine, out: Write): Prompter {
  return {
    confirm(question, defaultYes = true) {
      const hint = defaultYes ? "[Enter=yes / n]" : "[y / Enter=no]";
      for (;;) {
        out(`${question} ${hint} `);
        const line = readLine();
        if (line === null) return defaultYes; // EOF / no more input → default
        const t = line.trim().toLowerCase();
        if (t === "") return defaultYes; // bare Enter → default
        if (t === "y" || t === "yes") return true;
        if (t === "n" || t === "no") return false;
        out("Please answer y or n.\n");
      }
    },
    askPath(question, defaultPath) {
      out(`${question} [${defaultPath}] `);
      const line = readLine();
      if (line === null) return defaultPath;
      const t = line.trim();
      return t === "" ? defaultPath : t;
    },
  };
}

/** Non-interactive prompter: every answer is the default; it never reads or writes. */
export function autoPrompter(): Prompter {
  return {
    confirm: (_q, defaultYes = true) => defaultYes,
    askPath: (_q, defaultPath) => defaultPath,
  };
}

/** Test prompter: answers come from `lines` (then EOF); `out` defaults to a no-op. */
export function scriptedPrompter(lines: string[], out: Write = () => {}): Prompter {
  const queue = [...lines];
  return makeStreamPrompter(() => (queue.length ? queue.shift()! : null), out);
}

// --- real TTY line reader -------------------------------------------------
// Reads fd 0 in chunks, buffering across calls so one line comes back per call.
// `node:fs` readSync (not readline) keeps the whole CLI synchronous and works the
// same under Bun and Node. EAGAIN (non-blocking stdin) is retried until data lands.
let pending = "";
function readLineFd0(): string | null {
  while (!pending.includes("\n")) {
    const buf = Buffer.alloc(1024);
    let n = 0;
    try {
      n = readSync(0, buf, 0, buf.length, null);
    } catch (e: any) {
      if (e?.code === "EAGAIN") continue;
      if (e?.code === "EOF") n = 0;
      else throw e;
    }
    if (n === 0) {
      if (pending.length === 0) return null; // true EOF, nothing buffered
      const rest = pending;
      pending = "";
      return rest.replace(/\r$/, "");
    }
    pending += buf.toString("utf8", 0, n);
  }
  const idx = pending.indexOf("\n");
  const line = pending.slice(0, idx).replace(/\r$/, "");
  pending = pending.slice(idx + 1);
  return line;
}

/** Interactive prompter backed by the real terminal (fd 0 → stdout). */
export function ttyPrompter(): Prompter {
  return makeStreamPrompter(readLineFd0, (s) => process.stdout.write(s));
}

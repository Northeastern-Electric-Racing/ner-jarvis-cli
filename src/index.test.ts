import { expect, test } from "bun:test";
import { run } from "./index";
import { withTempEnv } from "../test/helpers";

/** Run `fn` with console.log captured; returns the joined captured output. */
function captureLog<T>(fn: () => T): { code: T; out: string } {
  const original = console.log;
  const chunks: string[] = [];
  console.log = (...args: unknown[]) => { chunks.push(args.map(String).join(" ")); };
  try {
    const code = fn();
    return { code, out: chunks.join("\n") };
  } finally {
    console.log = original;
  }
}

test("run(['--version']) → 0 and prints a semver", () => {
  const { code, out } = captureLog(() => run(["--version"]));
  expect(code).toBe(0);
  expect(out).toMatch(/\d+\.\d+\.\d+/);
});

test("run(['--help']) → 0 and prints usage", () => {
  const { code, out } = captureLog(() => run(["--help"]));
  expect(code).toBe(0);
  expect(out).toMatch(/Usage/);
});

// Clean HOME → no state → doctor reports "not set up" and returns before any
// wrapper call, so the real `claude` is never invoked.
test("run(['doctor']) on a clean HOME → non-zero (not set up), no claude call", () => {
  withTempEnv(() => {
    const { code } = captureLog(() => run(["doctor"]));
    expect(typeof code).toBe("number");
    expect(code).not.toBe(0);
  });
});

// `undo --list` on a clean HOME → prints the (empty) stack, exit 0, no claude call.
test("run(['undo','--list']) on a clean HOME → 0 and reports nothing to undo", () => {
  withTempEnv(() => {
    const { code, out } = captureLog(() => run(["undo", "--list"]));
    expect(code).toBe(0);
    expect(out).toMatch(/nothing to undo/i);
  });
});

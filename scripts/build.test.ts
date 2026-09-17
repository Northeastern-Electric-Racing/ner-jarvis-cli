import { test, expect } from "bun:test";
import { binaryOutName } from "./build";

// Regression: v0.1.0 shipped with no Windows binary. `bun build --compile` appends
// .exe for Windows targets, so the release step's upload pattern matched nothing —
// and the action only warns on an unmatched pattern, so the job stayed green.
test("binaryOutName appends .exe only for Windows targets", () => {
  expect(binaryOutName("bun-windows-x64")).toBe("ner-jarvis-bun-windows-x64.exe");
  expect(binaryOutName("bun-linux-x64")).toBe("ner-jarvis-bun-linux-x64");
  expect(binaryOutName("bun-darwin-arm64")).toBe("ner-jarvis-bun-darwin-arm64");
});

test("binaryOutName with no target is the plain host name", () => {
  expect(binaryOutName()).toBe("ner-jarvis");
});

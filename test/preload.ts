// Test safety net (loaded via bunfig.toml `[test].preload`).
//
// Baseline HOME/USERPROFILE to a throwaway temp dir for the ENTIRE test process, so
// no test can ever write to the real ~/.claude — even if one forgets `withTempEnv`
// or a cross-file race restores the baseline mid-run. `withTempEnv` layers per-test
// temp dirs on top of this and restores back to THIS temp baseline, never the real
// home. Enforces the plan's "never touch the real ~/.claude in tests" rule.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = mkdtempSync(join(tmpdir(), "nerj-test-home-"));
process.env.HOME = base;
process.env.USERPROFILE = base;

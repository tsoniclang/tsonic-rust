import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("generic JS future alternatives execute exact integer outputs and errors without empty capture allocations", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
    import type { int64 } from "@tsonic/core/types.js";
    type Read = <Value>(value: Value) => Promise<Value>;
    function choose(success: boolean): Read {
      return success ? async <Value>(value: Value): Promise<Value> => value
        : async <Value>(_value: Value): Promise<Value> => { throw new Error("selected failure"); };
    }
    export async function main(): Promise<void> {
      const success = choose(true);
      const failure = choose(false);
      const wide: int64 = 9007199254740993n;
      if (await success<int64>(wide) !== wide) throw new Error("generic output changed");
      let rejected = false;
      try { await failure<int64>(wide); } catch { rejected = true; }
      if (!rejected) throw new Error("generic error lost");
    }
  ` } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => `${row.code}: ${row.message}`).join("\n"));
  const generated = artifactText(result, "src/index.rs");
  assert.doesNotMatch(generated, /Rc::new\(CallableEnvironment/u,
    "a noncapturing, identity-unobserved implementation has no captured environment allocation");
  assert.doesNotMatch(generated, /transmute|Box::leak|9007199254740992/u);
  const root = writeGeneratedProject("generic_js_future_completions", result.artifacts);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["fmt", "--all"]);
  runCargo(root, ["fmt", "--all", "--check"]);
  runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(root, ["run", "--locked", "--offline"]);
});

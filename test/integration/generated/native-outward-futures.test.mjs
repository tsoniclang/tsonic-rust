import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("stored native futures retain direct pure outputs and exact fallible outputs through forwarding", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: [], files: { "index.ts": `
    import type { int32 } from "@tsonic/core/types.js";
    export async function pure(): Promise<int32> { return 13; }
    export async function failed(): Promise<int32> { throw "failure"; }
    export async function generic<Value>(value: Value): Promise<Value> { return value; }
    export function forward(): Promise<int32> { const stored = pure(); return stored; }
    export function failure(): Promise<int32> { return failed(); }
    export function selected(value: int32): Promise<int32> { return generic(value); }
  ` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const generated = artifactText(result, "src/index.rs");
  assert.match(generated, /fn forward\(\) -> impl core::future::Future<Output = i32>/u);
  assert.doesNotMatch(generated, /Box<dyn|Pin<Box|JsPromise|transmute|unreachable_unchecked/u);
  const directory = writeGeneratedProject("native-outward-futures", result.artifacts);
  appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod outward_future_checks {
    use super::*;

    #[test]
    fn exact_outputs_execute_without_a_compatibility_future() {
        let pure: i32 = rt::block_on(forward());
        let generic: i32 = rt::block_on(selected(29));
        assert_eq!(pure, 13);
        assert_eq!(generic, 29);
        assert!(rt::block_on(failure()).is_err());
    }
}
`);
  runCargo(directory, ["generate-lockfile", "--offline"]);
  runCargo(directory, ["fmt"]);
  runCargo(directory, ["fmt", "--check"]);
  runCargo(directory, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(directory, ["test", "--locked", "--offline"]);
});

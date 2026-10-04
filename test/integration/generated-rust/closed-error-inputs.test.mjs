import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closedErrorInputsSource } from "../../../../tsonic/test/fixtures/closed-error-inputs.mjs";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

test("checked closed Error inputs retain native identity without per-read allocation", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "lib", crateName: "closed_error_inputs" } },
    files: { "index.ts": closedErrorInputsSource },
  });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /SourceError::from/u);
  assert.doesNotMatch(source, /JsError::new\([^\n]*\.message\(/u);
  const directory = writeGeneratedProject("closed-error-inputs", result.artifacts);
  mkdirSync(join(directory, "tests"), { recursive: true });
  writeFileSync(join(directory, "tests/cost.rs"), `${nativeOwnershipCostSupport}
use closed_error_inputs::index;
#[test]
fn closed_error_input_cost() {
    let (small, small_cost) = measure(|| index::run(Some(1)).expect("native fixture completes"));
    let (large, large_cost) = measure(|| index::run(Some(10_000)).expect("native fixture completes"));
    assert!(small && large);
    assert_eq!(small_cost, large_cost);
}
`);
  runCargo(directory, ["test", "--quiet", "--test", "cost"]);
});

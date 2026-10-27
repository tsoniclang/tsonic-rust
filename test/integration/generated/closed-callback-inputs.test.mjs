import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closedIntegerCallbackInputsSource, closedPromiseCallbackInputsSource, closedThrowingCallbackInputsSource, closedNativeCallbackEffectsSource } from "../../../../tsonic/test/fixtures/closed-callback-inputs.mjs";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject, validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

test("closed integer callback inputs retain native width without per-call allocation", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "lib", crateName: "closed_callback_inputs" } },
    files: { "index.ts": closedIntegerCallbackInputsSource },
  });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
  const source = artifactText(result, "src/index.rs");
  assert.equal(/JsValue|i64_to_f64|as f64/u.test(source), false,
    "closed integer callback inputs retain native integer storage");
  const directory = writeGeneratedProject("closed-callback-inputs", result.artifacts);
  mkdirSync(join(directory, "tests"), { recursive: true });
  writeFileSync(join(directory, "tests/cost.rs"), `${nativeOwnershipCostSupport(directory)}
use closed_callback_inputs::index;
#[test]
fn closed_callback_input_cost() {
    let (small, small_cost) = measure(|| index::run(Some(1)).expect("native fixture completes"));
    let (large, large_cost) = measure(|| index::run(Some(10_000)).expect("native fixture completes"));
    assert!(small && large);
    assert_eq!(small_cost, large_cost);
}
`);
  runCargo(directory, ["test", "--quiet", "--test", "cost"]);
});

test("closed Promise callback inputs preserve authored Error payload and identity", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": closedPromiseCallbackInputsSource +
      '\nexport async function main(): Promise<void> { if (!await run()) throw new Error("closed callback input"); }\nawait main();\n' },
  });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
  // RULINGS 2026-10-22: on the js surface an `unknown` rejection reason stays JsValue (JS rejection reasons are
  // arbitrary values); the authored Error itself keeps its native type and is never erased to `dyn Any`.
  const output = artifactText(result, "src/index.rs");
  assert.equal(/dyn Any/u.test(output), false, "closed callback inputs must not erase the authored Error payload");
  assert.match(output, /let original: DetailedError = DetailedError::new\(/u, "the authored Error keeps its native type");
  validateGeneratedProject("closed-promise-callback-inputs", result.artifacts, { run: true });
});

test("stored native callbacks preserve thrown Error identity", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": closedThrowingCallbackInputsSource +
      '\nexport function main(): void { if (!run()) throw new Error("native callback failure identity"); }\nmain();\n' } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
  validateGeneratedProject("closed-throwing-callback-inputs", result.artifacts, { run: true });
});

test("physical callback effects do not change an infallible direct implementation", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": closedNativeCallbackEffectsSource +
      '\nexport function main(): void { if (!run()) throw new Error("native callback effects"); }\nmain();\n' } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
  assert.match(artifactText(result, "src/index.rs"), /pub\(crate\) fn positive\(value: i32\) -> bool/u);
  validateGeneratedProject("closed-native-callback-effects", result.artifacts, { run: true });
  const library = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "lib" } },
    files: { "index.ts": closedNativeCallbackEffectsSource } }).result;
  assert.equal(library.diagnostics.length, 0, library.diagnostics.map(row => row.message).join("\n"));
  assert.match(artifactText(library, "src/index.rs"), /pub fn positive\(value: i32\) -> bool/u);
});

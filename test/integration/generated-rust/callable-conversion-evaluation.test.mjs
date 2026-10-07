import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { absenceCallableConversionSource, broadCallableConversionSource, nativeCallableAdapterCostSource, nativeCallableInputBorrowSource } from "../../../../tsonic/test/fixtures/callable-conversion-evaluation.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`stored and factory-produced absence callbacks bind once in ${lane}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": absenceCallableConversionSource + '\nexport function main(): void { if (!run()) throw new Error("callable conversion"); }' } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject(`absence-callable-conversion-${lane}`, result.artifacts, { run: true });
  });
}

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`source callable input adaptation borrows native string parameters in ${lane}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": nativeCallableInputBorrowSource + '\nexport function main(): void { if (!run()) throw new Error("callable input borrow"); }' } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n").slice(0, 6000));
    validateGeneratedProject(`source-callable-input-borrow-${lane}`, result.artifacts, { run: true });
  });
}

test("stored and factory-produced broad callbacks bind once on the JS surface", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": broadCallableConversionSource + '\nexport function main(): void { if (!run()) throw new Error("broad callable conversion"); }' } });
  assertNoTargetDiagnostics(result.diagnostics);
  validateGeneratedProject("broad-callable-conversion", result.artifacts, { run: true });
});

test("native callable adapters retain one construction frame and no per-call allocation", { timeout: 300_000 }, () => {
  const { result } = compileRust({ target: { id: "rust", options: { outputType: "lib", crateName: "native_callable_cost" } },
    files: { "index.ts": nativeCallableAdapterCostSource } });
  assertNoTargetDiagnostics(result.diagnostics);
  const root = writeGeneratedProject("native-callable-adapter-allocation", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/ownership.rs"), nativeOwnershipCostSupport + `
use native_callable_cost::index;
use tsonic_rust_runtime::{Callable, TsonicResult};

#[test]
fn one_frame_for_fresh_native_producers() {
    native_callable_cost::initialize();
    drop(index::defaultCallback());
    let expected_static = measure(|| Callable::new(|(_unused,): (f64,)| -> TsonicResult<f64> { Ok(0.0) })).1;
    let expected_captured = measure(|| {
        let initial = Cell::new(0.0);
        Callable::new(move |(_unused,): (f64,)| -> TsonicResult<f64> {
            initial.set(initial.get() + 1.0);
            Ok(initial.get())
        })
    }).1;
    let expected_default = measure(|| Callable::new(|(value,): (Option<f64>,)| -> TsonicResult<f64> { Ok(value.unwrap_or(5.0)) })).1;
    let actual_static = measure(index::staticCallback).1;
    let actual_inline = measure(index::inlineCallback).1;
    let actual_captured = measure(|| index::capturedCallback(0.0)).1;
    assert_eq!(actual_static, expected_static);
    assert_eq!(actual_inline, expected_static);
    assert_eq!(actual_captured, expected_captured);
    assert_eq!(actual_static.allocations, 1);
    assert_eq!(actual_captured.allocations, 1);
    assert_eq!(measure(index::defaultCallback).1, Cost::default());
    assert_eq!(expected_default.allocations, 1);
}

#[test]
fn no_per_call_allocation() {
    native_callable_cost::initialize();
    let first = index::staticCallback();
    let second = index::inlineCallback();
    let third = index::capturedCallback(0.0);
    let fourth = index::defaultCallback();
    for index in 0..10000 {
        first.call((index as f64,)).unwrap();
        second.call((index as f64,)).unwrap();
        third.call((index as f64,)).unwrap();
        fourth.call((None,)).unwrap();
    }
    let (result, cost) = measure(|| {
        let mut result = 0.0;
        for index in 0..10000 {
            result += first.call((index as f64,)).unwrap()
                + second.call((index as f64,)).unwrap()
                + third.call((index as f64,)).unwrap()
                + fourth.call((None,)).unwrap();
        }
        result
    });
    assert_eq!(result, 750065000.0);
    assert_eq!(cost, Cost::default());
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["fmt", "--all"]);
  runCargo(root, ["fmt", "--all", "--check"]);
  runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["test", "--locked", "--offline"]);
});

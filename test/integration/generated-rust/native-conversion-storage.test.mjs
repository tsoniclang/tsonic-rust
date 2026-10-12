import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("source-produced ordered callable storage executes with its exact native errors", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: [], target: { id: "rust", options: {
    outputType: "lib", crateName: "native_conversion_storage",
  } }, files: { "index.ts": `import type { int32 } from "@tsonic/core/types.js";
    export function chained(): (first: int32, second: int32) => int32 {
      const original = (): int32 => 3;
      const one: (first: int32) => int32 = original;
      const two: (first: int32, second: int32) => int32 = one;
      return two;
    }
    export function checked(): (value: number, unused: int32) => void {
      const original = (value: int32): int32 => value;
      const widened: (value: number) => number = original;
      const discarded: (value: number, unused: int32) => void = widened;
      return discarded;
    }
    export function fromInput<Value>(callback: () => Value): (first: int32, second: int32) => Value {
      const one: (first: int32) => Value = callback;
      const two: (first: int32, second: int32) => Value = one;
      return two;
    }
    export function adaptedInput(): (first: int32, second: int32) => int32 {
      return fromInput((): int32 => 11);
    }
  ` } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.map(diagnostic => `${diagnostic.sourceSpan?.line ?? "?"}: ${diagnostic.message}`).join("\n").slice(0, 6000));
  const root = writeGeneratedProject("native-conversion-storage", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/conversions.rs"), `
use core::convert::Infallible;
use native_conversion_storage::index;
use tsonic_rust_runtime::{Callable, TsonicError};

#[test]
fn exact_infallible_stored_and_returned_adapters() {
    native_conversion_storage::initialize();
    let callback: Callable<'_, (i32, i32), Result<i32, Infallible>> = index::chained();
    assert_eq!(callback.call((5, 7)).unwrap(), 3);
    assert_eq!(callback.call((8, 9)).unwrap(), 3);
}

#[test]
fn earlier_conversion_failure_survives_result_discard() {
    native_conversion_storage::initialize();
    let callback: Callable<'_, (f64, i32), Result<(), index::NativeErrors2<Infallible, TsonicError>>> = index::checked();
    assert!(callback.call((3.0, 5)).is_ok());
    assert!(matches!(callback.call((3.5, 5)), Err(index::NativeErrors2::Error1(_))));
    assert!(matches!(callback.call((f64::INFINITY, 5)), Err(index::NativeErrors2::Error1(_))));
}

#[test]
fn instantiated_formal_adapter_keeps_producer_error() {
    native_conversion_storage::initialize();
    let callback: Callable<'_, (i32, i32), Result<i32, Infallible>> = index::adaptedInput();
    assert_eq!(callback.call((1, 2)).unwrap(), 11);
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["fmt", "--all"]);
  runCargo(root, ["fmt", "--all", "--check"]);
  runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["test", "--locked", "--offline"]);
});

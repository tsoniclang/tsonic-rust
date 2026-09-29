import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactText, compileRustThroughTargetPack } from "../../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../../helpers/cargo-projects.mjs";

test("native Result propagation retains early return, generic carriers and exact error conversion", { timeout: 300_000 }, () => {
  const { result } = compileRustThroughTargetPack({
    target: { id: "rust", options: { outputType: "lib", crateName: "native_control" } },
    files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Mut } from "@tsonic/rust/types.js";
import { load, store, propagate as checked } from "@tsonic/rust/lang.js";
import { Result } from "@tsonic/rust/core/result.js";
type Outcome<T> = Result<T, int32>;
export function forward<T>(value: Outcome<T>): Outcome<T> {
  return Result.Ok<T, int32>(checked(value));
}
export function increment(value: Outcome<int32>, writes: Mut<int32>): Outcome<int32> {
  const result = checked(value);
  store(writes, load(writes) + 1);
  return Result.Ok<int32, int32>(result + 1);
}
function propagate(value: int32): int32 { return value + 4; }
export function ordinary(): int32 { return propagate(3); }
export function cleanup(value: Outcome<int32>, writes: Mut<int32>): Outcome<int32> {
  try { return Result.Ok<int32, int32>(checked(value)); }
  finally { store(writes, load(writes) + 1); }
}
export function fallback(value: Outcome<int32>, present: int32 | undefined): Outcome<int32> {
  return Result.Ok<int32, int32>(present ?? checked(value));
}
export function optionalCall(value: Outcome<int32>, callback: ((value: int32) => int32) | undefined): Outcome<int32> {
  const selected = callback?.(checked(value));
  return Result.Ok<int32, int32>(selected ?? 0);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /value\?/u);
  assert.doesNotMatch(output, /unwrap\(|panic!/u);
  const optionalCallOffset = output.indexOf("pub fn optionalCall");
  assert.ok(optionalCallOffset > output.indexOf("pub fn forward"));
  assert.doesNotMatch(output, /\boptional_call\b/u);
  const ordinaryNativeFunctions = output.slice(output.indexOf("pub fn forward"), optionalCallOffset);
  assert.doesNotMatch(ordinaryNativeFunctions, /TsonicResult|TsonicError/u);
  const root = writeGeneratedProject("native-control", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/result.rs"), `
use native_control::index::{cleanup, fallback, forward, increment, ordinary, optionalCall};
#[test]
fn early_error_does_not_run_following_statements() {
    let mut writes = 0;
    assert_eq!(increment(Err(7), &mut writes), Err(7));
    assert_eq!(writes, 0);
    assert_eq!(increment(Ok(8), &mut writes), Ok(9));
    assert_eq!(writes, 1);
    assert_eq!(ordinary(), 7);
    assert_eq!(cleanup(Err(12), &mut writes), Err(12));
    assert_eq!(writes, 2);
    assert_eq!(cleanup(Ok(13), &mut writes), Ok(13));
    assert_eq!(writes, 3);
    assert_eq!(fallback(Err(14), Some(15)), Ok(15));
    assert_eq!(fallback(Err(14), None), Err(14));
    assert_eq!(optionalCall(Err(16), None).unwrap(), Ok(0));
    let unreachable_callback = tsonic_rust_runtime::Callable::new(|(_value,)| panic!("native error must return before callback"));
    assert_eq!(optionalCall(Err(17), Some(unreachable_callback)).unwrap(), Err(17));
    let increment = tsonic_rust_runtime::Callable::new(|(value,)| Ok(value + 1));
    assert_eq!(optionalCall(Ok(18), Some(increment)).unwrap(), Ok(19));
}
#[test]
fn generic_ownership_and_drop_are_native() {
    let value = Box::new(7);
    let address = &*value as *const i32;
    let returned = forward(Ok(value)).unwrap();
    assert_eq!(address, &*returned as *const i32);
    assert_eq!(forward::<Box<i32>>(Err(9)), Err(9));
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["test", "--locked", "--offline"]);
});

test("native ranges and iterator adapters retain monomorphized collection and borrowed predicates", { timeout: 300_000 }, () => {
  const { result } = compileRustThroughTargetPack({
    target: { id: "rust", options: { outputType: "lib", crateName: "native_iterators" } },
    files: { "index.ts": `
import type { nativeUint } from "@tsonic/core/types.js";
import { range, load } from "@tsonic/rust/lang.js";
import { Vec } from "@tsonic/rust/std/vec.js";
export function values(): Vec<nativeUint> {
  const count: nativeUint = 4;
  return range<nativeUint>(0, count).map(value => value + 1).collect<Vec<nativeUint>>();
}
export function matches(): nativeUint {
  return range<nativeUint>(0, 4).filter(value => load(value) < 2).count();
}
export function empty(): nativeUint {
  return range<nativeUint>(4, 4).count();
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.doesNotMatch(output, /JsArray|Callable::|Location::|Box::new/u);
  const root = writeGeneratedProject("native-iterators", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/iterators.rs"), `
use native_iterators::index::{empty, matches, values};
#[test]
fn native_iteration_results() {
    assert_eq!(values(), vec![1, 2, 3, 4]);
    assert_eq!(matches(), 2);
    assert_eq!(empty(), 0);
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["test", "--locked", "--offline"]);
});

test("native Result entrypoint uses native Termination without an additional error carrier", { timeout: 300_000 }, () => {
  const { result } = compileRustThroughTargetPack({
    target: { id: "rust", options: { outputType: "bin", crateName: "native_result_entry" } },
    files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { Result } from "@tsonic/rust/core/result.js";
import { propagate } from "@tsonic/rust/lang.js";
function value(): Result<int32, int32> { return Result.Ok<int32, int32>(4); }
export function main(): Result<void, int32> {
  propagate(value());
  return Result.Ok<void, int32>(undefined);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/main.rs");
  assert.match(output, /std::process::Termination::report/u);
  assert.doesNotMatch(output, /TsonicError|TsonicResult|Box::|panic!|unwrap\(/u);
  validateGeneratedProject("native-result-entry", result.artifacts, { run: true });
});

test("native propagation rejects non-Result enclosing returns before emission", () => {
  const { result } = compileRustThroughTargetPack({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Result } from "@tsonic/rust/core/result.js";
import { propagate } from "@tsonic/rust/lang.js";
export function invalid(value: Result<int32, int32>): int32 { return propagate(value); }
` } });
  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_NATIVE_CONTROL_CONTRACT_REQUIRED"));
});

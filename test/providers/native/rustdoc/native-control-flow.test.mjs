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
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /value\?/u);
  assert.doesNotMatch(output, /unwrap\(|TsonicResult|TsonicError|panic!/u);
  const root = writeGeneratedProject("native-control", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/result.rs"), `
use native_control::index::{forward, increment, ordinary};
#[test]
fn early_error_does_not_run_following_statements() {
    let mut writes = 0;
    assert_eq!(increment(Err(7), &mut writes), Err(7));
    assert_eq!(writes, 0);
    assert_eq!(increment(Ok(8), &mut writes), Ok(9));
    assert_eq!(writes, 1);
    assert_eq!(ordinary(), 7);
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
    target: { id: "rust", options: { outputType: "bin", crateName: "native_iterators" } },
    files: { "index.ts": `
import type { nativeUint } from "@tsonic/core/types.js";
import { range, load } from "@tsonic/rust/lang.js";
import { Vec } from "@tsonic/rust/std/vec.js";
import { println } from "@tsonic/rust/std/index.js";
export function main(): void {
  const count: nativeUint = 4;
  const values = range<nativeUint>(0, count).map(value => value + 1).collect<Vec<nativeUint>>();
  const matches = range<nativeUint>(0, count).filter(value => load(value) < 2).count();
  println("{} {} {}", values.len(), matches, range<nativeUint>(4, 4).count());
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.doesNotMatch(output, /JsArray|Callable::|Location::|Box::new/u);
  const run = validateGeneratedProject("native-iterators", result.artifacts, { run: true });
  assert.equal(run.stdout, "4 2 0\n");
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

import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactText, compileRustThroughTargetPack } from "../../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../../helpers/cargo-projects.mjs";

test("native FnMut and FnOnce captures retain ordinary mutable values without additional storage", { timeout: 300_000 }, () => {
  const { result } = compileRustThroughTargetPack({
    target: { id: "rust", options: { outputType: "lib", crateName: "native_capture" } },
    files: { "index.ts": `
import type { int32, nativeUint } from "@tsonic/core/types.js";
import { range } from "@tsonic/rust/lang.js";
import { Vec } from "@tsonic/rust/std/vec.js";
import { Result } from "@tsonic/rust/core/result.js";
export function prefixSums(count: nativeUint, seed: nativeUint): Vec<nativeUint> {
  return range<nativeUint>(0, count).map(value => { seed += value; return seed; }).collect<Vec<nativeUint>>();
}
export function once(value: Result<int32, int32>, seed: int32): Result<int32, int32> {
  return value.map(item => { seed += item; return seed; });
}
export function owned(value: Result<int32, int32>, seed: string): Result<string, int32> {
  return value.map(item => { if (item > 0) seed = "updated"; return seed; });
}
export function snapshots(count: nativeUint, seed: string): Vec<string> {
  return range<nativeUint>(0, count).map(value => { if (value > 0) seed = "updated"; return seed; }).collect<Vec<string>>();
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /move \|/u);
  assert.doesNotMatch(output, /Cell|Location|Callable|Box::/u);
  assert.doesNotMatch(output.slice(0, output.indexOf("pub fn snapshots")), /\.clone\(/u);
  assert.match(output.slice(output.indexOf("pub fn snapshots")), /seed\.clone\(\)/u);
  const root = writeGeneratedProject("native-capture-ownership", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/captures.rs"), `
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
struct Counting;
thread_local! {
    static ACTIVE: Cell<bool> = const { Cell::new(false) };
    static CALLS: Cell<usize> = const { Cell::new(0) };
    static BYTES: Cell<usize> = const { Cell::new(0) };
}
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if ACTIVE.get() { CALLS.set(CALLS.get() + 1); BYTES.set(BYTES.get() + layout.size()); }
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) { unsafe { System.dealloc(pointer, layout) } }
}
#[global_allocator]
static ALLOCATOR: Counting = Counting;
fn measure<Value>(operation: impl FnOnce() -> Value) -> (Value, usize, usize) {
    CALLS.set(0); BYTES.set(0); ACTIVE.set(true);
    let result = std::hint::black_box(operation());
    ACTIVE.set(false);
    (result, CALLS.get(), BYTES.get())
}
fn handwritten(count: usize, mut seed: usize) -> Vec<usize> {
    (0..count).map(move |value| { seed += value; seed }).collect()
}
#[test]
fn native_mutation_and_allocation_match_handwritten_captures() {
    for count in [0, 1, 10, 10000] {
        let actual = measure(|| native_capture::index::prefix_sums(std::hint::black_box(count), 7));
        let expected = measure(|| handwritten(std::hint::black_box(count), 7));
        assert_eq!(actual, expected);
    }
    assert_eq!(native_capture::index::once(Ok(3), 4), Ok(7));
    assert_eq!(native_capture::index::once(Err(5), 4), Err(5));
    let seed = String::from("retained");
    let pointer = seed.as_ptr();
    let (result, calls, bytes) = measure(|| native_capture::index::owned(Ok(0), seed));
    let result = result.unwrap();
    assert_eq!(result.as_ptr(), pointer);
    assert_eq!(result, "retained");
    assert_eq!((calls, bytes), (0, 0));
    assert_eq!(native_capture::index::owned(Ok(1), String::from("old")), Ok(String::from("updated")));
    assert_eq!(native_capture::index::owned(Err(6), String::from("unused")), Err(6));
    assert_eq!(native_capture::index::snapshots(4, String::from("retained")), ["retained", "updated", "updated", "updated"]);
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["test", "--release", "--locked", "--offline", "--test", "captures"]);
  runCargo(root, ["clippy", "--lib", "--locked", "--offline", "--", "-D", "warnings"]);
});

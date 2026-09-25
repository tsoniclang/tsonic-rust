import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

function compile(source, options = {}) {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", ...options } }, files: { "index.ts": source } });
  assert.deepEqual(result.diagnostics, []);
  return { result, output: artifactText(result, "src/index.rs") };
}

test("one synchronous capture owns inline native storage across calls and callable aliases", { timeout: 300_000 }, () => {
  const { result, output } = compile(`
    import type { int32 } from "@tsonic/core/types.js";
    function counter(seed: int32): () => int32 { return () => ++seed; }
    function local(): () => int32 { let total: int32 = 3; return () => { const previous = total++; total += 2; return previous; }; }
    function branching(seed: int32): (increment: boolean) => int32 { return increment => { if (increment) seed += 2; else seed = seed - 1; return seed; }; }
    export function main(): void {
      const first = counter(1);
      const alias = first;
      const second = counter(10);
      const stored = local();
      const choose = branching(7);
      if (first() !== 2 || alias() !== 3 || second() !== 11 || first() !== 4 ||
        stored() !== 3 || stored() !== 6 || choose(true) !== 9 || choose(false) !== 8) throw new Error("single owner");
    }
  `);
  assert.match(output, /core::cell::Cell::new/u);
  assert.match(output, /\.get\(\)/u);
  assert.match(output, /\.set\(/u);
  assert.doesNotMatch(output, /Location::allocate|RefCell|capture_\w+ = (?:seed|total)\.clone\(\)/u);
  validateGeneratedProject("single-native-capture", result.artifacts, { run: true });
});

test("independent, repeated, nested and addressed capture owners retain their shared binding", { timeout: 300_000 }, () => {
  const { result, output } = compile(`
    import { addressOf, loadPointer, storePointer } from "@tsonic/core/lang.js";
    import type { int32 } from "@tsonic/core/types.js";
    function independent(seed: int32): (() => int32)[] { return [() => ++seed, () => ++seed]; }
    function repeated(seed: int32): (() => int32)[] { const values: (() => int32)[] = []; for (let index = 0; index < 2; index++) values.push(() => ++seed); return values; }
    function nested(seed: int32): () => () => int32 { return () => () => ++seed; }
    function addressed(seed: int32): () => int32 { return () => { const pointer = addressOf(seed); storePointer(pointer, loadPointer(pointer) + 1); return seed; }; }
    export function main(): void {
      const pair = independent(1);
      const loop = repeated(10);
      const factory = nested(20);
      const first = factory(); const second = factory();
      const pointer = addressed(30);
      if (pair[0]() !== 2 || pair[1]() !== 3 || loop[0]() !== 11 || loop[1]() !== 12 ||
        first() !== 21 || second() !== 22 || pointer() !== 31 || pointer() !== 32) throw new Error("shared owner");
    }
  `);
  assert.match(output, /Location::allocate/u);
  assert.doesNotMatch(output, /core::cell::Cell::new/u);
  validateGeneratedProject("shared-native-capture", result.artifacts, { run: true });
});

test("a single non-Copy capture uses inline native interior storage without a separate owner", { timeout: 300_000 }, () => {
  const { result, output } = compile(`
    function append(seed: string): (suffix: string) => string {
      return suffix => { seed = seed + suffix; return seed; };
    }
    export function main(): void {
      const first = append("a");
      const alias = first;
      const second = append("b");
      if (first("x") !== "ax" || alias("y") !== "axy" || second("z") !== "bz") throw new Error("owned string capture");
    }
  `);
  assert.match(output, /core::cell::RefCell::new/u);
  assert.doesNotMatch(output, /Location::allocate|Rc::new\([^\n]*RefCell/u);
  validateGeneratedProject("single-owned-string-capture", result.artifacts, { run: true });
});

test("unique mutable capture allocation matches an independent native owning Fn", { timeout: 300_000 }, () => {
  const { result } = compile(`
    import type { int32 } from "@tsonic/core/types.js";
    export function counter(seed: int32): () => int32 { return () => ++seed; }
    export function append(seed: string): (suffix: string) => string {
      return suffix => { seed = seed + suffix; return seed; };
    }
  `, { outputType: "lib", crateName: "capture_cost" });
  const root = writeGeneratedProject("native-capture-cost", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/cost.rs"), `
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::{Cell, RefCell};
use std::rc::Rc;
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
fn handwritten(seed: i32) -> Rc<dyn Fn() -> i32> {
    let seed = Cell::new(seed);
    Rc::new(move || { let next = seed.get() + 1; seed.set(next); next })
}
fn handwritten_string(seed: String) -> Rc<dyn Fn(String) -> String> {
    let seed = RefCell::new(seed);
    Rc::new(move |suffix| {
        let next = seed.borrow().clone() + &suffix;
        *seed.borrow_mut() = next;
        seed.borrow().clone()
    })
}
#[test]
fn same_frame_and_no_call_allocation() {
    let (actual, actual_calls, actual_bytes) = measure(|| capture_cost::index::counter(0));
    let (expected, expected_calls, expected_bytes) = measure(|| handwritten(0));
    assert_eq!((actual_calls, actual_bytes), (expected_calls, expected_bytes));
    assert_eq!(actual_calls, 1);
    let (_, calls, bytes) = measure(|| {
        for _iteration in 0..10000 { assert_eq!(std::hint::black_box(actual.call(())), std::hint::black_box(expected())); }
    });
    assert_eq!((calls, bytes), (0, 0));
}
#[test]
fn non_copy_capture_has_only_its_native_callable_frame() {
    let actual_seed = String::from("a");
    let expected_seed = String::from("a");
    let (actual, actual_calls, actual_bytes) = measure(|| capture_cost::index::append(actual_seed));
    let (expected, expected_calls, expected_bytes) = measure(|| handwritten_string(expected_seed));
    assert_eq!((actual_calls, actual_bytes), (expected_calls, expected_bytes));
    assert_eq!(actual_calls, 1);
    assert_eq!(actual.call((String::from("x"),)), expected(String::from("x")));
    assert_eq!(actual.call((String::from("y"),)), expected(String::from("y")));
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["test", "--release", "--locked", "--offline", "--test", "cost"]);
});

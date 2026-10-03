import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject, writeGeneratedProject, runCargo } from "../../helpers/cargo-projects.mjs";
import { genericObjectMethodStorageSource } from "../../../../tsonic/test/fixtures/generic-object-methods.mjs";
import { copiedMethodReceiversSource } from "../../../../tsonic/test/fixtures/copied-method-receivers.mjs";

for (const surface of ["native", "js"]) {
  test(`retained generic methods preserve state, body identity and copied values (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "js" ? ["js"] : [],
      target: { id: "rust", options: { outputType: "bin" } }, files: {
        "index.ts": genericObjectMethodStorageSource + '\nexport function main(): void { if (!run()) throw new Error("retained generic method identity"); }',
      } });
    assert.deepEqual(result.diagnostics.map(({ code, message }) => ({ code, message })), []);
    const generated = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    assert.match(generated, /fn call<[^>]+>/u);
    assert.doesNotMatch(generated, /dyn Any|TypeId|Box<dyn Fn|DynamicInvoke/u);
    validateGeneratedProject(`retained-generic-methods-${surface}`, result.artifacts, { run: true });
  });
}

for (const surfaces of [[], ["js"]]) {
  test(`copied generic methods use the current exact native receiver (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      "index.ts": `${copiedMethodReceiversSource}
        export function main(): void { if (!run()) throw new Error("copied native receiver"); }`,
    } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
    validateGeneratedProject(`copied-native-receiver-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}

test("copied receiver-dependent generic methods reject an incompatible destination receiver", () => {
  const { result } = compileRust({ files: { "index.ts": `
    const original = { count: 3, identity<T>(value: T): T { this.count++; return value; } };
    const { count, ...copied } = original;
    export function run(): number { return copied.identity(7); }
  ` } });
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_COPIED_METHOD_RECEIVER_NOT_PROVEN"));
  assert.deepEqual(result.artifacts, []);
});

test("retained generic method reads and invocation add no per-operation allocation", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: [],
    target: { id: "rust", options: { outputType: "lib", crateName: "retained_methods" } },
    files: { "index.ts": genericObjectMethodStorageSource },
  });
  assert.deepEqual(result.diagnostics.map(({ code, message }) => ({ code, message })), []);
  const root = writeGeneratedProject("retained-generic-method-cost", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/cost.rs"), `use std::alloc::{GlobalAlloc, Layout, System};
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
fn measure(count: f64) -> (usize, usize) {
    CALLS.set(0); BYTES.set(0); ACTIVE.set(true);
    let result = std::hint::black_box(retained_methods::index::retainedReads(std::hint::black_box(count))).unwrap();
    ACTIVE.set(false);
    assert_eq!(result, count - 1.0);
    (CALLS.get(), BYTES.get())
}
#[test]
fn reads_reuse_the_original_environment() {
    let first = measure(1.0);
    assert_eq!(measure(10000.0), first);
    assert!(first.0 > 0);
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["test", "--release", "--locked", "--offline", "--test", "cost"]);
});

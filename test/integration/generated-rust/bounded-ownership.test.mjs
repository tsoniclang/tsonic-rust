import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactText, compileRust, analyzeRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

function compile(source, options = {}) {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", ...options } }, files: { "index.ts": source } });
  assert.deepEqual(result.diagnostics, []);
  return { result, output: artifactText(result, "src/index.rs") };
}

function functionSection(output, name, next) {
  const start = output.indexOf(`fn ${name}(`);
  const end = output.indexOf(`fn ${next}(`, start + 1);
  assert.ok(start >= 0 && end > start, `missing ordered functions ${name}, ${next}`);
  return output.slice(start, end);
}

test("terminal closure captures move owned strings without changing repeated or nested calls", { timeout: 300_000 }, () => {
  const { result, output } = compile(`
function lengthReader(value: string): () => number { return () => value.length + value.length; }
function stringReader(value: string): () => string { return () => value; }
function nested(value: string): () => () => number { return () => () => value.length; }
function shared(value: string): () => number { const first = () => value.length; return () => first() + value.length; }
function mutable(value: string): () => string { return () => { value += "!"; return value; }; }
let observed = "";
function finalized(value: string): () => number { try { return () => value.length; } finally { observed = value; } }
export function main(): void {
  const length = lengthReader("café");
  const text = stringReader("unchanged");
  const factory = nested("abc");
  const first = factory();
  const second = factory();
  const change = mutable("x");
  const cleanup = finalized("keep");
  if (length() !== 10 || length() !== 10 || text() !== "unchanged" || text() !== "unchanged" ||
    first() !== 3 || second() !== 3 || shared("ab")() !== 4 ||
    change() !== "x!" || change() !== "x!!" || cleanup() !== 4 || observed !== "keep") throw new Error("capture transfer");
}
`);
  const direct = functionSection(output, "length_reader", "nested");
  assert.doesNotMatch(direct, /let capture_value = value\.clone\(\)/u);
  assert.match(direct, /let capture_value = value;/u);
  assert.match(direct, /capture_value\.clone\(\)/u);
  assert.match(output, /let capture_value(?:_\d+)? = value\.clone\(\)/u);
  validateGeneratedProject("terminal-capture-ownership", result.artifacts, { run: true });
});

test("local array borrows end before mutation and preserve owned values across effects", { timeout: 300_000 }, () => {
  const { result, output } = compile(String.raw`
import type { int32 } from "@tsonic/core/types.js";
function sum(contents: string): number {
  const lines = contents.split("\n");
  let total = 0;
  for (let index: int32 = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.length === 0) continue;
    const fields = line.split(",");
    total += parseInt(fields[1], 10);
  }
  return total;
}
function release(values: string[]): number {
  const field = values[0];
  if (field === "") return 0;
  const amount = parseInt(field, 10);
  values[0] = "99";
  return amount;
}
function mutate(values: string[]): number { values[0] = "70"; return 10; }
function retain(values: string[]): string { const saved = values[0]; mutate(values); return saved; }
function effect(values: string[]): number { return parseInt(values[0], mutate(values)); }
function advance(values: string[], index: int32): int32 { values[0] = "after"; return index + 1; }
function stepLoop(values: string[]): void {
  for (let index: int32 = 0; index < 1; index = advance(values, index)) {
    const field = values[0];
    if (field.length !== 0) continue;
  }
}
export function main(): void {
  const values = ["17"];
  const alias = values;
  if (sum("a,7\n\nb,11") !== 18 || release(values) !== 17 || alias[0] !== "99") throw new Error("borrow scope");
  values[0] = "23";
  if (retain(alias) !== "23") throw new Error("retained read changed");
  values[0] = "31";
  if (effect(values) !== 31) throw new Error("argument order");
  stepLoop(values);
  if (values[0] !== "after") throw new Error("continue increment");
}
`);
  const sum = functionSection(output, "sum", "release");
  assert.match(sum, /borrow_number_element/u);
  assert.doesNotMatch(sum, /get_number|line\.clone\(\)/u);
  assert.match(sum, /core::mem::drop\(line\)/u);
  const release = functionSection(output, "release", "mutate");
  assert.match(release, /core::mem::drop\(field\)/u);
  const effect = functionSection(output, "effect", "advance");
  assert.doesNotMatch(effect, /borrow_number_element/u);
  const loop = functionSection(output, "step_loop", "main");
  assert.doesNotMatch(loop, /borrow_number_element/u);
  validateGeneratedProject("scoped-element-ownership", result.artifacts, { run: true });
});

test("shared reference loads normalize without weakening mutable reference semantics", { timeout: 300_000 }, () => {
  const { result, output } = compile(`
import { ref, mut, load, store } from "@tsonic/rust/lang.js";
import type { Ref, Mut } from "@tsonic/rust/types.js";
function size(value: Ref<string>): number { return load(value).length; }
function change(value: Mut<string>): void { store(value, "changed"); }
export function main(): void {
  let value = "café";
  if (size(ref(value)) !== 5) throw new Error("shared load");
  change(mut(value));
  if (size(ref(value)) !== 7) throw new Error("mutable load");
}
`);
  assert.match(output, /js_len\(value\)/u);
  assert.doesNotMatch(output, /js_len\(&\*value\)/u);
  assert.match(output, /fn change\(value: &mut String\)/u);
  assert.match(output, /change\(&mut value\)/u);
  assert.doesNotMatch(output, /&mut value\.clone\(\)/u);
  validateGeneratedProject("reference-load-normalization", result.artifacts, { run: true });
});

test("field indices keep local cursor value storage while real escaping receivers stay shared", { timeout: 300_000 }, () => {
  const source = `
import type { int32 } from "@tsonic/core/types.js";
class Cursor {
  index: int32 = 0;
  values: string[];
  constructor(values: string[]) { this.values = values; }
  next(): string { const value = this.values[this.index]; this.index++; return value; }
}
class RetainedCursor {
  index: int32 = 0;
  retain(): RetainedCursor { return this; }
}
export function main(): void {
  const cursor = new Cursor(["a", "b"]);
  if (cursor.next() !== "a" || cursor.next() !== "b" || cursor.index !== 2) throw new Error("cursor storage");
  const retained = new RetainedCursor();
  const alias = retained.retain();
  alias.index++;
  if (retained.index !== 1) throw new Error("escaping receiver identity");
}
`;
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": source } });
  assert.equal(program.objectRepresentations.representations.find(value => value.definition.sourceName === "Cursor")?.kind, "value");
  assert.notEqual(program.objectRepresentations.representations.find(value => value.definition.sourceName === "RetainedCursor")?.kind, "value");
  const { result, output } = compile(source);
  assert.doesNotMatch(output, /ObjectHandle<Cursor|ObjectIdentity<Cursor/u);
  assert.match(output, /ObjectHandle<RetainedCursor/u);
  validateGeneratedProject("indexed-cursor-value", result.artifacts, { run: true });
});

test("generated terminal captures and readonly array reads match native allocation costs", { timeout: 300_000 }, () => {
  const { result } = compile(`
export function retainLength(value: string): () => number { return () => value.length; }
export function fieldValue(values: string[]): number { const field = values[0]; return parseInt(field, 10); }
`, { outputType: "lib", crateName: "bounded_allocations" });
  const root = writeGeneratedProject("bounded-native-allocations", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/allocations.rs"), `use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use bounded_allocations::index;
use tsonic_rust_js::JsArray;
use tsonic_rust_runtime::Callable;
struct Counting;
std::thread_local! {
    static ACTIVE: Cell<bool> = const { Cell::new(false) };
    static BYTES: Cell<usize> = const { Cell::new(0) };
    static CALLS: Cell<usize> = const { Cell::new(0) };
}
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if ACTIVE.get() { BYTES.set(BYTES.get() + layout.size()); CALLS.set(CALLS.get() + 1); }
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) { unsafe { System.dealloc(pointer, layout) } }
}
#[global_allocator]
static ALLOCATOR: Counting = Counting;
fn measure<Value>(operation: impl FnOnce() -> Value) -> (usize, usize) {
    BYTES.set(0);
    CALLS.set(0);
    ACTIVE.set(true);
    let result = std::hint::black_box(operation());
    ACTIVE.set(false);
    drop(result);
    (CALLS.get(), BYTES.get())
}
#[test]
fn allocation_parity() {
    let actual_text = "x".repeat(65536);
    let native_text = "x".repeat(65536);
    let actual = measure(|| index::retain_length(actual_text));
    let native = measure(|| Callable::<(), usize>::new(move |()| native_text.len()));
    assert_eq!(actual, native);
    assert_eq!(actual.0, 1);
    let values = JsArray::from_dense(vec![String::from("123456")]);
    let reads = measure(|| { for _iteration in 0..10000 { let _value = std::hint::black_box(index::field_value(values.clone())); } });
    assert_eq!(reads, (0, 0));
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["test", "--release", "--locked", "--offline", "--test", "allocations"]);
});

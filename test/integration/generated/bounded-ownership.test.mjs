import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { nativeAllocationSupport } from "../../helpers/native-ownership-cost.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactText, compileRust, analyzeRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

function compile(source, options = {}) {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", ...options } },
    files: { "index.ts": source + (options.outputType === "lib" ? "" : "\nmain();\n") } });
  assertNoTargetDiagnostics(result.diagnostics);
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
main();
`);
  const direct = functionSection(output, "lengthReader", "nested");
  assert.doesNotMatch(direct, /let capture_value = value\.clone\(\)/u);
  assert.match(direct, /let capture_value = value;/u);
  assert.match(direct, /capture_value\.clone\(\)/u);
  assert.match(output, /let capture_value(?:_\d+)? = value\.clone\(\)/u);
  const mutable = functionSection(output, "mutable", "finalized");
  assert.match(mutable, /RefCell::new\(value\)/u);
  assert.match(mutable, /\.borrow_mut\(\)/u);
  assert.doesNotMatch(mutable, /\.load\(\)|\.store\(|rt::Location/u);
  validateGeneratedProject("terminal-capture-ownership", result.artifacts, { run: true });
});

test("local array borrows end before mutation and preserve owned values across effects", { timeout: 300_000 }, () => {
const { result, output } = compile(String.raw`
import type { int32, nativeUint } from "@tsonic/core/types.js";
function sum(contents: string): number {
  const lines = contents.split("\n");
  let total = 0;
  for (let index: nativeUint = 0; index < lines.length; index++) {
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
function effectfulPair(values: string[]): number {
  const first = values[0];
  const second = values[advance(values, 0)];
  return first.length + second.length;
}
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
  if (effectfulPair(["before", "other"]) !== 11) throw new Error("borrow index mutation");
}
`);
  const sum = functionSection(output, "sum", "release");
  assert.match(sum, /borrow_number_element/u);
  assert.doesNotMatch(sum, /get_number|line\.clone\(\)/u);
  assert.match(sum, /core::mem::drop\(line\)/u);
  const release = functionSection(output, "release", "mutate");
  assert.match(release, /core::mem::drop\(field\)/u);
  assert.match(release, /number_parse_int_radix\(core::convert::AsRef::<str>::as_ref\(&\*field\),/u);
  assert.doesNotMatch(release, /number_parse_int_radix\(&\*field,/u);
  assert.doesNotMatch(release, /field\.clone\(\)|field\.as_str\(\)/u);
  const effect = functionSection(output, "effect", "advance");
  assert.doesNotMatch(effect, /borrow_number_element/u);
  const loop = functionSection(output, "stepLoop", "main");
  assert.doesNotMatch(loop, /borrow_number_element/u);
  const pair = functionSection(output, "effectfulPair", "stepLoop");
  assert.match(pair, /get_number\(/u);
  assert.match(pair, /borrow_number_element/u);
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
main();
`);
  assert.match(output, /fn size\(value: &str\)/u);
  assert.match(output, /js_len\(core::convert::AsRef::<str>::as_ref\(value\)\)/u);
  assert.doesNotMatch(output, /js_len\(&\*value\)/u);
  assert.doesNotMatch(functionSection(output, "size", "change"), /clone\(|String::from|to_owned\(/u);
  assert.match(output, /fn change\(value: &mut String\)/u);
  assert.match(output, /change\(&mut value\)/u);
  assert.doesNotMatch(output, /&mut value\.clone\(\)/u);
  validateGeneratedProject("reference-load-normalization", result.artifacts, { run: true });
});

test("native reference stores evaluate target then value once and observe the old load before RHS mutation", { timeout: 300_000 }, () => {
  const { result, output } = compile(`
import type { int32 } from "@tsonic/core/types.js";
import type { Mut } from "@tsonic/rust/types.js";
import { load, mut, store } from "@tsonic/rust/lang.js";
let events: int32 = 0;
let targetCalls: int32 = 0;
let valueCalls: int32 = 0;
function target(value: Mut<int32>): Mut<int32> {
  events = events * 10 + 1;
  targetCalls++;
  return value;
}
function next(): int32 {
  events = events * 10 + 2;
  valueCalls++;
  return 7;
}
function mutate(value: Mut<int32>): int32 {
  events = events * 10 + 3;
  store(value, 9);
  return 3;
}
function update(value: Mut<int32>): void { store(value, load(value) + mutate(value)); }
function wrapped(value: Mut<int32>): void { store(((value)), load(((value))) + mutate(value)); }
function plain(value: Mut<int32>): void { store(value, load(value) + 1); }
function observed(value: int32): int32 { return value; }
export function main(): void {
  let first: int32 = 5;
  store(target(mut(first)), next());
  if (first !== 7 || events !== 12 || targetCalls !== 1 || valueCalls !== 1) throw new Error("native store argument order");
  events = 0;
  let second: int32 = 5;
  update(mut(second));
  if (second !== 8 || events !== 3) throw new Error("native store old load");
  events = 0;
  let third: int32 = 5;
  wrapped(mut(third));
  if (third !== 8 || events !== 3) throw new Error("wrapped native store old load");
  plain(mut(third));
  if (observed(third) !== 9) throw new Error("pure native compound store");
}
`);
  const update = functionSection(output, "update", "wrapped");
  const wrapped = functionSection(output, "wrapped", "plain");
  for (const [label, section] of [["direct", update], ["wrapped", wrapped]]) {
    assert.doesNotMatch(section, /\+=/u, `${label}: effectful RHS never becomes a RHS-first native compound assignment`);
    assert.match(section, /let reference_store_value(?:_\d+)? =/u, `${label}: the original full value is evaluated before the store`);
    assert.match(section, /mutate\(/u, `${label}: the original mutation is retained`);
    assert.doesNotMatch(section, /clone\(|String::from|Box::|Rc::|Arc::/u, `${label}: ordering uses only native stack storage`);
  }
  assert.match(output, /let reference_store_target(?:_\d+)? = target\(/u, "the effectful target is stabilized exactly once before its value");
  assert.match(output, /let reference_store_value(?:_\d+)? = next\(/u, "the second argument is evaluated separately after the target");
  validateGeneratedProject("reference-store-native-order", result.artifacts, { run: true });
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
export function directFieldValue(values: string[]): number { return parseInt(values[0], 10); }
export function pairLengths(values: readonly string[]): number {
  const first = values[0];
  const second = values[1];
  return first.length + second.length;
}
export function nestedLengths(values: readonly string[]): number {
  const first = values[0];
  let result = 0;
  {
    const second = values[1];
    result = first.length + second.length;
  }
  return result;
}
export class Counter { count: number = 7; }
export function counter(): Counter { return new Counter(); }
export function counterView(value: Counter): { count: number } { return value; }
export function quantifiedIdentity(value: number): number {
  const identity = <Value>(input: Value): Value => input;
  return identity(value);
}
abstract class ProjectionBase {
  abstract readonly token: object;
  abstract equal(other: ProjectionBase): boolean;
}
function projectionFactory<Value>(token: object, same: (left: Value, right: Value) => boolean): new(value: Value) => ProjectionBase {
  class Selected extends ProjectionBase {
    readonly token = token;
    value: Value;
    constructor(value: Value) { super(); this.value = value; }
    static accepts(value: ProjectionBase): value is Selected { return value.token === token; }
    equal(other: ProjectionBase): boolean { return Selected.accepts(other) && same(this.value, other.value); }
  }
  return Selected;
}
export function projectionCount(count: number): number {
  const selected = projectionFactory<number>(Object.freeze({}), (left, right) => left === right);
  const instance = new selected(7);
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (!instance.equal(instance)) throw new Error("projection identity");
    total++;
  }
  return total;
}
`, { outputType: "lib", crateName: "bounded_allocations" });
  const root = writeGeneratedProject("bounded-native-allocations", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/allocations.rs"), `${nativeAllocationSupport(root)}
use bounded_allocations::index;
use tsonic_rust_js::JsArray;
use std::rc::Rc;

#[test]
fn allocation_parity() {
    let actual_text = "x".repeat(65536);
    let native_text = "x".repeat(65536);
    let actual = allocation_counts::measure_requests(|| index::retainLength(actual_text));
    let native = allocation_counts::measure_requests(|| { let callback: Rc<dyn Fn() -> usize> = Rc::new(move || native_text.len()); callback });
    assert_eq!(actual, native);
    assert_eq!(actual.0, 1);
    let values = JsArray::from_dense(vec![String::from("123456")]);
    let reads = allocation_counts::measure_requests(|| { for _iteration in 0..10000 { let _value = std::hint::black_box(index::fieldValue(values.clone())); } });
    assert_eq!(reads, (0, 0));
    let direct_reads = allocation_counts::measure_requests(|| {
        for _iteration in 0..10000 {
            assert_eq!(std::hint::black_box(index::directFieldValue(values.clone())), 123456.0);
        }
    });
    let native_reads = allocation_counts::measure_requests(|| {
        for _iteration in 0..10000 {
            let field = values.borrow_number_element(0.0).unwrap();
            assert_eq!(std::hint::black_box(tsonic_rust_js::abi::number_parse_int_radix(&field, 10.0)), 123456.0);
        }
    });
    assert_eq!(direct_reads, native_reads);
    assert_eq!(direct_reads, (0, 0));
    let pair = JsArray::from_dense(vec!["x".repeat(65536), "y".repeat(65536)]);
    let paired_reads = allocation_counts::measure_requests(|| {
        for _iteration in 0..10000 {
            assert_eq!(std::hint::black_box(index::pairLengths(pair.clone())), 131072.0);
            assert_eq!(std::hint::black_box(index::nestedLengths(pair.clone())), 131072.0);
        }
    });
    assert_eq!(paired_reads, (0, 0));
    let counter = index::counter();
    let views = allocation_counts::measure_requests(|| {
        for _iteration in 0..10000 {
            std::hint::black_box(index::counterView(counter.clone()));
        }
    });
    assert_eq!(views, (0, 0));
    let quantified = allocation_counts::measure_requests(|| {
        for iteration in 0..10000 {
            assert_eq!(std::hint::black_box(index::quantifiedIdentity(iteration as f64)), iteration as f64);
        }
    });
    assert_eq!(quantified, (0, 0));
    index::projectionCount(0.0).expect("projection initialization");
    let one_projection = allocation_counts::measure_requests(|| assert_eq!(index::projectionCount(1.0).unwrap(), 1.0));
    let many_projections = allocation_counts::measure_requests(|| assert_eq!(index::projectionCount(10000.0).unwrap(), 10000.0));
    assert_eq!(many_projections, one_projection);
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["test", "--release", "--locked", "--offline", "--test", "allocations"]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeTestingPackage,
  acmeVectorsPackage,
  artifactText,
  assertRustTargetRejection,
  compileRust,
  createRustSession,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

const counterSource = `
import type { int32 } from "@tsonic/core/types.js";

export class Counter {
  value: int32;

  constructor(value: int32) {
    this.value = value;
  }

  add(delta: int32): int32 {
    this.value += delta;
    return this.value;
  }

  current(): int32 {
    return this.value;
  }
}

export function drive(): int32 {
  const counter = new Counter(10);
  counter.add(5);
  return counter.current() + counter.value;
}
`;

test("classes lower to reference-backed object wrappers with fact-backed members", () => {
  const { result } = compileRust({ files: { "index.ts": counterSource } });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /#\[derive\(Clone, Debug, PartialEq\)\]\npub struct Counter \{\n    pub\(crate\) __tsonic_state: rt::ObjectHandle<\(i32,\)>,\n\}/u);
  assert.doesNotMatch(text, /derive\([^\n]*Copy/u);
  assert.match(text, /impl Counter \{/u);
  assert.match(text, /let mut __tsonic_field_value: i32;\n        __tsonic_field_value = value;/u);
  assert.match(text, /__tsonic_state: rt::ObjectHandle::new\(\(__tsonic_field_value,\)\)/u);
  assert.match(text, /pub fn add\(&self, delta: i32\) -> i32 \{/u);
  assert.match(text, /\.with_mut\(\|state\| state\.0 \+= __tsonic_value(?:_[0-9]+)?\)/u);
  assert.match(text, /pub fn current\(&self\) -> i32 \{/u);
  assert.match(text, /let counter = Counter::new\(10\);/u);
  assert.match(text, /counter\.clone\(\)\.add\(5\);/u);
  assert.match(text, /counter\.clone\(\)\.current\(\)/u);
});

test("class accessors preserve exact read write and update semantics", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "class_accessor_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

let receiverCalls: int32 = 0;

class Value {
  private stored: int32;
  private reads: int32 = 0;
  private writes: int32 = 0;

  constructor(initial: int32) {
    this.stored = initial;
  }

  get current(): int32 {
    this.reads += 1;
    return this.stored;
  }

  set current(value: int32) {
    this.writes += 1;
    this.stored = value;
  }

  storedValue(): int32 {
    return this.stored;
  }

  readCount(): int32 {
    return this.reads;
  }

  writeCount(): int32 {
    return this.writes;
  }
}

const singleton = new Value(1);

function selected(): Value {
  receiverCalls += 1;
  return singleton;
}

export function main(): void {
  check(selected().current === 1);
  selected().current = 2;
  selected().current += 3;
  const previous = selected().current++;
  const current = ++selected().current;
  check(previous === 5);
  check(current === 7);
  check(receiverCalls === 5);
  check(singleton.storedValue() === 7);
  check(singleton.readCount() === 4);
  check(singleton.writeCount() === 4);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /fn __tsonic_read_[0-9]+_[0-9]+\(&self\) -> i32/u);
  assert.match(text, /fn __tsonic_write_[0-9]+_[0-9]+\(&self, value: i32\)/u);
  const run = validateGeneratedProject("class-accessor-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("fallible accessors propagate through exact getter and setter effects", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export class Value {
  get current(): int32 { throw new Error("read failed"); }
  set current(_value: int32) { throw new Error("write failed"); }
}

export function read(value: Value): int32 {
  return value.current;
}

export function write(value: Value, next: int32): void {
  value.current = next;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /fn __tsonic_read_[0-9]+_[0-9]+\(&self\) -> rt::TsonicResult<i32>/u);
  assert.match(text, /fn __tsonic_write_[0-9]+_[0-9]+\(&self, _value: i32\) -> rt::TsonicResult<\(\)>/u);
  assert.match(text, /pub fn read\(value: Value\) -> rt::TsonicResult<i32>[\s\S]*__tsonic_read_[0-9]+_[0-9]+\(\)/u);
  assert.match(text, /__tsonic_write_[0-9]+_[0-9]+\(__tsonic_accessor_value(?:_[0-9]+)?\)\?/u);
  validateGeneratedProject("class-accessor-fallibility", result.artifacts);
});

test("implicit constructors and class field initializers lower deterministically", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export class Initialized {
  value: int32 = 42;
}

export class Empty {}

export function create(): Initialized {
  const empty = new Empty();
  return new Initialized();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /impl Initialized \{\n    #\[allow\(clippy::new_without_default\)\]\n    pub fn new\(\) -> Initialized/u);
  assert.match(text, /let mut __tsonic_field_value: i32;\n        __tsonic_field_value = 42;/u);
  assert.match(text, /impl Empty \{\n    #\[allow\(clippy::new_without_default\)\]\n    pub fn new\(\) -> Empty/u);
});

test("class field and constructor assignment effects retain TypeScript order", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "constructor_order_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

let sequence: int32 = 0;

function mark(value: int32): int32 {
  sequence = sequence * 10 + value;
  return value;
}

class Ordered {
  first: int32 = mark(3);
  second: int32;

  constructor() {
    this.second = mark(2);
    this.first = mark(1);
  }
}

class Implicit {
  value: int32 = mark(4);
}

export function main(): void {
  const ordered = new Ordered();
  check(sequence === 321);
  check(ordered.first === 1);
  check(ordered.second === 2);
  const implicit = new Implicit();
  check(sequence === 3214);
  check(implicit.value === 4);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("constructor-order-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("class field initializers read already-initialized fields from exact selected evidence", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export class Initialized {
  first: int32 = 1;
  second: int32 = this.first;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /let mut __tsonic_field_second(?:_[0-9]+)?: i32;/u);
  assert.match(
    text,
    /__tsonic_field_second(?:_[0-9]+)? = __tsonic_field_first(?:_[0-9]+)?;/u,
  );
});

test("enums lower with TSTS integer discriminants and fact-backed equality", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export enum Color {
  Red,
  Green = 5,
  Blue,
}

export function pick(flag: boolean): Color {
  if (flag) {
    return Color.Green;
  }
  return Color.Blue;
}

export function isGreen(color: Color): boolean {
  return color === Color.Green;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /#\[derive\(Clone, Copy, Debug, PartialEq\)\]\npub enum Color \{\n    Red = 0,\n    Green = 5,\n    Blue = 6,\n\}/u);
  assert.match(text, /Color::Green/u);
  assert.match(text, /color == Color::Green/u);
});

test("generic virtual methods fail closed at the Rust object-safety boundary", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export class Base {
  constructor() {}

  identity<T>(value: T): T {
    return value;
  }
}

export class Derived extends Base {
  constructor() {
    super();
  }
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === "RUST_UNSUPPORTED_AST" &&
    diagnostic.message.includes("object-safe non-generic synchronous Rust ABI")));
});

test("generated cargo binary proves class and enum lowering at runtime", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "r4_native_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";
import { Counter } from "./counter.js";

export enum Mode {
  Off,
  On = 3,
}

export function pick_mode(flag: boolean): Mode {
  if (flag) {
    return Mode.On;
  }
  return Mode.Off;
}

export function main(): void {
  const counter = new Counter(10);
  const alias = counter;
  check(alias === counter);
  check(alias.add(5) === 15);
  check(counter.current() === 15);
  check(counter.value === 15);
  const sameValue = new Counter(15);
  check(sameValue !== counter);
  const mode = pick_mode(true);
  check(mode === Mode.On);
  check(mode !== Mode.Off);
}
`,
      "counter.ts": `
import type { int32 } from "@tsonic/core/types.js";

export class Counter {
  value: int32;

  constructor(value: int32) {
    this.value = value;
  }

  add(delta: int32): int32 {
    this.value += delta;
    return this.value;
  }

  current(): int32 {
    return this.value;
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("native-semantics-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("flow markers erase into finalized argument modes", () => {
  const { result } = compileRust({
    packages: [acmeVectorsPackage()],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { borrow, move } from "@tsonic/rust/lang.js";
import { Vector, magnitude, consume } from "@acme/vectors";

export function drive(): int32 {
  const v = new Vector(3, 4);
  const m = magnitude(borrow(v));
  return m + consume(move(v));
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /acme_vectors::magnitude\(&v\)/u);
  assert.match(text, /acme_vectors::consume\(v\)/u);
});

test("flow markers mismatching argument modes fail closed", () => {
  assertRustTargetRejection({
    packages: [acmeVectorsPackage()],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { borrow } from "@tsonic/rust/lang.js";
import { Vector, consume } from "@acme/vectors";

export function bad(): int32 {
  const v = new Vector(1, 2);
  return consume(borrow(v));
}
`,
    },
  }, [{
    code: "RUST_FLOW_MARKER_MISMATCH",
    message: "Flow marker state 'borrowed-shared' does not match the finalized argument mode 'value' for this position.",
  }]);
});

test("byref passing markers are rejected deterministically", () => {
  const options = {
    packages: [acmeVectorsPackage()],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { readWriteRef } from "@tsonic/core/lang.js";
import { Vector, consume } from "@acme/vectors";

export function bad(): int32 {
  const v = new Vector(1, 2);
  return consume(readWriteRef(v));
}
`,
    },
  };
  assertRustTargetRejection(options, [{
    code: "RUST_SOURCE_MARKER_UNSUPPORTED",
    message: "Rust does not support selected source marker 'read-write-reference' in this operation lane.",
  }]);
});

test("JS array parameters preserve shared identity with visible writes", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function bump(xs: int32[]): void {
  xs[0] = 42;
}

export function drive(): int32 {
  const values: int32[] = [1, 2, 3];
  bump(values);
  return values.length;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn bump\(xs: js_abi::JsArray<i32>\)/u);
  assert.match(text, /xs\.set_number\(0\.0, 42\);/u);
  assert.match(text, /bump\(values\.clone\(\)\);/u);
});

test("native array parameters preserve caller storage through exact slice ABIs", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_array_parameter_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

function bump(values: int32[]): void {
  values[0] = values[0] + 1;
}

function first(values: readonly int32[]): int32 {
  return values[0];
}

export function main(): void {
  const values: int32[] = [1, 2, 3];
  bump(values);
  check(first(values) === 2);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /fn bump\(values: &mut \[i32\]\)/u);
  assert.match(text, /fn first\(values: &\[i32\]\)/u);
  assert.match(text, /let mut values: Vec<i32> = vec!\[1, 2, 3\];/u);
  assert.match(text, /bump\(&mut values\)\?;/u);
  assert.match(text, /first\(&values\)\?/u);
  const run = validateGeneratedProject("native-array-parameter-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("native arrays moved into project objects retain owned Vec storage", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_array_constructor_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { move } from "@tsonic/rust/lang.js";
import { check } from "@acme/testing";

class Holder {
  items: int32[];

  constructor(items: int32[]) {
    this.items = move(items);
  }
}

export function main(): void {
  const holder = new Holder([30, 40]);
  check(holder.items[1] === 40);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /fn new\(items: Vec<i32>\)/u);
  assert.match(text, /Holder::new\(vec!\[30, 40\]\)/u);
  const run = validateGeneratedProject("native-array-constructor-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("push mutates the canonical shared JS array carrier", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function grow(xs: int32[]): void {
  xs.push(4);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn grow\(xs: js_abi::JsArray<i32>\)/u);
  assert.match(text, /xs\s*\.push_many\(\[4\]\)/u);
  assert.doesNotMatch(text, /f64_to_i32/u);
});

test("user-authored identifiers are preserved verbatim with scoped allowances", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function pickMode(flagValue: boolean): int32 {
  let chosenValue: int32 = 0;
  if (flagValue) {
    chosenValue = 3;
  }
  return chosenValue;
}

export function caller(): int32 {
  return pickMode(true);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  // Every user-authored identifier is verbatim; the item carries a scoped
  // lint allowance because non-snake names appear in it.
  assert.match(text, /#\[allow\(non_snake_case\)\]\npub fn pickMode\(flagValue: bool\) -> i32/u);
  assert.match(text, /let mut chosenValue: i32 = 0;/u);
  assert.match(text, /pickMode\(true\)/u);
});

test("verbatim naming keeps distinct authored identifiers distinct", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function collide(): int32 {
  let fooBar: int32 = 1;
  let foo_bar: int32 = 2;
  return fooBar + foo_bar;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /let fooBar: i32 = 1;/u);
  assert.match(text, /let foo_bar: i32 = 2;/u);
});

test("Rust keyword-shaped source identifiers use exact raw identifiers", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export class Label {
  type: string;

  constructor(type: string) {
    this.type = type;
  }
}

export function read(type: string): string {
  const label = new Label(type);
  return label.type;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /fn new\(r#type: String\)/u);
  assert.match(text, /pub fn read\(r#type: String\) -> String/u);
  assert.match(text, /Label::new\(r#type\)/u);
  validateGeneratedProject("native-raw-identifiers", result.artifacts);
});

test("class decorators fail closed", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

function tag(target: unknown): void {}

@tag
export class Marked {
  value: int32;

  constructor(value: int32) {
    this.value = value;
  }
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.length > 0);
});

test("null-only unions lower to Option with coalesce and Some/None lanes", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function value_or_zero(value: int32 | null): int32 {
  return value ?? 0;
}

export function some_value(): int32 {
  return value_or_zero(5) + value_or_zero(null);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn value_or_zero\(value: Option<i32>\) -> i32 \{/u);
  assert.match(text, /rt::option_coalesce\(value, std::convert::identity, \|\| 0\)/u);
  assert.match(text, /value_or_zero\(Some\(5\)\)/u);
  assert.match(text, /value_or_zero\(Option::<i32>::None\)/u);
});

test("nullish coalescing preserves lazy value and optional fallback evaluation", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "nullish_lazy_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

let fallbackCalls: int32 = 0;

function fallback(): int32 {
  fallbackCalls += 1;
  return 7;
}

function optionalFallback(): int32 | undefined {
  fallbackCalls += 1;
  return undefined;
}

function choose(left: int32 | undefined, right: int32 | undefined): int32 | undefined {
  return left ?? right;
}

function withFallback(left: int32 | undefined): int32 {
  return left ?? fallback();
}

function withOptionalFallback(left: int32 | undefined): int32 | undefined {
  return left ?? optionalFallback();
}

export function main(): void {
  check(withFallback(3) === 3);
  check(fallbackCalls === 0);
  check(withFallback(undefined) === 7);
  check(fallbackCalls === 1);
  check(choose(4, undefined) === 4);
  check(fallbackCalls === 1);
  check(withOptionalFallback(4) === 4);
  check(fallbackCalls === 1);
  check(withOptionalFallback(undefined) === undefined);
  check(fallbackCalls === 2);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /rt::option_coalesce\(left, Some, \|\| right\)/u);
  assert.equal(validateGeneratedProject("nullish-lazy-proof", result.artifacts, { run: true }).status, 0);
});

test("undefined-typed unions lower to Option in the native profile", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function value_or_zero(value: int32 | undefined): int32 {
  return value ?? 0;
}

export function some_value(): int32 {
  return value_or_zero(5) + value_or_zero(undefined);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn value_or_zero\(value: Option<i32>\) -> i32/u);
  assert.match(text, /value_or_zero\(Some\(5\)\)/u);
  assert.match(text, /value_or_zero\(Option::<i32>::None\)/u);
});

test("interfaces lower to reference-backed object wrappers with annotated object literals", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export interface Point {
  x: int32;
  y: int32;
}

export function origin(): Point {
  const p: Point = { x: 0, y: 0 };
  return p;
}

export function shift(p: Point, dx: int32): Point {
  return { x: p.x + dx, y: p.y };
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /#\[derive\(Clone, Debug, PartialEq\)\]\npub struct Point \{\n    pub\(crate\) __tsonic_state: rt::ObjectHandle<\(i32, i32\)>,\n\}/u);
  assert.doesNotMatch(text, /derive\([^\n]*Copy/u);
  assert.match(text, /__tsonic_state: rt::ObjectHandle::new\(\(0, 0\)\)/u);
  assert.match(text, /__tsonic_state: rt::ObjectHandle::new\(\(/u);
  assert.match(text, /p\.clone\(\)\.__tsonic_state\.with\(\|state\| state\.0\) \+ dx/u);
});

test("generated interface objects preserve aliases, identity, and single receiver evaluation", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "interface_identity_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

interface Cell {
  value: int32;
}

class Holder {
  item: Cell;
  calls: int32;

  constructor(item: Cell) {
    this.item = item;
    this.calls = 0;
  }

  current(): Cell {
    this.calls += 1;
    return this.item;
  }
}

export function main(): void {
  const cell: Cell = { value: 1 };
  const alias = cell;
  alias.value = 2;
  check(cell.value === 2);
  check(alias === cell);
  const separate: Cell = { value: 2 };
  check(separate !== cell);
  const holder = new Holder(cell);
  holder.current().value += 3;
  check(holder.calls === 1);
  check(cell.value === 5);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("interface-identity-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("unannotated object literals use their exact checked structural shape", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "inferred_object_proof" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

export function main(): void {
  const point = { x: 1, label: "start" };
  const alias = point;
  alias.x += 2;
  alias.label = "done";
  check(point.x === 3);
  check(point.label === "done");
  check(alias === point);
  const separate = { x: 3, label: "done" };
  check(separate !== point);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /rt::ObjectHandle::new\(\(String::from\("start"\), 1\.0\)\)/u);
  const run = validateGeneratedProject("inferred-object-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("tuple types lower to Rust tuples with literal construction and indexing", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function pair(a: int32, label: string): [int32, string] {
  const entry: [int32, string] = [a, label];
  return entry;
}

export function first(entry: [int32, string]): int32 {
  return entry[0];
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn pair\(a: i32, label: String\) -> \(i32, String\)/u);
  assert.match(text, /let entry: \(i32, String\) = \(a, label\);/u);
  assert.match(text, /pub fn first\(entry: \(i32, String\)\) -> i32/u);
  assert.match(text, /entry\.0/u);
});

test("homogeneous tuple carriers support checked dynamic indexing", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "dynamic_tuple_index_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

export function pick(entry: [int32, int32], i: int32): int32 {
  return entry[i];
}

export function main(): void {
  check(pick([10, 20], 1) === 20);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /entry\[tsonic_rust_runtime::conversions::i32_to_usize\(i\)\?\]/u);
  assert.equal(validateGeneratedProject("dynamic-tuple-index", result.artifacts, { run: true }).status, 0);
});

test("closed string-literal unions lower to unit-variant enums", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export type Mode = "off" | "read-only" | "readWrite";

export function pick_mode(flag: boolean): Mode {
  if (flag) {
    return "readWrite";
  }
  return "off";
}

export function is_off(mode: Mode): boolean {
  return mode === "off";
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub enum Mode \{\n    Off,\n    ReadOnly,\n    ReadWrite,\n\}/u);
  assert.match(text, /return Mode::ReadWrite;/u);
  assert.match(text, /mode == Mode::Off/u);
});

test("discriminated object unions lower to native enums and preserve narrowed behavior", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "discriminated_union_proof" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

export type Shape =
  | { kind: "circle"; radius: int32 }
  | { kind: "square"; size: int32 };

export function circle(radius: int32): Shape {
  return { kind: "circle", radius };
}

export function square(size: int32): Shape {
  return { kind: "square", size };
}

export function area(shape: Shape): int32 {
  if (shape.kind === "circle") {
    return shape.radius * 3;
  }
  return shape.size * shape.size;
}

export function grow(shape: Shape): int32 {
  if (shape.kind === "circle") {
    shape.radius += 2;
    const previous = shape.radius++;
    return previous * 10 + shape.radius;
  }
  shape.size = shape.size + 1;
  return ++shape.size;
}

export function main(): void {
  const circleShape = circle(4);
  const squareShape = square(5);
  check(grow(circleShape) === 67);
  check(grow(squareShape) === 7);
  check(area(circleShape) === 21);
  check(area(squareShape) === 49);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub enum Shape/u);
  assert.match(text, /match &shape/u);
  const run = validateGeneratedProject("discriminated-union-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("static class methods lower to associated functions", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export class Counter {
  value: int32;

  constructor(value: int32) {
    this.value = value;
  }

  static zero(): Counter {
    return new Counter(0);
  }
}

export function drive(): int32 {
  const c = Counter.zero();
  return c.value;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn zero\(\) -> Counter \{/u);
  assert.match(text, /Counter::zero\(\)/u);
});

test("passthrough generic functions lower with type parameters", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function pass_through<T>(value: T): T {
  return value;
}

export function drive(): int32 {
  return pass_through(41) + 1;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn pass_through<T>\(value: T\) -> T \{/u);
  assert.match(text, /pass_through\(41\)/u);
});

test("operations on unconstrained type parameters stay invalid TypeScript", () => {
  assert.throws(
    () => compileRust({
      files: {
        "index.ts": `
export function double_it<T>(value: T): T {
  return value + value;
}
`,
      },
    }),
    /TypeScript diagnostics/u,
  );
});

test("async functions lower to async fn with awaited call chains", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export async function fetch_value(seed: int32): Promise<int32> {
  return seed + 1;
}

export async function drive(): Promise<int32> {
  const value = await fetch_value(41);
  return value;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub async fn fetch_value\(seed: i32\) -> i32 \{/u);
  assert.match(text, /fetch_value\(41\)\.await/u);
});

test("future values remain first-class and async binary entries use block_on", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export async function fetch_value(): Promise<int32> {
  return 1;
}

export function bad(): int32 {
  const stored = fetch_value();
  return 0;
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /let stored = fetch_value\(\);/u);

  const asyncMain = compileRust({
    target: { id: "rust", options: { outputType: "bin", crateName: "async_main" } },
    files: {
      "index.ts": `
export async function main(): Promise<void> {}
`,
    },
  });
  assert.deepEqual(asyncMain.result.diagnostics, []);
  assert.match(
    artifactText(asyncMain.result, "src/main.rs"),
    /tsonic_rust_runtime::block_on\(async_main::index::main\(\)\)/u,
  );
});

test("throwing functions lower to TsonicResult with Err returns and Ok wrapping", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function risky(flag: boolean): int32 {
  if (flag) {
    throw new Error("boom");
  }
  return 7;
}

export function caller(flag: boolean): int32 {
  let outcome: int32 = 0;
  try {
    outcome = risky(flag);
  } catch (error) {
    outcome = -1;
  }
  return outcome;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn risky\(flag: bool\) -> rt::TsonicResult<i32> \{/u);
  assert.match(text, /return Err\(rt::TsonicError::from\(rt::JsError::error\(/u);
  assert.match(text, /Ok\(7\)/u);
  assert.match(text, /let __tsonic_try_body: rt::TsonicResult<rt::Completion<i32>> = rt::completion_region\(\|\| \{/u);
  assert.match(text, /outcome = risky\(flag\)\?;/u);
  assert.match(text, /let __tsonic_try_flow_\d+: rt::Completion<i32> = match __tsonic_try_body \{/u);
  assert.match(text, /Err\(_error\) => rt::completion_region\(\|\| \{/u);
  assert.match(text, /use tsonic_rust_runtime as rt;/u);
});

test("fallibility propagates transitively to callers", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function risky(): int32 {
  throw new Error("boom");
}

export function forwards(): int32 {
  return risky();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn forwards\(\) -> rt::TsonicResult<i32> \{/u);
  assert.match(text, /pub fn forwards\(\) -> rt::TsonicResult<i32> \{\n    risky\(\)\n\}/u);
  assert.doesNotMatch(text, /Ok\(risky\(\)\?\)/u);
});

test("fallible calls inside callbacks use the explicit fallible callback ABI", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function risky(x: int32): int32 {
  throw new Error("boom");
}

export function bad(xs: int32[]): boolean {
  return xs.some((x) => risky(x) === 1);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn bad\(xs: js_abi::JsArray<i32>\) -> rt::TsonicResult<bool>/u);
  assert.match(text, /xs\.try_some\(\|x\| Ok\(risky\(x\)\? == 1\)\)/u);
});

test("string literals mentioning runtime aliases do not create imports", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export function describe(): string {
  return "js_abi:: rt:: node_fs:: js_string:: node_path:: node_os:: are just text";
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.ok(!text.includes("use tsonic_rust_js"), "no false js import");
  assert.ok(!text.includes("use tsonic_rust_node"), "no false node import");
  assert.ok(!text.includes("use tsonic_rust_runtime"), "no false runtime import");
});

test("throwing code importing nothing else still gets the runtime alias", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export function fail(): void {
  throw new Error("rt:: is text here, the import comes from the throw");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /use tsonic_rust_runtime as rt;/u);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeTestingPackage,
  acmeVectorsPackage,
  artifactText,
  assertRustTargetRejection,
  compileRust,
  createRustSession,
} from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

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
  assert.match(text, /pub\(crate\) struct CounterState \{\n    pub\(crate\) value: i32,\n\}/u);
  assert.match(text, /#\[derive\(Clone, Debug, PartialEq\)\]\npub struct Counter \{\n    pub\(crate\) state: rt::ObjectHandle<CounterState>,\n\}/u);
  assert.doesNotMatch(text, /derive\([^\n]*Copy/u);
  assert.match(text, /impl Counter \{/u);
  assert.match(text, /let field_value: i32 = value;/u);
  assert.match(text, /state: rt::ObjectHandle::new\(CounterState \{ value: field_value \}\)/u);
  assert.match(text, /pub fn add\(&self, delta: i32\) -> i32 \{/u);
  assert.match(text, /\.with_mut\(\|state\| state\.value \+= value_2\)/u);
  assert.match(text, /pub fn current\(&self\) -> i32 \{/u);
  assert.match(text, /let counter: Counter = Counter::new\(10\);/u);
  assert.match(text, /counter\.add\(5\);/u);
  assert.match(text, /counter\.current\(\)/u);
  assert.doesNotMatch(text, /counter\.clone\(\)\.(?:add|current)\(/u);
});

test("ECMAScript private fields retain declaration identity and closed storage", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "private_field_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

class Left {
  #value: int32 = 1;

  increment(): int32 {
    this.#value += 1;
    return this.#value;
  }
}

class Right {
  #value: int32;

  constructor(value: int32) {
    this.#value = value;
  }

  current(): int32 {
    return this.#value;
  }
}

export function main(): void {
  const left = new Left();
  const right = new Right(9);
  check(left.increment() === 2);
  check(right.current() === 9);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.doesNotMatch(text, /#value/u);
  assert.match(text, /struct LeftState \{\s*pub\(crate\) value: i32,/u);
  assert.match(text, /struct RightState \{\s*pub\(crate\) value: i32,/u);
  assert.equal(validateGeneratedProject("private-field-bin", result.artifacts, { run: true }).status, 0);
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
  assert.match(text, /fn read_value_current\(&self\) -> i32/u);
  assert.match(text, /fn write_value_current\(&self, value: i32\)/u);
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
  assert.match(text, /fn read_value_current\(&self\) -> rt::TsonicResult<i32>/u);
  assert.match(text, /fn write_value_current\(&self, _value: i32\) -> rt::TsonicResult<\(\)>/u);
  assert.match(text, /pub fn read\(value: Value\) -> rt::TsonicResult<i32>[\s\S]*read_value_current\(\)/u);
  assert.match(text, /write_value_current\(accessor_value\)\?/u);
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
  assert.match(text, /impl Initialized \{\n    pub fn new\(\) -> Initialized/u);
  assert.match(text, /impl Default for Initialized \{\n    fn default\(\) -> Self \{\n        Self::new\(\)/u);
  assert.match(text, /let field_value: i32 = 42;/u);
  assert.match(text, /impl Empty \{\n    pub fn new\(\) -> Empty/u);
  assert.match(text, /impl Default for Empty \{\n    fn default\(\) -> Self \{\n        Self::new\(\)/u);
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
  assert.match(text, /let field_second: i32 = field_first;/u);
  assert.match(
    text,
    /second: field_second/u,
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

test("open generic virtual callers close through finite concrete entry points", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

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

function openCall<T>(receiver: Base, value: T): T {
  return receiver.identity<T>(value);
}

function relay<U>(receiver: Base, value: U): U {
  return openCall<U>(receiver, value);
}

export function intCall(receiver: Base, value: int32): int32 {
  return relay<int32>(receiver, value);
}

export function stringCall(receiver: Base, value: string): string {
  return relay<string>(receiver, value);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /fn open_call_specialization_1/u);
  assert.match(text, /fn open_call_specialization_2/u);
  assert.match(text, /fn relay_specialization_1/u);
  assert.match(text, /fn relay_specialization_2/u);
  assert.doesNotMatch(text, /fn open_call</u);
  assert.doesNotMatch(text, /fn relay</u);
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

test("user-authored identifiers use one idiomatic Rust name plan", () => {
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
  assert.doesNotMatch(text, /#!\[allow\(non_snake_case\)\]/u);
  assert.match(text, /pub fn pick_mode\(flag_value: bool\) -> i32/u);
  assert.match(text, /let mut chosen_value: i32 = 0;/u);
  assert.match(text, /pick_mode\(true\)/u);
});

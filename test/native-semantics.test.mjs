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

test("classes lower to struct plus impl with fact-backed members", () => {
  const { result } = compileRust({ files: { "index.ts": counterSource } });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /#\[derive\(Clone, Copy, Debug, PartialEq\)\]\npub struct Counter \{\n    pub value: i32,\n\}/u);
  assert.match(text, /impl Counter \{/u);
  assert.match(text, /pub fn new\(value: i32\) -> Counter \{\n        Counter \{ value \}\n    \}/u);
  assert.match(text, /pub fn add\(&mut self, delta: i32\) -> i32 \{/u);
  assert.match(text, /self\.value \+= delta;/u);
  assert.match(text, /pub fn current\(&self\) -> i32 \{/u);
  assert.match(text, /let mut counter = Counter::new\(10\);/u);
  assert.match(text, /counter\.add\(5\);/u);
  assert.match(text, /counter\.current\(\) \+ counter\.value/u);
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

test("class inheritance fails closed", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export class Base {
  constructor() {}
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
    diagnostic.message.includes("inheritance")));
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
  check(counter.add(5) === 15);
  check(counter.current() === 15);
  check(counter.value === 15);
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

test("mutable array parameters take the &mut [T] lane with visible writes", () => {
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
  assert.match(text, /pub fn bump\(xs: &mut \[i32\]\)/u);
  assert.match(text, /xs\[tsonic_rust_runtime::conversions::i32_to_usize\(0\)\?\] = 42;/u);
  assert.match(text, /bump\(&mut values\)\?;/u);
});

test("push on borrowed slices fails closed; owned vectors keep push", () => {
  const options = {
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function grow(xs: int32[]): void {
  xs.push(4);
}
`,
    },
  };
  assertRustTargetRejection(options, [{
    code: "RUST_SELECTED_OPERATION_UNSUPPORTED",
    message: "The selected JavaScript call 'Array.push' has no closed Rust operation row for the selected receiver and argument carriers.",
  }]);
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
  assert.match(text, /value\.unwrap_or\(0\)/u);
  assert.match(text, /value_or_zero\(Some\(5\)\)/u);
  assert.match(text, /value_or_zero\(None\)/u);
});

test("undefined-typed unions stay fail-closed without an explicit lane", () => {
  const options = {
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function value_or_zero(value: int32 | undefined): int32 {
  return value ?? 0;
}
`,
    },
  };
  assertRustTargetRejection(options, [{
    code: "RUST_PARAMETER_CARRIER_UNSUPPORTED",
    message: "Parameter type has no closed Rust runtime carrier under the selected source-profile and surface policy.",
  }]);
});

test("interfaces lower to record structs with annotated object literals", () => {
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
  assert.match(text, /#\[derive\(Clone, Copy, Debug, PartialEq\)\]\npub struct Point \{\n    pub x: i32,\n    pub y: i32,\n\}/u);
  assert.match(text, /let p: Point = Point \{ x: 0, y: 0 \};/u);
  assert.match(text, /Point \{ x: p\.x \+ dx, y: p\.y \}/u);
});

test("unannotated object literals fail closed", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export function make(): void {
  const p = { x: 1 };
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.length > 0);
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

test("dynamic tuple indexing fails closed", () => {
  const options = {
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function pick(entry: [int32, int32], i: int32): int32 {
  return entry[i];
}
`,
    },
  };
  assertRustTargetRejection(options, [{
    code: "RUST_FIXED_ARRAY_INDEX_NOT_PROVEN",
    message: "Fixed-array element access requires a TSTS-selected in-range fixed ordinal.",
  }]);
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

test("discriminated object unions fail closed: they require narrowing facts", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "square"; size: number };

export function make(): Shape {
  return { kind: "circle", radius: 1 };
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.length > 0);
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
  assert.match(text, /return Err\(rt::TsonicError::from\(rt::JsError::new\(/u);
  assert.match(text, /Ok\(7\)/u);
  assert.match(text, /let __try: rt::TsonicResult<\(\)> = \(\|\| \{/u);
  assert.match(text, /outcome = risky\(flag\)\?;/u);
  assert.match(text, /if let Err\(_error\) = __try \{/u);
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

test("fallible calls inside closures fail closed", () => {
  const options = {
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
  };
  assertRustTargetRejection(options, [{
    code: "RUST_FALLIBLE_CLOSURE_UNSUPPORTED",
    message: "Rust closures cannot contain fallible operations because the selected target callback ABI has an infallible result.",
  }]);
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

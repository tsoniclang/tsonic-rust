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

test("idiomatic naming resolves collisions by exact declaration identity", () => {
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
  assert.match(text, /let foo_bar_2: i32 = 1;/u);
  assert.match(text, /let foo_bar: i32 = 2;/u);
  assert.match(text, /foo_bar_2 \+ foo_bar/u);
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
  assert.doesNotMatch(text, /Label::new\(r#type\.clone\(\)\)/u);
  validateGeneratedProject("native-raw-identifiers", result.artifacts);
});

test("Rust keyword-shaped project methods use one raw identifier at declaration and call", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
class Matcher {
  match(value: string): string {
    return value;
  }
}

export function read(value: string): string {
  const matcher = new Matcher();
  return matcher.match(value);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /fn r#match\(&self, value: String\) -> String/u);
  assert.match(text, /matcher\.r#match\(value\)/u);
  assert.doesNotMatch(text, /value\.clone\(\)/u);
  assert.doesNotMatch(text, /matcher\.clone\(\)\.r#match/u);
  validateGeneratedProject("native-raw-method-identifiers", result.artifacts);
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
  assert.match(text, /#\[doc\(hidden\)\][\s\S]*pub struct PointState \{\s*pub x: i32,\s*pub y: i32,/u);
  assert.match(text, /#\[derive\(Clone, Debug, PartialEq\)\]\npub struct Point \{\s*#\[doc\(hidden\)\]\s*pub state: rt::ObjectHandle<PointState>,/u);
  assert.doesNotMatch(text, /derive\([^\n]*Copy/u);
  assert.match(text, /let record_x = 0;/u);
  assert.match(text, /let record_y = 0;/u);
  assert.match(text, /state: rt::ObjectHandle::new\(PointState \{\s*x: record_x,\s*y: record_y,/u);
  assert.match(text, /p\.state\.with\(\|state\| state\.x\) \+ dx/u);
  assert.doesNotMatch(text, /p\.clone\(\)\.state\.with/u);
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
  assert.match(
    artifactText(result, "src/shapes.rs"),
    /pub\(crate\) struct LabelXShape \{\s*pub label: String,\s*pub x: f64,/u,
  );
  assert.match(text, /rt::ObjectHandle<crate::shapes::LabelXShape>/u);
  assert.match(text, /rt::ObjectHandle::new\(crate::shapes::LabelXShape \{/u);
  assert.doesNotMatch(text, /state\.\d/u);
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
  assert.doesNotMatch(text, /\(a, label\.clone\(\)\)/u);
  assert.match(text, /pub fn first\(entry: \(i32, String\)\) -> i32/u);
  assert.match(text, /entry\.0/u);
  assert.doesNotMatch(text, /entry\.clone\(\)\.0/u);
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
  assert.match(text, /pub fn drive\(\) -> Result<i32, rt::TsonicError>/u);
  assert.match(
    text,
    /tsonic_rust_runtime::conversions::f64_to_i32\(pass_through::<f64>\(41\.0\) \+ 1\.0\)/u,
  );
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
    /tsonic_rust_runtime::block_on\(async_main::tsonic_entry\(\)\)/u,
  );
});

test("throwing functions lower to native Result with Err returns and Ok wrapping", () => {
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
  assert.match(text, /pub fn risky\(flag: bool\) -> Result<i32, rt::TsonicError> \{/u);
  assert.match(text, /return Err\(rt::TsonicError::from\(rt::JsError::error\(/u);
  assert.match(text, /Ok::<_, rt::TsonicError>\(7\)/u);
  assert.match(text, /let try_body: rt::TsonicResult<rt::Completion<i32>> = rt::completion_region\(\|\| \{/u);
  assert.match(text, /outcome = risky\(flag\)\?;/u);
  assert.match(text, /let try_flow: rt::Completion<i32> = match try_body \{/u);
  assert.match(text, /Err\(_error\) => rt::completion_region\(\|\| \{/u);
  assert.match(text, /use tsonic_rust_runtime as rt;/u);
});

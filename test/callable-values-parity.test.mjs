import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("neutral function pointers remain native Rust function pointers", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { bool, FunctionPointer, int32 } from "@tsonic/core/types.js";

export function preserve(
  callback: FunctionPointer<[int32, int32], bool>,
): FunctionPointer<[int32, int32], bool> {
  return callback;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(
    artifactText(result, "src/index.rs"),
    /pub fn preserve\(callback: fn\(i32, i32\) -> bool\) -> fn\(i32, i32\) -> bool/u,
  );
  validateGeneratedProject("callable-native-pointer", result.artifacts);
});

test("ordinary callable parameters use one fallible first-class callable ABI", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "callable_value" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

function invoke(action: (value: int32) => int32, value: int32): int32 {
  return action(value);
}

export function main(): void {
  const increment = (value: int32): int32 => value + 1;
  check(invoke(increment, 4) === 5);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /rt::Callable<\(i32,\), rt::TsonicResult<i32>>/u);
  assert.match(source, /action\.call\(\(value,\)\)/u);
  validateGeneratedProject("callable-value", result.artifacts, { run: true });
});

test("arbitrary first-class callables propagate throws through their stable ABI", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "callable_throw" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

function invoke(action: (value: int32) => int32, value: int32): int32 {
  return action(value);
}

function risky(value: int32): int32 {
  if (value < 0) {
    throw new Error("negative");
  }
  return value + 1;
}

export function main(): void {
  let caught = false;
  try {
    invoke(risky, -1);
  } catch (_error) {
    caught = true;
  }
  check(caught);
  check(invoke(risky, 4) === 5);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /fn invoke\([^)]*Callable<\(i32,\), rt::TsonicResult<i32>>[^)]*\) -> rt::TsonicResult<i32>/u);
  assert.match(source, /action\.call\(\(value,\)\)/u);
  assert.match(source, /rt::Callable::<\(i32,\), rt::TsonicResult<i32>>::new/u);
  validateGeneratedProject("callable-throw", result.artifacts, { run: true });
});

test("fallible direct-only top-level callables use native functions without fallible initialization", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "callable_top_level" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

const parsePositive = (value: int32): int32 => {
  if (value < 0) {
    throw new Error("negative");
  }
  return value;
};

export function main(): void {
  let caught = false;
  try {
    parsePositive(-1);
  } catch (_error) {
    caught = true;
  }
  check(caught);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /fn parse_positive\(value: i32\) -> rt::TsonicResult<i32>/u);
  assert.doesNotMatch(source, /rt::Callable<\(i32,\), rt::TsonicResult<i32>>/u);
  assert.match(source, /Err\(rt::TsonicError::from\(rt::JsError::error\("negative"\)\)\)/u);
  validateGeneratedProject("callable-top-level", result.artifacts, { run: true });
});

test("representation-preserving callable aliases close top-level callable values", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "callable_alias" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

type TextTransform = (value: string) => string;

const apply = (value: string, transform: TextTransform): string => transform(value);

export function main(): void {
  check(apply("rust", (value: string): string => value.toUpperCase()) === "RUST");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.doesNotMatch(source, /type TextTransform/u);
  assert.match(source, /rt::Callable<\(String,\), rt::TsonicResult<String>>/u);
  validateGeneratedProject("callable-alias", result.artifacts, { run: true });
});

test("computed authored type syntax closes callable signatures", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "computed_type_syntax" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

class Box {
  value: string;

  constructor(value: string) {
    this.value = value;
  }
}

const makeBox = (value: string): Box => new Box(value);
const describe = (
  box: ReturnType<typeof makeBox>,
  suffix: Box["value"],
): { text: string } => ({ text: box.value + suffix });

export function main(): void {
  check(describe(makeBox("rust"), "!").text === "rust!");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("computed-type-syntax", result.artifacts, { run: true });
});

test("escaping closures preserve shared mutable captures", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "callable_capture" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

function counter(seed: int32): () => int32 {
  let value = seed;
  return (): int32 => {
    value += 1;
    return value;
  };
}

export function main(): void {
  const next = counter(3);
  check(next() === 4);
  check(next() === 5);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /rt::Location::allocate\(seed\)/u);
  assert.match(source, /rt::Callable::<\(\), rt::TsonicResult<i32>>::new/u);
  validateGeneratedProject("callable-capture", result.artifacts, { run: true });
});

test("function declarations are first-class callable values", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "callable_function_value" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

function increment(value: int32): int32 {
  return value + 1;
}

export function main(): void {
  const selected = increment;
  check(selected(8) === 9);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("callable-function-value", result.artifacts, { run: true });
});

test("direct optional callable calls guard the callee and remain lazy", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "callable_optional" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

let evaluations: int32 = 0;

function argument(): int32 {
  evaluations += 1;
  return 4;
}

function invoke(action: ((value: int32) => int32) | null): int32 | null {
  return action?.(argument()) ?? null;
}

export function main(): void {
  check(invoke(null) === null);
  check(evaluations === 0);
  check(invoke((value: int32): int32 => value + 1) === 5);
  check(evaluations === 1);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /action\s*\.as_ref\(\)\s*\.map/u);
  assert.doesNotMatch(source, /action\s*\.clone\(\)/u);
  validateGeneratedProject("callable-optional", result.artifacts, { run: true });
});

test("callable defaults and rest parameters preserve source invocation shape", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "callable_parameters" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

export function main(): void {
  const defaulted = (value: int32 = 7): int32 => value;
  const total = (first: int32, ...rest: int32[]): int32 => {
    let result = first;
    for (const value of rest) {
      result += value;
    }
    return result;
  };
  check(defaulted() === 7);
  check(total(1, 2, 3) === 6);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("callable-parameters", result.artifacts, { run: true });
});

test("project-source optional and default parameters compose exact value conversions before Option wrapping", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "source_call_optional_conversion" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

function optional(value?: number): number {
  return value ?? 0;
}

function defaulted(value: number = 3.5): number {
  return value;
}

function optionalBridge(value: int32 | undefined): number {
  return optional(value);
}

export function main(): void {
  const value: int32 = 8;
  check(optional(value) === 8);
  check(defaulted(value) === 8);
  check(optionalBridge(value) === 8);
  check(optionalBridge(undefined) === 0);
  check(optional() === 0);
  check(defaulted() === 3.5);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /optional\(Some\(tsonic_rust_runtime::conversions::i32_to_f64\(value\)\)\)/u);
  assert.match(source, /defaulted\(Some\(tsonic_rust_runtime::conversions::i32_to_f64\(value\)\)\)/u);
  assert.match(source, /value\.map\(tsonic_rust_runtime::conversions::i32_to_f64\)/u);
  validateGeneratedProject("source-call-optional-conversion", result.artifacts, { run: true });
});

test("project-source spread calls preserve exact bindings, single evaluation, and order", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "source_call_spread" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

let trace: int32 = 0;

function first(): int32 {
  trace = trace * 10 + 1;
  return 1;
}

function pair(): [int32, int32] {
  trace = trace * 10 + 2;
  return [2, 3];
}

function sum3(firstValue: int32, secondValue: int32, thirdValue: int32): int32 {
  return firstValue + secondValue + thirdValue;
}

function total(...values: int32[]): int32 {
  let result: int32 = 0;
  for (const value of values) {
    result += value;
  }
  return result;
}

export function main(): void {
  check(sum3(first(), ...pair()) === 6);
  check(trace === 12);
  const values: int32[] = [4, 5, 6];
  check(total(...values) === 15);
  const middle: int32[] = [5, 6];
  check(total(4, ...middle, 7) === 22);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let spread_argument/u);
  assert.match(
    source,
    /sum3\(\s*spread_argument,\s*spread_argument_2\[0\],\s*spread_argument_2\[1\],?\s*\)/u,
  );
  validateGeneratedProject("source-call-spread", result.artifacts, { run: true });
});

test("named function expressions retain recursive callable identity", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "callable_recursive" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

export function main(): void {
  const factorial = function recur(value: int32): int32 {
    return value <= 1 ? 1 : value * recur(value - 1);
  };
  check(factorial(5) === 120);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(
    artifactText(result, "src/index.rs"),
    /rt::Callable::<\(i32,\), rt::TsonicResult<i32>>::recursive/u,
  );
  validateGeneratedProject("callable-recursive", result.artifacts, { run: true });
});

test("callable values preserve shared captures and complete source parameter semantics", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "callable_complete" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

let defaultEvaluations: int32 = 0;

function fallback(base: int32): int32 {
  defaultEvaluations += 1;
  return base + 1;
}

function choose(base: int32, value: int32 = fallback(base)): int32 {
  return value;
}

function optional(value?: int32): int32 {
  return value ?? 0;
}

function total(first: int32, ...rest: int32[]): int32 {
  let result = first;
  for (const value of rest) {
    result += value;
  }
  return result;
}

function preserveText(value: string): string {
  return value;
}

function counters(seed: int32): [() => int32, () => int32] {
  let value = seed;
  const increment = (): int32 => {
    value += 1;
    return value;
  };
  const current = (): int32 => value;
  return [increment, current];
}

export function main(): void {
  const [increment, current] = counters(4);
  check(current() === 4);
  check(increment() === 5);
  check(current() === 5);

  let visible: int32 = 10;
  const bump = (): void => {
    visible += 1;
  };
  bump();
  check(visible === 11);

  const label = "kept";
  const readLabel = (): string => label;
  check(readLabel() === "kept");
  check(readLabel() === "kept");
  check(label === "kept");

  check(choose(4) === 5);
  check(defaultEvaluations === 1);
  check(choose(4, 9) === 9);
  check(defaultEvaluations === 1);
  check(choose(4, undefined) === 5);
  check(defaultEvaluations === 2);

  check(optional() === 0);
  check(optional(undefined) === 0);
  check(optional(8) === 8);
  check(total(1) === 1);
  check(total(1, 2, 3) === 6);

  const textFunction = preserveText;
  check(textFunction("text") === "text");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("callable-complete", result.artifacts, { run: true });
});

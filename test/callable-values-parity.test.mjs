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

test("ordinary callable parameters and local arrows use one closed callable carrier", { timeout: 300_000 }, () => {
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
  assert.match(source, /rt::Callable<\(i32,\), i32>/u);
  assert.match(source, /action\.call\(\(value,\)\)/u);
  validateGeneratedProject("callable-value", result.artifacts, { run: true });
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
  assert.match(source, /rt::Callable::<\(\), i32>::new/u);
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
  assert.match(artifactText(result, "src/index.rs"), /action\s*\.as_ref\(\)\s*\.map/u);
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
    /rt::Callable::<\(i32,\), i32>::recursive/u,
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

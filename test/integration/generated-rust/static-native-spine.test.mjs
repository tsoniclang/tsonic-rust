import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { expectedAuthoredRustSource } from "../../helpers/generated-rust-source.mjs";

test("primitive function lowers to exact fact-backed Rust", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function add(a: int32, b: int32): int32 {
  return a + b;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.equal(artifactText(result, "src/index.rs"), expectedAuthoredRustSource([
    "pub fn add(a: i32, b: i32) -> i32 {",
    "    a + b",
    "}",
  ]));
});

test("control flow lowers structured if with fact-backed unary and comparison", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function abs(value: int32): int32 {
  if (value < 0) {
    return -value;
  }
  return value;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.equal(artifactText(result, "src/index.rs"), expectedAuthoredRustSource([
    "pub fn abs(value: i32) -> i32 {",
    "    if value < 0 {",
    "        return -value;",
    "    }",
    "    value",
    "}",
  ]));
});

test("locals, while loops, and assignments lower from operator facts", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function count_down(start: int32): int32 {
  let n: int32 = start;
  let steps: int32 = 0;
  while (n > 0) {
    n--;
    steps++;
  }
  return steps;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.equal(artifactText(result, "src/index.rs"), expectedAuthoredRustSource([
    "pub fn count_down(start: i32) -> i32 {",
    "    let mut n: i32 = start;",
    "    let mut steps: i32 = 0;",
    "    while n > 0 {",
    "        n -= 1;",
    "        steps += 1;",
    "    }",
    "    steps",
    "}",
  ]));
});

test("let bindings are mutable only with a proven write", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function stable(base: int32): int32 {
  let untouched: int32 = base;
  let bumped: int32 = 0;
  bumped = untouched + 1;
  return bumped;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /let untouched: i32 = base;/u);
  assert.match(text, /let mut bumped: i32 = 0;/u);
});

test("for loops lower to scoped while with declared loop variable", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function total(limit: int32): int32 {
  let sum: int32 = 0;
  for (let i: int32 = 0; i < limit; i++) {
    sum = sum + i;
  }
  return sum;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /let mut i: i32 = 0;/u);
  assert.match(text, /while i < limit \{/u);
  assert.match(text, /sum \+= i;/u);
  assert.match(text, /i \+= 1;/u);
});

test("equivalent assignment requires exact source binding identity", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function replace(left: int32, right: int32): int32 {
  let value: int32 = left;
  value = right + 1;
  return value;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /value = right \+ 1;/u);
  assert.doesNotMatch(text, /value \+=/u);
});

test("string expressions lower concat and equality through facts", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export function greet(name: string): string {
  return "hello " + name;
}

export function isEmpty(text: string): boolean {
  return text === "";
}

export function isNotEmpty(text: string): boolean {
  return "" !== text;
}

`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /format!\("\{\}\{\}", String::from\("hello "\), name\)/u);
  assert.match(text, /text\.is_empty\(\)/u);
  assert.match(text, /!text\.is_empty\(\)/u);
  assert.doesNotMatch(text, /(?:==|!=) ""/u);
});

test("Rust expression construction canonicalizes proven native boolean, range, and concat forms", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function missing(value: string | undefined): boolean {
  return !(value !== undefined);
}

export function inRange(value: int32): boolean {
  return value >= 10 && value <= 20;
}

export function checkedInRange(valid: boolean, value: int32): boolean {
  return valid && value >= 10 && value <= 20;
}

export function outsideRange(value: int32): boolean {
  return value < 10 || value > 20;
}

export function outsideFloatRange(value: number): boolean {
  return value < 10 || value > 20;
}

export function negateFloatComparison(value: number): boolean {
  return !(value < 10);
}

export function negateFloatLessEqual(value: number): boolean {
  return !(value <= 10);
}

export function negateFloatGreater(value: number): boolean {
  return !(value > 10);
}

export function negateFloatGreaterEqual(value: number): boolean {
  return !(value >= 10);
}

export function joined(left: string, right: string): string {
  return left + ("/" + right);
}

export function explicitUnitReturn(): void {
  return;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /value\.is_none\(\)/u);
  assert.match(text, /\(10\.\.=20\)\.contains\(&value\)/u);
  assert.match(text, /valid\s*&&\s*\(10\.\.=20\)\.contains\(&value\)/u);
  assert.match(text, /!\(10\.\.=20\)\.contains\(&value\)/u);
  assert.match(text, /value\.partial_cmp\(&10\.0\) == Some\(std::cmp::Ordering::Less\)/u);
  assert.match(text, /value\.partial_cmp\(&20\.0\) == Some\(std::cmp::Ordering::Greater\)/u);
  assert.doesNotMatch(text, /!\(10\.0\.\.=20\.0\)\.contains\(&value\)/u);
  assert.match(text, /value\s*\.partial_cmp\(&10\.0\)\s*\.is_none_or\(\|ordering\| ordering != std::cmp::Ordering::Less\)/u);
  assert.match(text, /value\s*\.partial_cmp\(&10\.0\)\s*\.is_none_or\(\|ordering\| ordering == std::cmp::Ordering::Greater\)/u);
  assert.match(text, /value\s*\.partial_cmp\(&10\.0\)\s*\.is_none_or\(\|ordering\| ordering != std::cmp::Ordering::Greater\)/u);
  assert.match(text, /value\s*\.partial_cmp\(&10\.0\)\s*\.is_none_or\(\|ordering\| ordering == std::cmp::Ordering::Less\)/u);
  assert.match(text, /format!\("\{\}\{\}\{\}", left, String::from\("\/"\), right\)/u);
  assert.match(text, /pub fn explicit_unit_return\(\) \{\}/u);
  assert.doesNotMatch(text, /format!\([^\n]*format!/u);
});

test("module imports and exports lower to crate-qualified calls", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { clamp } from "./math_utils.js";

export function pick(value: int32, max: int32): int32 {
  return clamp(value, max);
}
`,
      "math_utils.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function clamp(value: int32, max: int32): int32 {
  if (value > max) {
    return max;
  }
  return value;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /crate::math_utils::clamp\(value, max\)/u);
  assert.equal(artifactText(result, "src/lib.rs"), [
    "// Generated by the Tsonic Rust target. Do not edit.",
    "",
    "pub mod index;",
    "",
    "pub mod math_utils;",
    "",
  ].join("\n"));
});

test("source-package style re-export barrels use selected declaration identity", () => {
  const { result } = compileRust({
    files: {
      "app.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { Counter } from "./index.js";

export function value(): int32 {
  return new Counter(40).increment();
}
`,
      "index.ts": `
export { Counter } from "./counter.js";
`,
      "counter.ts": `
import type { int32 } from "@tsonic/core/types.js";

export class Counter {
  value: int32;

  constructor(value: int32) {
    this.value = value;
  }

  increment(): int32 {
    this.value += 1;
    return this.value;
  }
}
`,
    },
    entryPoint: "app.ts",
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/app.rs");
  assert.match(text, /crate::counter::Counter::new\(40\)\.increment\(\)/u);
  assert.equal(
    artifactText(result, "src/index.rs"),
    expectedAuthoredRustSource(),
  );
});

test("top-level annotated const lowers to Rust const", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export const LIMIT: int32 = 10;

export function limit(): int32 {
  return LIMIT;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub const LIMIT: i32 = 10;/u);
});

test("non-final returns keep return statements; final return becomes tail expression", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function sign(value: int32): int32 {
  if (value < 0) {
    return -1;
  }
  if (value > 0) {
    return 1;
  }
  return 0;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /return -1;/u);
  assert.match(text, /return 1;/u);
  assert.match(text, /\n    0\n\}/u);
});

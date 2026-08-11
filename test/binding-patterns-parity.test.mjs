import assert from "node:assert/strict";
import { test } from "node:test";

import { artifactText, compileRust } from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("object and fixed-tuple bindings consume finalized projection facts", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export interface Pair { left: int32; right: int32 }

export function read(pair: Pair, tuple: [int32, int32]): int32 {
  const { left: first, right = 4 } = pair;
  const [head, ...tail] = tuple;
  return first + right + head + tail[0];
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let __tsonic_binding = pair\.clone\(\);/u);
  assert.match(source, /let first: i32 = __tsonic_binding\.__tsonic_state\.with/u);
  assert.match(source, /let right: i32 = __tsonic_binding\.__tsonic_state\.with/u);
  assert.match(source, /let head: i32 = __tsonic_binding_\d*\[0\];/u);
  assert.match(source, /validated fixed-array destructuring length/u);
  validateGeneratedProject("binding-object-fixed-tuple", result.artifacts);
});

test("nested binding patterns retain exact leaf carriers", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export interface Envelope { pair: [int32, string] }

export function summarize(envelope: Envelope): boolean {
  const { pair: [count, label] } = envelope;
  return count > 0 && label === "ready";
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let __tsonic_binding_\d+ = __tsonic_binding[\s\S]*\.__tsonic_state[\s\S]*\.with/u);
  assert.match(source, /let count: i32 = __tsonic_binding_\d+\.0;/u);
  assert.match(source, /let label: String = __tsonic_binding_\d+\.1\.clone\(\);/u);
  validateGeneratedProject("binding-nested", result.artifacts);
});

test("native vector defaults and rest preserve one initializer evaluation", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function read(): int32 {
  const values: int32[] = [1, 2];
  const [first = 9, ...rest] = values;
  return first + rest[0];
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /__tsonic_binding\s*\.first\(\)[\s\S]*\.cloned\(\)[\s\S]*\.map_or_else/u);
  assert.match(source, /__tsonic_binding\[1\.\.__tsonic_binding\.len\(\)\]\.to_vec\(\)/u);
  validateGeneratedProject("binding-native-vector", result.artifacts);
});

test("JavaScript array binding uses hole-aware get and slice operations", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function read(): int32 {
  const values: int32[] = [];
  const [first = 9, ...rest] = values;
  return first + rest.length;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /__tsonic_binding\s*\.get\(0\)[\s\S]*\.map_or_else/u);
  assert.match(source, /let rest: js_abi::JsArray<i32> = __tsonic_binding\.slice_from\(1\.0\);/u);
  validateGeneratedProject("binding-js-array", result.artifacts);
});

test("unsupported object-rest shapes fail closed before backend guessing", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export interface Pair { left: int32; right: int32 }

export function rest(pair: Pair): int32 {
  const { left, ...remaining } = pair;
  return left + remaining.right;
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.equal(result.diagnostics.some((diagnostic) =>
    diagnostic.code === "RUST_BINDING_PATTERN_NOT_CLOSED"), true);
});

test("function and class parameters bind through exact projected carriers", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export interface Pair { left: int32; right: int32 }

export function add({ left, right }: Pair): int32 {
  return left + right;
}

export class Accumulator {
  total: int32;

  constructor([left, right]: [int32, int32]) {
    this.total = left + right;
  }

  add({ left, right }: Pair): int32 {
    return this.total + left + right;
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /fn add\(__tsonic_binding_parameter: Pair\)/u);
  assert.match(source, /fn new\(__tsonic_binding_parameter(?:_\d+)?: \[i32; 2\]\)/u);
  assert.match(source, /fn add\(&self, __tsonic_binding_parameter(?:_\d+)?: Pair\)/u);
  validateGeneratedProject("binding-parameters", result.artifacts);
});

test("closure parameters use the same finalized binding projection", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function read(values: [int32, int32][]): int32[] {
  return values.map(([left, right]) => left + right);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /\|__tsonic_binding_parameter\| \{/u);
  assert.match(source, /let left: i32 = __tsonic_binding_parameter\[0\];/u);
  assert.match(source, /let right: i32 = __tsonic_binding_parameter\[1\];/u);
  validateGeneratedProject("binding-closure-parameter", result.artifacts);
});

test("for-of patterns project each exact selected element once", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function total(values: [int32, int32][]): int32 {
  let result: int32 = 0;
  for (const [left, right] of values) {
    result += left + right;
  }
  return result;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /for __tsonic_binding_element in rt::iter_copied\(values\)/u);
  assert.match(source, /let left: i32 = __tsonic_binding_element\[0\];/u);
  assert.match(source, /let right: i32 = __tsonic_binding_element\[1\];/u);
  validateGeneratedProject("binding-for-of", result.artifacts);
});

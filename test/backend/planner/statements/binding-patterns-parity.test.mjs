import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

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
  assert.match(source, /let binding = pair;/u);
  assert.match(source, /let first: i32 = binding\.state\.with/u);
  assert.match(source, /let right: i32 = binding\.state\.with/u);
  assert.match(source, /let head: i32 = binding_2\[0\];/u);
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
  assert.match(source, /let binding_2 = binding[\s\S]*\.state[\s\S]*\.with/u);
  assert.match(source, /let count: i32 = binding_2\.0;/u);
  assert.match(source, /let label: String = binding_2\.1\.clone\(\);/u);
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
  assert.match(source, /binding\s*\.first\(\)[\s\S]*\.cloned\(\)[\s\S]*\.map_or_else/u);
  assert.match(source, /binding\[1\.\.binding\.len\(\)\]\.to_vec\(\)/u);
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
  assert.match(source, /binding\s*\.get\(0\)[\s\S]*\.map_or_else/u);
  assert.match(source, /let rest: js_abi::JsArray<i32> = binding\.slice_from\(1\.0\);/u);
  validateGeneratedProject("binding-js-array", result.artifacts);
});

test("closed object rest copies every non-extracted field into one exact structural carrier", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "binding_object_rest" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

interface Pair<T> { left: T; label: string; right: T }

export function main(): void {
  const pair: Pair<int32> = { left: 1, label: "kept", right: 2 };
  const { left: extracted, ...remaining } = pair;
  const { label: copiedLabel } = remaining;
  check(extracted === 1);
  check(copiedLabel === "kept");
  check(remaining.label === "kept");
  check(remaining.right === 2);
  check(pair.label === "kept");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(
    artifactText(result, "src/shapes.rs"),
    /pub\(crate\) struct LabelRightShape \{\s*pub label: String,\s*pub right: i32,/u,
  );
  assert.match(source, /let remaining: rt::ObjectHandle<crate::shapes::LabelRightShape> =/u);
  assert.match(source, /rt::ObjectHandle::new\(crate::shapes::LabelRightShape \{/u);
  assert.doesNotMatch(source, /\.with\(\|state\| state\.\d+\.clone\(\)\)\s*\.clone\(\)/u);
  assert.equal(validateGeneratedProject("binding-object-rest", result.artifacts, { run: true }).status, 0);
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
  assert.match(source, /fn add\(binding_parameter: Pair\)/u);
  assert.match(source, /fn new\(binding_parameter(?:_\d+)?: \[i32; 2\]\)/u);
  assert.match(source, /fn add\(&self, binding_parameter(?:_\d+)?: Pair\)/u);
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
  assert.match(source, /\|binding_parameter\| \{/u);
  assert.match(source, /let left: i32 = binding_parameter\[0\];/u);
  assert.match(source, /let right: i32 = binding_parameter\[1\];/u);
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
  assert.match(source, /for binding_element in rt::iter_copied\(values\)/u);
  assert.match(source, /let left: i32 = binding_element\[0\];/u);
  assert.match(source, /let right: i32 = binding_element\[1\];/u);
  validateGeneratedProject("binding-for-of", result.artifacts);
});

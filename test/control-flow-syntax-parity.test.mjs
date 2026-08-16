import assert from "node:assert/strict";
import { test } from "node:test";

import { artifactText, compileRust } from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("constant-true loops with no selected break satisfy value-return flow", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin", crateName: "constant_loop_flow" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function reach(limit: int32): int32 {
  let current: int32 = 0;
  while (true) {
    if (current === limit) return current;
    current++;
  }
}

export function main(): void {
  void reach(3);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /loop \{/u);
  assert.doesNotMatch(source, /while true/u);
  validateGeneratedProject("control-flow-constant-loop", result.artifacts);
});

test("constant-true loops remain idiomatic across break and fallible return flow", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "constant_loop_break" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function count(values: string[]): int32 {
  let current: int32 = 0;
  while (true) {
    if (current === values.length) break;
    current++;
  }
  return current;
}

export function visit(values: string[]): void {
  let current: int32 = 0;
  while (true) {
    if (current === values.length) return;
    current++;
  }
}

export function main(): void {
  const values = ["a", "b"];
  if (count(values) !== 2) throw new Error("constant loop count failed");
  visit(values);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.equal(source.match(/loop \{/gu)?.length, 2);
  assert.doesNotMatch(source, /while true/u);
  assert.doesNotMatch(source, /loop \{[\s\S]*?\}\n\s+Ok\(\(\)\)/u);
  const run = validateGeneratedProject("control-flow-constant-loop-break", result.artifacts, { run: true });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test("top-level callable values keep nested mutable bindings local", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin", crateName: "callable_local_binding" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export const reach = (limit: int32): int32 => {
  let current: int32 = 0;
  while (true) {
    if (current === limit) return current;
    current++;
  }
};

export function main(): void {
  if (reach(3) !== 3) {
    throw new Error("callable local binding failed");
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let mut current: i32 = 0;/u);
  assert.doesNotMatch(source, /current\.with/u);
  const run = validateGeneratedProject("control-flow-callable-local", result.artifacts, { run: true });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test("do-while evaluates its condition after normal and continue paths", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function sum(limit: int32): int32 {
  let current: int32 = 0;
  let total: int32 = 0;
  do {
    current++;
    if (current === 2) {
      continue;
    }
    total += current;
  } while (current < limit);
  return total;
}

export function advance(value: number, limit: number): number {
  do {
    value += 1;
  } while (value < limit);
  return value;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /'loop_value(?:_\d+)?: loop \{/u);
  assert.match(source, /if current >= limit \{/u);
  assert.match(source, /value\s*\.partial_cmp\(&limit\)\s*\.is_none_or\(\|ordering\| ordering != std::cmp::Ordering::Less\)/u);
  assert.match(source, /continue 'loop_value(?:_\d+)?;/u);
  validateGeneratedProject("control-flow-do-while", result.artifacts);
});

test("empty and debugger statements are exact runtime no-ops", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function unchanged(value: int32): int32 {
  ;
  debugger;
  return value;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.doesNotMatch(source, /debugger/u);
  validateGeneratedProject("control-flow-noops", result.artifacts);
});

test("source labels bind exact loop continue and block break targets", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

class Resource {
  constructor() {}
  [Symbol.dispose](): void {}
}

export function labeled(limit: int32, skip: boolean): int32 {
  let outerIndex: int32 = 0;
  let total: int32 = 0;
  outer: for (; outerIndex < limit; outerIndex++) {
    let innerIndex: int32 = 0;
    inner: while (innerIndex < limit) {
      innerIndex++;
      if (skip) continue outer;
      if (innerIndex >= 2) break inner;
    }
  }
  done: {
    using resource = new Resource();
    if (outerIndex === limit) break done;
    total = outerIndex;
  }
  return total;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /continue 'loop_value/u);
  assert.match(source, /break 'loop_value/u);
  assert.match(source, /'label(?:_\d+)?: \{/u);
  assert.match(source, /rt::Completion::Break\(\d+\)/u);
  validateGeneratedProject("control-flow-labels", result.artifacts);
});

test("switch preserves strict selection, fallthrough, default, and loop control", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function numeric(value: int32): int32 {
  let total: int32 = 0;
  switch (value) {
    case 1:
      total += 10;
    case 2:
      total += 20;
      break;
    default:
      total = -1;
  }
  return total;
}

export function text(value: string): int32 {
  switch (value) {
    case "first": return 1;
    default: return 0;
    case "last": return 2;
  }
}

export function nested(limit: int32): int32 {
  let index: int32 = 0;
  outer: while (index < limit) {
    index++;
    switch (index) {
      case 1: continue outer;
      case 2: break;
      default: index += 1;
    }
  }
  return index;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let switch_value(?:_\d+)? = value;/u);
  assert.match(source, /switch_value(?:_\d+)? == 1/u);
  assert.match(source, /switch_value(?:_\d+)? == "first"/u);
  assert.match(source, /break 'switch/u);
  assert.match(source, /continue 'loop_value/u);
  validateGeneratedProject("control-flow-switch", result.artifacts);
});

test("switch resource blocks clean up before exact switch breaks", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
class Resource {
  constructor() {}
  [Symbol.dispose](): void {}
}

export function dispose(value: boolean): void {
  switch (value) {
    case true: {
      using resource = new Resource();
      break;
    }
    default:
      break;
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.equal(source.indexOf("resource.dispose()") < source.indexOf("break 'switch"), true);
  validateGeneratedProject("control-flow-switch-resource", result.artifacts);
});

test("switch rejects carriers without exact Rust strict equality", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
class Box {
  value: boolean;
  constructor(value: boolean) { this.value = value; }
}

export function invalid(value: Box, other: Box): boolean {
  switch (value) {
    case other: return true;
    default: return false;
  }
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.message.includes("exact closed Rust equality carrier")));
});

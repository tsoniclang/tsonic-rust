import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("static class fields preserve source initialization read write and update semantics", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "class_static_fields" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

let sequence: int32 = 0;

function mark(value: int32): int32 {
  sequence = sequence * 10 + value;
  return value;
}

class First {
  static value: int32 = mark(1);
  static other: int32 = mark(2);

  static increment(): int32 {
    First.value += 1;
    return First.value;
  }
}

class Second {
  static value: int32 = mark(3);
}

export function main(): void {
  check(sequence === 123);
  check(First.value === 1);
  check(First.other === 2);
  check(Second.value === 3);
  First.value = 4;
  check(First.increment() === 5);
  const previous = First.value++;
  const current = ++First.value;
  check(previous === 5);
  check(current === 7);
  check(Second.value === 3);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /thread_local! \{/u);
  assert.match(text, /rt::ModuleCell<i32>/u);
  const run = validateGeneratedProject("class-static-fields", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("static class field storage remains exact across source modules", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "class_static_modules" } },
    files: {
      "counter.ts": `
import type { int32 } from "@tsonic/core/types.js";

export class Counter {
  static total: int32 = 10;
}
`,
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";
import { Counter as ImportedCounter } from "./counter.js";

export function main(): void {
  check(ImportedCounter.total === 10);
  ImportedCounter.total += 5;
  check(ImportedCounter.total === 15);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /crate::counter::COUNTER_TOTAL/u);
  const run = validateGeneratedProject("class-static-modules", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("static class fields reject unproven runtime constructor aliases", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

class ExactOwner {
  static value: int32 = 1;
}

const RuntimeAlias = ExactOwner;

export function read(): int32 {
  return RuntimeAlias.value;
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === "RUST_STATIC_FIELD_RECEIVER_NOT_EXACT" &&
    diagnostic.message.includes("exact TSTS-selected receiver value evidence")));
});

test("static class fields require explicit initialization and defaultValue uses exact Rust Default evidence", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export class Invalid {
  static value: int32;
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === "RUST_UNSUPPORTED_AST" &&
    diagnostic.message.includes("static class fields require an initializer")));

  const explicitDefault = compileRust({
    files: {
      "index.ts": `
import { defaultValue } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";

export class Exact {
  static value: int32 = defaultValue<int32>();
}

export function genericDefault<T>(): T {
  return defaultValue<T>();
}
`,
    },
  });
  assert.deepEqual(explicitDefault.result.diagnostics, []);
  const emitted = artifactText(explicitDefault.result, "src/index.rs");
  assert.match(emitted, /rt::ModuleCell<i32>/u);
  assert.match(emitted, /<i32 as Default>::default\(\)/u);
  assert.match(emitted, /pub fn generic_default<T: Default>\(\) -> T/u);
  assert.match(emitted, /<T as Default>::default\(\)/u);
  validateGeneratedProject(
    "class-static-explicit-default",
    explicitDefault.result.artifacts,
  );

  const unsupportedDefault = compileRust({
    files: {
      "index.ts": `
import { defaultValue } from "@tsonic/core/lang.js";

export function invalid(): () => void {
  return defaultValue<() => void>();
}
`,
    },
  });
  assert.equal(unsupportedDefault.result.artifacts.length, 0);
  assert.ok(unsupportedDefault.result.diagnostics.some((diagnostic) =>
    diagnostic.code === "RUST_UNSUPPORTED_AST" &&
    diagnostic.message.includes("requires an exact Rust Default implementation")));
});

test("static this receiver access fails closed without exact value evidence", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export class Invalid {
  static first: int32 = 1;
  static second: int32 = this.first;
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === "RUST_STATIC_FIELD_RECEIVER_NOT_EXACT" &&
    diagnostic.message.includes("exact TSTS-selected receiver value evidence")));
});

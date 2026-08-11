import assert from "node:assert/strict";
import { test } from "node:test";

import { acmeTestingPackage, artifactText, compileRust } from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("conditional expressions use one finalized branch carrier", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function choose(condition: boolean, left: int32, right: int32): int32 {
  return condition ? left : right;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /if condition \{\s+left\s+\} else \{\s+right\s+\}/u);
  validateGeneratedProject("expression-conditional", result.artifacts);
});

test("no-substitution templates retain their exact string value", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export function text(): string {
  return \`line one\\nline two\`;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /String::from\("line one\\nline two"\)/u);
  validateGeneratedProject("expression-template-literal", result.artifacts);
});

test("satisfies and redundant non-null syntax erase through exact identity facts", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function identity(value: int32): int32 {
  const checked: int32 = value satisfies int32;
  return checked!;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let checked: i32 = value;/u);
  assert.match(source, /checked\n/u);
  validateGeneratedProject("expression-erased-wrappers", result.artifacts);
});

test("non-null syntax does not guess through an Option carrier", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export function require(value: string | null): string {
  return value!;
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.message.includes("identity operation") ||
    diagnostic.message.includes("Expression planning returned no Rust AST")));
});

test("arrow and function-expression callbacks share one exact block-body contract", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function transform(values: int32[]): int32[] {
  const mapped = values.map(function (value: int32): int32 {
    const next: int32 = value + 1;
    return next;
  });
  const filtered = mapped.filter((value: int32): boolean => {
    return value > 1;
  });
  return filtered.map((value: int32): int32 => {
    value += 1;
    return value;
  });
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /values\.map\(\|&value\| \{/u);
  assert.match(source, /mapped\.filter\(\|&value\| value > 1\)/u);
  assert.match(source, /filtered\.map\(\|&\(mut value\)\| \{/u);
  validateGeneratedProject("expression-callable-blocks", result.artifacts);
});

test("named callable expressions fail closed instead of inventing recursive closure identity", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function transform(values: int32[]): int32[] {
  return values.map(function recurse(value: int32): int32 {
    return value;
  });
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.message.includes("closure") || diagnostic.message.includes("callable") ||
    diagnostic.message.includes("callback")));
});

test("substituted templates use exact source-string conversions", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "template_proof" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

export function main(): void {
  const count: int32 = 42;
  const enabled: boolean = true;
  const negativeZero: number = -0;
  const text = \`count=\${count}; enabled=\${enabled}; zero=\${negativeZero}\`;
  check(text === "count=42; enabled=true; zero=0");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /rt::source_string\(&count\)/u);
  assert.match(source, /rt::source_string\(&enabled\)/u);
  assert.match(source, /rt::source_string\(&negativeZero\)/u);
  validateGeneratedProject("expression-substituted-template", result.artifacts, { run: true });
});

test("typeof consumes exact carriers and preserves operand evaluation without moves", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32, int64 } from "@tsonic/core/types.js";

export function categories(text: string, count: int32, wide: int64, enabled: boolean): string {
  const textKind = typeof text;
  const countKind = typeof count;
  const wideKind = typeof wide;
  const enabledKind = typeof enabled;
  return text + textKind + countKind + wideKind + enabledKind;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let _ = text;\s+String::from\("string"\)/u);
  assert.match(source, /String::from\("number"\)/u);
  assert.match(source, /String::from\("bigint"\)/u);
  assert.match(source, /String::from\("boolean"\)/u);
  validateGeneratedProject("expression-typeof", result.artifacts);
});

test("void evaluates its operand and produces the closed undefined carrier", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "void_proof" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

export function main(): void {
  const discarded = void check(true);
  check(typeof discarded === "undefined");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let discarded = \{\s+acme_testing::check\(true\);\s+rt::Undefined\s+\};/u);
  validateGeneratedProject("expression-void", result.artifacts, { run: true });
});

test("bigint literals preserve arbitrary precision, value reuse, and operators", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "bigint_proof" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

function difference(left: bigint, right: bigint): bigint {
  const sum = left + right;
  return sum - left;
}

class Counter {
  value: bigint;

  constructor(value: bigint) {
    this.value = value;
  }

  read(): bigint {
    return this.value;
  }
}

export function main(): void {
  const huge = 1234567890123456789012345678901234567890n;
  check(difference(huge, 7n) === 7n);
  check(huge === 1234567890123456789012345678901234567890n);
  let changed = huge;
  changed += 2n;
  changed--;
  check(changed === huge + 1n);
  check(-changed < 0n);
  check(typeof changed === "bigint");
  const counter = new Counter(huge);
  check(counter.read() === huge);
  check(counter.read() === huge);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /rt::BigInt/u);
  validateGeneratedProject("expression-bigint", result.artifacts, { run: true });
});

test("inexact number literals cannot masquerade as fixed-width 64-bit values", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int64 } from "@tsonic/core/types.js";

export function invalid(): int64 {
  return 9007199254740993;
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === "RUST_INTEGER_LITERAL_NOT_EXACT"));
});

test("bigint division fails closed until its catchable error ABI is selected", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export function divide(left: bigint, right: bigint): bigint {
  return left / right;
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === "RUST_BINARY_OPERATOR_CARRIER_UNSUPPORTED"));
});

test("delete lowers only an exact mutable JS Array index selection", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "delete_proof" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

export function main(): void {
  const values: (int32 | undefined)[] = [10, 20, 30];
  check(delete values[1]);
  check(values.length === 3);
  let keyCount: int32 = 0;
  for (const key in values) {
    check(key !== "1");
    keyCount += 1;
  }
  check(keyCount === 2);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /values\.delete_at\(/u);
  validateGeneratedProject("expression-delete-js-array", result.artifacts, { run: true });
});

test("delete rejects non-JS-array targets without target-name inference", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function remove(values: int32[]): boolean {
  return delete values[0];
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === "RUST_DELETE_SELECTION_UNSUPPORTED"));
});

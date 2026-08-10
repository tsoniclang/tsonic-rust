import assert from "node:assert/strict";
import { test } from "node:test";

import { artifactText, compileRust } from "./helpers/rust-session.mjs";
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
  assert.match(source, /array_dense_map\(values, \|&value\| \{/u);
  assert.match(source, /array_dense_filter\(&mapped, \|&value\| value > 1\)/u);
  assert.match(source, /array_dense_map\(&filtered, \|&\(mut value\)\| \{/u);
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

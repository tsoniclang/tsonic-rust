import assert from "node:assert/strict";
import { test } from "node:test";

import {
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("core foundation emits and builds a no-std primitive library", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { foundation: "core" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function add(left: int32, right: int32): int32 {
  return left + right;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/lib.rs"), /#!\[no_std\]/u);
  assert.doesNotMatch(
    result.artifacts.filter((artifact) => artifact.language === "rust")
      .map((artifact) => artifact.text).join("\n"),
    /\b(?:alloc|std)::/u,
  );
  validateGeneratedProject("foundation-core-primitive", result.artifacts);
});

test("alloc foundation emits and builds native owned strings", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { foundation: "alloc" } },
    files: {
      "index.ts": `
export function greet(name: string): string {
  return "hello, " + name;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/lib.rs"), /#!\[no_std\][\s\S]*extern crate alloc;/u);
  assert.match(artifactText(result, "Cargo.toml"), /features = \["alloc"\]/u);
  validateGeneratedProject("foundation-alloc-string", result.artifacts);
});

test("core foundation rejects an alloc carrier before publication", () => {
  const { result } = compileRust({
    target: { id: "rust", options: { foundation: "core" } },
    files: {
      "index.ts": `
export function greet(name: string): string {
  return name;
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "RUST_FOUNDATION_REQUIREMENT_UNSATISFIED");
  assert.match(result.diagnostics[0].message, /requires Rust 'alloc'.*selected 'core'/u);
});

test("the JavaScript surface requires std explicitly", () => {
  const { result } = compileRust({
    target: { id: "rust", options: { foundation: "alloc" } },
    surfaces: ["js"],
    files: { "index.ts": "export const answer = 42;" },
  });

  assert.equal(result.artifacts.length, 0);
  assert.equal(result.diagnostics[0].code, "RUST_FOUNDATION_REQUIREMENT_UNSATISFIED");
});

test("alloc standard-library imports retain alloc-native target paths", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { foundation: "alloc" } },
    files: {
      "index.ts": `
import type { int32, nativeUint } from "@tsonic/core/types.js";
import { Vec } from "@tsonic/rust/alloc/vec.js";

export function length(values: Vec<int32>): nativeUint {
  return values.len();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /alloc::vec::Vec<i32>/u);
  assert.doesNotMatch(source, /std::/u);
  validateGeneratedProject("foundation-alloc-provider", result.artifacts);
});

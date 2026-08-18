import assert from "node:assert/strict";
import { test } from "node:test";

import { artifactText, compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

test("local declaration lists preserve source order and independent carriers", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function combine(seed: int32): int32 {
  let first: int32 = seed + 1, second: int32 = first + 2;
  const third: int32 = second + 3, fourth: int32 = third + 4;
  return fourth;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.equal(source.indexOf("let first: i32") < source.indexOf("let second: i32"), true);
  assert.equal(source.indexOf("let second: i32") < source.indexOf("let third: i32"), true);
  assert.equal(source.indexOf("let third: i32") < source.indexOf("let fourth: i32"), true);
  validateGeneratedProject("local-declaration-list", result.artifacts);
});

test("uninitialized locals retain Rust definite-assignment checking", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function choose(flag: boolean): int32 {
  let result: int32;
  if (flag) {
    result = 10;
  } else {
    result = 20;
  }
  return result;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let result: i32 = if flag \{ 10 \} else \{ 20 \};/u);
  assert.doesNotMatch(source, /allow\(unused_mut\)/u);
  assert.doesNotMatch(source, /result = (?:10|20);/u);
  validateGeneratedProject("local-definite-assignment", result.artifacts);
});

test("uninitialized locals remain mutable when later writes require it", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function revise(flag: boolean): int32 {
  let result: int32;
  result = 10;
  if (flag) {
    result = 20;
  }
  return result;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let mut result: i32 = 10;/u);
  assert.match(source, /result = 20;/u);
  validateGeneratedProject("local-uninitialized-mutation", result.artifacts);
});

test("branch-local setup folds into one conditional initializer", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function choose(flag: boolean): int32 {
  let result: int32;
  if (flag) {
    const base: int32 = 9;
    result = base + 1;
  } else {
    const base: int32 = 19;
    result = base + 1;
  }
  return result;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let result: i32 = if flag \{\n\s*let base: i32 = 9;\n\s*base \+ 1\n\s*\} else \{/u);
  assert.doesNotMatch(source, /needless_late_init/u);
  validateGeneratedProject("local-branch-setup-initializer", result.artifacts);
});

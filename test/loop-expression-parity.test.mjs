import assert from "node:assert/strict";
import { test } from "node:test";

import { artifactText, compileRust } from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("for incrementors consume the same finalized assignment operations as statements", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function sum(step: int32): int32 {
  let total: int32 = 0;
  for (let current: int32 = 0; current < 6; current += step) {
    total += current;
  }
  return total;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /current \+= step;/u);
  assert.match(source, /total \+= current;/u);
  validateGeneratedProject("for-assignment-incrementor", result.artifacts);
});

test("general planned expressions can be evaluated and discarded", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function unchanged(value: int32): int32 {
  value + 1;
  return value;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let _ = value \+ 1;/u);
  validateGeneratedProject("discarded-expression", result.artifacts);
});

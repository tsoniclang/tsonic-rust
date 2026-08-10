import assert from "node:assert/strict";
import { test } from "node:test";

import { artifactText, compileRust } from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

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
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /'__tsonic_loop(?:_\d+)?: loop \{/u);
  assert.match(source, /if current >= limit \{/u);
  assert.match(source, /continue '__tsonic_loop(?:_\d+)?;/u);
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

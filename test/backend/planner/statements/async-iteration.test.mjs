import assert from "node:assert/strict";
import { test } from "node:test";

import { acmeTestingPackage, artifactText, compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

const imports = `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";
`;

test("for-await consumes an async generator through exact iteration evidence", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "async_iteration" } },
    files: {
      "index.ts": `
${imports}
async function* rows(): AsyncGenerator<int32, int32, void> {
  yield 2;
  yield 3;
  return 0;
}

export async function main(): Promise<void> {
  let total: int32 = 0;
  for await (const row of rows()) {
    total += row;
  }
  check(total === 5);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /while let Some\(row\) = async_iterator(?:_\d+)?\.next_yield\(\)\.await/u);
  assert.equal(validateGeneratedProject("async-iteration", result.artifacts, { run: true }).status, 0);
});

test("for-await adapts sync generators and arrays without async runtime overhead", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "sync_async_adaptation" } },
    files: {
      "index.ts": `
${imports}
function* rows(): Generator<int32, int32, void> {
  yield 2;
  yield 3;
  return 0;
}

export async function main(): Promise<void> {
  let total: int32 = 0;
  for await (const row of rows()) {
    total += row;
  }
  const values: readonly int32[] = [4, 5];
  for await (const value of values) {
    total += value;
  }
  check(total === 14);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /for row in rows\(\)/u);
  assert.match(source, /for value in rt::iter_copied\(&values\)/u);
  assert.doesNotMatch(source, /next_yield/u);
  assert.equal(validateGeneratedProject("sync-async-adaptation", result.artifacts, { run: true }).status, 0);
});

test("generated async-iterator locals are hygienic", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

async function* rows(): AsyncGenerator<int32, int32, void> {
  yield 1;
  return 0;
}

export async function total(): Promise<int32> {
  const __tsonic_async_iterator: int32 = 4;
  let result: int32 = __tsonic_async_iterator;
  for await (const row of rows()) {
    result += row;
  }
  return result;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let async_iterator = rows\(\);/u);
  assert.match(source, /let tsonic_async_iterator: i32 = 4;/u);
});

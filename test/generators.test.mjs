import { test } from "node:test";
import assert from "node:assert/strict";
import { acmeTestingPackage, artifactText, compileRust } from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

const generatorTypes = `import type { int32 } from "@tsonic/core/types.js";`;

test("sync generators preserve exact yield, return, and next carriers", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
${generatorTypes}

export function* exchange(seed: int32): Generator<int32, int32, int32> {
  const resumed: int32 = yield seed;
  yield resumed;
  return resumed + 1;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn exchange\(seed: i32\) -> rt::Generator<i32, i32, i32>/u);
  assert.match(source, /rt::Generator::new\(move \|__tsonic_generator\| async move \{/u);
  assert.match(source, /let resumed: i32 = __tsonic_generator\.yield_value\(seed\)\.await;/u);
  assert.match(source, /__tsonic_generator\.yield_value\(resumed\)\.await;/u);
});

test("async generators use the native async-generator carrier", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
${generatorTypes}

export async function* exchange(seed: int32): AsyncGenerator<int32, int32, int32> {
  const resumed: int32 = yield seed;
  return resumed;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn exchange\(seed: i32\) -> rt::AsyncGenerator<i32, i32, i32>/u);
  assert.match(source, /rt::AsyncGenerator::new\(move \|__tsonic_generator\| async move \{/u);
});

test("generated sync and async generator declarations pass Cargo", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
${generatorTypes}

export function* syncValues(seed: int32): Generator<int32, int32, int32> {
  const resumed: int32 = yield seed;
  return resumed;
}

export async function* asyncValues(seed: int32): AsyncGenerator<int32, int32, int32> {
  const resumed: int32 = yield seed;
  return resumed;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("generator-declarations", result.artifacts);
});

test("generator next values and explicit completion execute end to end", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "generator_protocol" } },
    files: {
      "index.ts": `
${generatorTypes}
import { check } from "@acme/testing";

function* exchange(seed: int32): Generator<int32, int32, int32> {
  const resumed: int32 = yield seed;
  return resumed + 1;
}

export function main(): void {
  const generator = exchange(7);
  const first = generator.next();
  check(!first.done);
  if (!first.done) {
    check(first.value === 7);
  }
  const completed = generator.next(41);
  check(completed.done === true);
  if (completed.done) {
    check(completed.value === 42);
  }

  const closed = exchange(1);
  const returned = closed.return(9);
  check(returned.done === true);
  if (returned.done) {
    check(returned.value === 9);
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("generator-protocol", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("async generator protocol calls retain Future evidence", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
${generatorTypes}

async function* values(): AsyncGenerator<int32, int32, int32> {
  const resumed: int32 = yield 1;
  return resumed;
}

export async function read(): Promise<int32> {
  const generator = values();
  const first = await generator.next();
  if (!first.done) {
    return first.value;
  }
  return 0;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /generator\.resume\(\)\.await/u);
});

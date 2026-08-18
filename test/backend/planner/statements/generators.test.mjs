import { test } from "node:test";
import assert from "node:assert/strict";
import { acmeTestingPackage, artifactText, compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

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
  assert.match(source, /rt::Generator::new\(move \|generator(?:_\d+)?\| async move \{/u);
  assert.match(source, /let resumed: i32 = match generator(?:_\d+)?\.yield_value\(seed\)\.await \{/u);
  assert.match(source, /rt::GeneratorResume::Next/u);
  assert.match(source, /rt::GeneratorResume::Return/u);
  assert.match(source, /rt::GeneratorResume::Throw/u);
  assert.match(source, /match generator(?:_\d+)?\.yield_value\(resumed\)\.await \{/u);
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
  assert.match(source, /rt::AsyncGenerator::new\(move \|generator(?:_\d+)?\| async move \{/u);
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

test("generator completion scopes use the exact TReturn carrier", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
${generatorTypes}

function* guarded(): Generator<int32, string, int32> {
  try {
    yield 1;
    return "free";
  } finally {
  }
}

class Values {
  constructor() {}

  static *items(): Generator<int32, string, int32> {
    try {
      yield 2;
      return "method";
    } finally {
    }
  }
}

export function run(): void {
  const _values = new Values();
  guarded().next();
  Values.items().next();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  const completionTypes = [...source.matchAll(/rt::Completion<([^>\n]+)>/gu)]
    .map((match) => match[1]);
  assert.equal(completionTypes.length > 0, true);
  assert.deepEqual([...new Set(completionTypes)], ["String"]);
  validateGeneratedProject("generator-completion-return-carrier", result.artifacts);
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

test("async generator requests queue concurrently in FIFO order", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "async_generator_queue" } },
    files: {
      "index.ts": `
${generatorTypes}
import { check } from "@acme/testing";

async function* rows(): AsyncGenerator<int32, int32, int32> {
  const first: int32 = yield 1;
  const second: int32 = yield first;
  yield second;
  return 12;
}

export async function main(): Promise<void> {
  const generator = rows();
  const first = generator.next();
  const second = generator.next(7);
  const third = generator.next(9);
  const firstResult = await first;
  const secondResult = await second;
  const thirdResult = await third;
  if (!firstResult.done) check(firstResult.value === 1);
  if (!secondResult.done) check(secondResult.value === 7);
  if (!thirdResult.done) check(thirdResult.value === 9);
  const completed = await generator.next(11);
  if (completed.done) check(completed.value === 12);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let first = generator\.resume\(\);/u);
  assert.match(source, /let second = generator\.resume_with\(7\);/u);
  const run = validateGeneratedProject("async-generator-queue", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("generic generators publish exact static obligations and pass Cargo", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export function* exchange<A, B, C>(initial: A, completed: B): Generator<A, B, C> {
  const _next: C = yield initial;
  return completed;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /exchange<A: 'static, B: 'static, C: 'static>/u);
  validateGeneratedProject("generic-generator", result.artifacts);
});

test("yield star forwards yields, next values, and completion", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "generator_delegation" } },
    files: {
      "index.ts": `
${generatorTypes}
import { check } from "@acme/testing";

function* inner(): Generator<int32, int32, int32> {
  const resumed: int32 = yield 3;
  yield resumed;
  return 9;
}

function* outer(): Generator<int32, int32, int32> {
  return yield* inner();
}

export function main(): void {
  const generator = outer();
  const first = generator.next();
  if (!first.done) check(first.value === 3);
  const second = generator.next(7);
  if (!second.done) check(second.value === 7);
  const completed = generator.next(0);
  if (completed.done) check(completed.value === 9);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /yield_from\(inner\(\)\)\.await/u);
  const run = validateGeneratedProject("generator-delegation", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("generator throw closes through the exact Rust error lane", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
${generatorTypes}

function* values(): Generator<int32, int32, int32> {
  yield 1;
  return 2;
}

export function close(): void {
  const generator = values();
  generator.next();
  try {
    generator.throw(new Error("stop"));
  } catch {}
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /generator\s*\.throw_value\(rt::JsError::error/u);
  validateGeneratedProject("generator-throw", result.artifacts);
});

test("sync generator commands execute catch, finally, and delegated cleanup", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "generator_cleanup" } },
    files: {
      "index.ts": `
${generatorTypes}
import { check } from "@acme/testing";

let cleanup: int32 = 0;

function* guarded(): Generator<int32, int32, int32> {
  try {
    yield 1;
    return 2;
  } finally {
    cleanup += 1;
  }
}

function* catches(): Generator<int32, int32, int32> {
  try {
    yield 3;
  } catch {
    yield 4;
  } finally {
    cleanup += 10;
  }
  return 5;
}

function* inner(): Generator<int32, int32, int32> {
  try {
    yield 6;
    return 7;
  } finally {
    cleanup += 100;
  }
}

function* outer(): Generator<int32, int32, int32> {
  return yield* inner();
}

export function main(): void {
  const returned = guarded();
  returned.next();
  const returnResult = returned.return(9);
  check(returnResult.done === true && returnResult.value === 9);
  check(cleanup === 1);

  const caught = catches();
  caught.next();
  const caughtResult = caught.throw(new Error("caught"));
  check(caughtResult.done !== true && caughtResult.value === 4);
  const caughtCompletion = caught.next();
  check(caughtCompletion.done === true && caughtCompletion.value === 5);
  check(cleanup === 11);

  const delegated = outer();
  delegated.next();
  const delegatedResult = delegated.return(12);
  check(delegatedResult.done === true && delegatedResult.value === 12);
  check(cleanup === 111);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /rt::GeneratorResume::Return/u);
  assert.match(source, /rt::GeneratorResume::Throw/u);
  assert.match(source, /rt::finish_finally/u);
  assert.equal(validateGeneratedProject("generator-cleanup", result.artifacts, { run: true }).status, 0);
});

test("async generator return and throw commands execute cleanup", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "async_generator_cleanup" } },
    files: {
      "index.ts": `
${generatorTypes}
import { check } from "@acme/testing";

let cleanup: int32 = 0;

async function* guarded(delta: int32): AsyncGenerator<int32, int32, int32> {
  try {
    yield delta;
    return 2;
  } finally {
    cleanup += delta;
  }
}

export async function main(): Promise<void> {
  const returned = guarded(1);
  await returned.next();
  const returnResult = await returned.return(9);
  check(returnResult.done === true && returnResult.value === 9);
  check(cleanup === 1);

  const thrown = guarded(10);
  await thrown.next();
  let observed = false;
  try {
    await thrown.throw(new Error("stop"));
  } catch {
    observed = true;
  }
  check(observed);
  check(cleanup === 11);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /return_value\(9\)\.await/u);
  assert.match(source, /throw_value\(rt::JsError::error/u);
  assert.equal(validateGeneratedProject("async-generator-cleanup", result.artifacts, { run: true }).status, 0);
});

test("static generator methods use the same exact native protocol", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
${generatorTypes}

class Values {
  constructor() {}
  static *items(): Generator<int32, void, void> {
    yield 1;
  }
}

export function run(): void {
  const _values = new Values();
  Values.items().next();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn items\(\) -> rt::Generator<i32, \(\), \(\)>/u);
  validateGeneratedProject("static-generator-method", result.artifacts);
});

test("instance generator methods retain self through a lifetime-bound carrier", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
${generatorTypes}

class Values {
  value: int32;

  constructor(value: int32) {
    this.value = value;
  }

  *items(): Generator<int32, void, void> {
    yield this.value;
  }
}

export function run(): void {
  const values = new Values(1);
  values.items().next();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /-> rt::BorrowedGenerator<'_, i32, \(\), \(\)>/u);
  assert.match(source, /rt::BorrowedGenerator::new/u);
  validateGeneratedProject("instance-generator-method", result.artifacts);
});

test("instance async generator methods retain self through a lifetime-bound carrier", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
${generatorTypes}

class Values {
  value: int32;

  constructor(value: int32) {
    this.value = value;
  }

  async *items(): AsyncGenerator<int32, void, void> {
    yield this.value;
  }
}

export async function run(): Promise<void> {
  const values = new Values(1);
  await values.items().next();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /-> rt::BorrowedAsyncGenerator<'_, i32, \(\), \(\)>/u);
  assert.match(source, /rt::BorrowedAsyncGenerator::new/u);
  validateGeneratedProject("instance-async-generator-method", result.artifacts);
});

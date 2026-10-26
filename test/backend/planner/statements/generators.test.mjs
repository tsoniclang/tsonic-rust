import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeFunction, nativeNodes } from "../../../helpers/native-ast.mjs";
import { acmeTestingPackage, artifactText, compileRust, analyzeRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { planGeneratorResumeExpression } from "../../../../dist/backend/planner/expressions/generator-resume.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { getRustGeneratorProtocol } from "../../../../dist/target-model/types/carriers/callables.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { rustCompletionDispatchResultWrapped } from "../../../../dist/backend/planner/statements/resource-management.js";

const generatorTypes = `import type { int32 } from "@tsonic/core/types.js";`;

test("generator bodies consume one sealed physical throw disposition across all body forms", () => {
  const { program } = analyzeRust({ files: { "index.ts": `${generatorTypes}
    export function* declared(): Generator<int32, int32, int32> { yield 1; return 2; }
    export class Values { static *items(): Generator<int32, int32, int32> { yield 3; return 4; } }
    export const expression = function* (): Generator<int32, int32, int32> { yield 5; return 6; };
  ` } });
  const ast = program.source.ast;
  let count = 0;
  const visit = node => {
    const generator = program.records.generator.get(node);
    if (generator !== undefined) {
      count += 1;
      const selected = program.records.callableReturn.get(node);
      const physical = getRustGeneratorProtocol(selected.outward)?.physical;
      assert.equal(selected.generatorError?.uninhabited, true, "the actual infallible physical generator disposition was sealed once");
      assert.equal(physical !== undefined && rustTargetTypeRefEquals(selected.generatorError.carrier, physical.errorCarrier), true,
        "the disposition belongs to that identical physical generator error carrier");
      const errorType = { kind: "named", path: "core::convert::Infallible" };
      const context = { syntheticNames: createRustSyntheticNameState(ast, node, []), usedAliases: new Set(),
        returnResult: { errorType }, functionReturnType: { kind: "primitive", name: "i32" },
        generator: { declaration: node, controllerName: "generator", protocol: generator, errorUninhabited: selected.generatorError.uninhabited } };
      const resume = { kind: "path", path: "resume" };
      const uninhabited = planGeneratorResumeExpression(resume, context).arms[2].expression;
      assert.equal(uninhabited.kind === "match" && uninhabited.arms.length === 0, true,
        "the renderer empty-matches the impossible incoming error without introducing Err?");
      const inhabitedError = { kind: "named", path: "NativeError" };
      const inhabited = planGeneratorResumeExpression(resume, { ...context, returnResult: { errorType: inhabitedError },
        generator: { ...context.generator, errorUninhabited: false } }).arms[2].expression;
      assert.equal(inhabited.kind === "try" && inhabited.operandErrorType === inhabitedError && inhabited.resultErrorType === inhabitedError, true,
        "an inhabited disposition retains its exact established native error propagation");
      assert.throws(() => planGeneratorResumeExpression(resume, { ...context,
        generator: { ...context.generator, errorUninhabited: undefined } }), /native name scope and body error carrier/u,
        "a missing disposition is never guessed from an error type spelling");
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  assert.equal(count, 3, "declaration, method and captured-expression body constructors share the required disposition");
});

test("completion return wrapping follows the nearest actual return target", () => {
  const result = { errorType: { kind: "named", path: "NativeError" } };
  assert.equal(rustCompletionDispatchResultWrapped({}), false, "an ordinary native value function stays unwrapped");
  assert.equal(rustCompletionDispatchResultWrapped({ returnResult: result }), true,
    "a generator Result ABI remains wrapped without inhabited throw effects");
  assert.equal(rustCompletionDispatchResultWrapped({ completionBoundary: { fallible: false }, returnResult: result }), false,
    "a pure nearest Completion boundary takes priority over its outer Result callable");
  assert.equal(rustCompletionDispatchResultWrapped({ completionBoundary: { fallible: true } }), true,
    "a fallible nearest Completion boundary retains its own exact Result shape");
});

for (const form of ["declaration", "method", "expression"]) {
  test(`generator completion Results preserve nested finally overrides for ${form}`, { timeout: 300_000 }, () => {
    const body = `
      try {
        try { yield seed; return 2; }
        finally { finalized += 1; }
      } finally { finalized += 10; return 3; }
    `;
    const declaration = form === "declaration"
      ? `function* values(seed: int32): Generator<int32, int32, int32> { ${body} }`
      : form === "method" ? `class Values { static *items(seed: int32): Generator<int32, int32, int32> { ${body} } }`
      : `const values = function* (seed: int32): Generator<int32, int32, int32> { ${body} };`;
    const invocation = form === "method" ? "Values.items(1)" : "values(1)";
    const { result } = compileRust({ target: { id: "rust", options: { outputType: "bin", crateName: `generator_finally_${form}` } },
      files: { "index.ts": `${generatorTypes}
        let finalized: int32 = 0;
        ${declaration}
        export function main(): void {
          const current = ${invocation};
          const first = current.next();
          if (first.done || first.value !== 1) throw new Error("original yield");
          const last = current.return(30);
          if (!last.done || last.value !== 3 || finalized !== 11) throw new Error("finally override or cleanup order");
        }
        main();
      ` } });
    assertNoTargetDiagnostics(result.diagnostics);
    assert.equal(validateGeneratedProject(`generator-finally-${form}`, result.artifacts, { run: true }).status, 0,
      "the required native Result retains both cleanup scopes and the authored final override");
  });
}

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

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn exchange\(seed: i32\) -> rt::Generator<i32, i32, i32, core::convert::Infallible>/u);
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

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn exchange\(seed: i32\) -> rt::AsyncGenerator<i32, i32, i32, core::convert::Infallible>/u);
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

  assertNoTargetDiagnostics(result.diagnostics);
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

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  const completionTypes = [...source.matchAll(/rt::Completion<([^>\n]+)>/gu)]
    .map((match) => match[1]);
  assert.equal(completionTypes.length > 0, true);
  assert.deepEqual([...new Set(completionTypes)], ["String, ()"]);
  validateGeneratedProject("generator-completion-return-carrier", result.artifacts);
});

test("generator next values and explicit completion execute end to end", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "generator_protocol" } },
    files: {
      "index.ts": (`
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
` + "\nmain();\n"),
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
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

  assertNoTargetDiagnostics(result.diagnostics);
  assert.match(artifactText(result, "src/index.rs"), /generator\.resume\(\)\.await/u);
});

test("async generator requests queue concurrently in FIFO order", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "async_generator_queue" } },
    files: {
      "index.ts": (`
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
` + "\nawait main();\n"),
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
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

  assertNoTargetDiagnostics(result.diagnostics);
  const exchange = nativeFunction(result, "exchange");
  for (const name of ["A", "B", "C"]) {
    const parameter = exchange.generics.parameters.find(value => value.kind === "type" && value.name === name);
    assert.equal(parameter !== undefined, true, `exact generic ${name}`);
    assert.equal(nativeNodes(parameter.bounds, value => value.kind === "lifetime" && value.lifetime?.kind === "static").length,
      1, `${name} retains the required static obligation`);
  }
  validateGeneratedProject("generic-generator", result.artifacts);
});

test("yield star forwards yields, next values, and completion", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "generator_delegation" } },
    files: {
      "index.ts": (`
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
` + "\nmain();\n"),
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  assert.match(artifactText(result, "src/index.rs"), /yield_from\(inner\(\)\)\.await/u);
  const run = validateGeneratedProject("generator-delegation", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

for (const asynchronous of [false, true]) test(`${asynchronous ? "async" : "sync"} generator source throw-in is refused before publication`, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
${generatorTypes}

${asynchronous ? "async " : ""}function* values(): ${asynchronous ? "AsyncGenerator" : "Generator"}<int32, int32, int32> {
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

  assert.equal(result.artifacts.length, 0, "source throw-in publishes no native artifact");
  assert.equal(result.program === undefined, true, "source throw-in is refused before sealing");
  assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "TSONIC_GENERATOR_THROW_UNSUPPORTED" &&
    diagnostic.message === "Generator throw-in is not supported."), true, "the exact builtin source operation is refused");
});

test("sync generator commands execute catch, finally, and delegated cleanup", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "generator_cleanup" } },
    files: {
      "index.ts": (`
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
    throw new Error("caught");
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
  const caughtResult = caught.next();
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
` + "\nmain();\n"),
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /rt::GeneratorResume::Return/u);
  assert.match(source, /rt::GeneratorResume::Throw/u);
  assert.match(source, /rt::finish_finally/u);
  assert.equal(validateGeneratedProject("generator-cleanup", result.artifacts, { run: true }).status, 0);
});

test("async generator return and body errors execute cleanup", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "async_generator_cleanup" } },
    files: {
      "index.ts": (`
${generatorTypes}
import { check } from "@acme/testing";

let cleanup: int32 = 0;

async function* guarded(delta: int32): AsyncGenerator<int32, int32, int32> {
  try {
    yield delta;
    if (delta === 10) throw new Error("stop");
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
    await thrown.next();
  } catch {
    observed = true;
  }
  check(observed);
  check(cleanup === 11);
}
` + "\nawait main();\n"),
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /return_value\(9\)\.await/u);
  assert.doesNotMatch(source, /\.throw_value\(/u);
  assert.equal(validateGeneratedProject("async-generator-cleanup", result.artifacts, { run: true }).status, 0);
});

test("static generator methods use the same exact native protocol", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
${generatorTypes}

class Values {
  constructor() {}
  static *items(value: int32): Generator<int32, void, void> {
    yield value;
  }
}

export function run(): void {
  const _values = new Values();
  Values.items(1).next();
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn items\(value: i32\) -> rt::Generator<i32, \(\), \(\), core::convert::Infallible>/u);
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

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /-> rt::BorrowedGenerator<'_, i32, \(\), \(\), core::convert::Infallible>/u);
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

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /-> rt::BorrowedAsyncGenerator<'_, i32, \(\), \(\), core::convert::Infallible>/u);
  assert.match(source, /rt::BorrowedAsyncGenerator::new/u);
  validateGeneratedProject("instance-async-generator-method", result.artifacts);
});

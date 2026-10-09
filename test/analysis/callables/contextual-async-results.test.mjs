import assert from "node:assert/strict";
import test from "node:test";
import { contextualAsyncResultSource, inlineContextualAsyncResultSource, ordinaryAsyncResultSource } from "../../../../tsonic/test/fixtures/contextual-async-results.mjs";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { rustAsyncFunctionFactKey, rustClosureCaptureFactKey, rustGeneratorFactKey, rustModuleBindingFactKey, rustSourceCallableReturnFactKey, rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { recordCallableReturnFact } from "../../../dist/analysis/callables/signatures.js";
import { rustCallableInvocationResult } from "../../../dist/analysis/facts/callable-results.js";
import { rustAwaitSelection, rustAwaitSelectionLeaves } from "../../../dist/target-model/types/await.js";
import { rustOptionElementCarrier } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { finalizedConversionIsValid } from "../../../dist/analysis/facts/finalized-operation/conversions.js";

for (const surfaces of [[], ["js"]]) {
  test(`module suspension return facts use their exact generator or async protocol in ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
export const increment = async (value: number): Promise<number> => value + 1;
export const values = function* (seed: number): Generator<number, number, number> {
  const received: number = yield seed;
  return received;
};
export const asyncValues = async function* (seed: number): AsyncGenerator<number, number, number> {
  const received: number = yield await increment(seed);
  return received;
};
` } });
    const { ast } = program.source;
    const bindings = [];
    const visit = node => {
      if (ast.is.IsVariableDeclaration(node)) {
        const binding = program.facts.getFact(node, rustModuleBindingFactKey);
        if (binding?.callableDeclaration !== undefined) bindings.push(binding);
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.filter(file => ast.getFileName(file).endsWith("/index.ts")).forEach(visit);
    assert.equal(bindings.length, 3, "every suspended module callable retains its finalized binding");
    let generators = 0;
    for (const binding of bindings) {
      const declaration = binding.callableDeclaration;
      const generator = program.facts.getFact(declaration, rustGeneratorFactKey);
      const asynchronous = program.facts.getFact(declaration, rustAsyncFunctionFactKey);
      assert.equal(generator !== undefined || asynchronous !== undefined, true, "one exact suspension protocol");
      if (generator !== undefined) {
        generators += 1;
        assert.equal(asynchronous === undefined, true, "async generators are not ordinary async functions");
      }
      assert.equal(rustTargetTypeRefEquals(program.facts.getFact(declaration, rustSourceCallableReturnFactKey)?.returnCarrier,
        generator?.resultCarrier ?? asynchronous?.outputCarrier), true, "the selected suspension protocol owns the body return");
    }
    assert.equal(generators, 2);
  });
}

test("suspended return publication rejects missing generator and ordinary async evidence independently", () => {
  for (const [label, asynchronous, generator] of [
    ["ordinary async", true, false], ["generator", false, true], ["async generator", true, true],
  ]) {
    const walk = { context: {
      facts: { get: () => undefined },
      ast: { hasModifierKind: () => asynchronous },
      semanticsFor: () => ({ operations: { generator: () => generator ? {} : undefined } }),
    } };
    assert.equal(recordCallableReturnFact(walk, {}) === false, true, label);
  }
});

test("contextual async literals seal the selected output before recording body and invocation facts", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": contextualAsyncResultSource } });
  const { ast } = program.source;
  const literals = [];
  const visit = node => {
    if ((ast.is.IsArrowFunction(node) || ast.is.IsFunctionExpression(node)) && ast.hasModifierKind(node, "async")) literals.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.filter(file => ast.getFileName(file).endsWith("/index.ts")).forEach(visit);
  assert.equal(literals.length, 9);
  let closureCount = 0;
  let nativeFunctionCount = 0;
  for (const [index, literal] of literals.entries()) {
    const asynchronous = program.facts.getFact(literal, rustAsyncFunctionFactKey);
    const closure = program.facts.getFact(literal, rustClosureCaptureFactKey);
    const operation = program.facts.getFact(literal, rustTargetOperationFactKey);
    const declaration = ast.parent(literal);
    const binding = declaration === undefined ? undefined : program.facts.getFact(declaration, rustModuleBindingFactKey);
    const label = `async literal ${index}`;
    assert.equal(asynchronous?.kind, "js-promise", label);
    assert.equal(asynchronous.storage.kind, "static", label);
    assert.equal(rustOptionElementCarrier(asynchronous.outputCarrier) !== undefined, true, label);
    assert.equal(rustTargetTypeRefEquals(program.facts.getFact(literal, rustSourceCallableReturnFactKey)?.returnCarrier,
      asynchronous.outputCarrier), true, `${label} body return`);
    assert.equal(rustTargetTypeRefEquals(rustCallableInvocationResult(program.facts, literal), asynchronous.futureCarrier), true, label);
    assert.equal(asynchronous.futureCarrier.genericArguments[0].lifetime.kind, "static", label);
    assert.equal(asynchronous.futureCarrier.genericArguments[2].type.id, "rust.program.TsonicError", label);
    if (binding?.storage === "native-callable") {
      nativeFunctionCount += 1;
      assert.equal(ast.is.IsVariableDeclaration(declaration), true, label);
      assert.equal(ast.variableDeclarationKind(declaration), "const", label);
      assert.equal(binding.callableDeclaration === literal, true, label);
      assert.equal(binding.value === undefined, true, `${label} direct native calls require no callable wrapper`);
      assert.equal(closure === undefined, true, `${label} native function has no capture wrapper`);
      assert.equal(operation === undefined, true, `${label} native function has no closure operation`);
    } else {
      closureCount += 1;
      assert.equal(closure !== undefined, true, label);
      assert.equal(operation?.kind, "closure", label);
      const conversion = operation.invocationResult;
      assert.equal(conversion !== undefined, true, `${label} contextual union injection is required`);
      assert.equal(finalizedConversionIsValid(conversion, program.typeDefinitions), true, label);
      assert.equal(conversion.fallible, false, `${label} result injection`);
      assert.equal(rustTargetTypeRefEquals(conversion.sourceCarrier, asynchronous.futureCarrier), true, label);
      const selected = rustAwaitSelection(conversion.targetCarrier, program.typeDefinitions);
      assert.equal(selected !== undefined, true, label);
      const promises = rustAwaitSelectionLeaves(selected).filter(leaf => leaf.future !== undefined);
      assert.equal(promises.length, 1, label);
      assert.equal(rustTargetTypeRefEquals(promises[0].future.outputCarrier, asynchronous.outputCarrier), true, label);
    }
  }
  assert.equal(closureCount, 7);
  assert.equal(nativeFunctionCount, 2);
});

for (const surfaces of [[], ["js"]]) {
  test(`explicit async output annotations and native integer width stay exact in ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": ordinaryAsyncResultSource } });
    const { ast } = program.source;
    const visit = node => {
      if ((ast.is.IsArrowFunction(node) || ast.is.IsFunctionExpression(node)) && ast.hasModifierKind(node, "async")) {
        const selected = program.facts.getFact(node, rustAsyncFunctionFactKey);
        assert.equal(selected !== undefined, true, "async integer literal");
        assert.equal(selected.kind, surfaces.length === 0 ? "native-future" : "js-promise");
        assert.equal(selected.outputCarrier.kind, "source-primitive");
        assert.equal(selected.outputCarrier.name, "int64");
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.filter(file => ast.getFileName(file).endsWith("/index.ts")).forEach(visit);
  });
}

test("ambiguous declared contextual Promise alternatives reject at the async owner without publishing executable output", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
type Completion = void | Promise<string | void> | Promise<number | void>;
export function make(): () => Completion { return async () => {}; }
` } });
  assert.equal(result.artifacts.length, 0);
  assert.equal(result.diagnostics.some(row => row.code === "RUST_SOURCE_UNION_NOT_CLOSED"), false,
    "the declared contextual union must close before async ambiguity selection");
  assert.equal(result.diagnostics.some(row => row.code === "RUST_ASYNC_CONTEXTUAL_PROMISE_NOT_CLOSED"), true,
    result.diagnostics.map(row => row.code).join(", "));
});

test("inline contextual async unions retain the proven promise lifetime and exact generic payloads", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": inlineContextualAsyncResultSource } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.code).join(", "));
  assert.equal(result.artifacts.length > 0, true);
});

for (const alternatives of ["Promise<string | void> | Promise<number | void>",
  "Promise<number | void> | Promise<string | void>"]) {
  test(`ambiguous inline contextual Promise alternatives reject at the async owner: ${alternatives}`, () => {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
export function make(): () => (void | ${alternatives}) { return async () => {}; }
` } });
    assert.equal(result.artifacts.length, 0);
    assert.equal(result.diagnostics.some(row => row.code === "RUST_SOURCE_UNION_NOT_CLOSED"), false,
      "the async ambiguity probe requires a closed contextual union, not a pending declared alias");
    assert.equal(result.diagnostics.some(row => row.code === "RUST_ASYNC_CONTEXTUAL_PROMISE_NOT_CLOSED"), true,
      result.diagnostics.map(row => row.code).join(", "));
  });
}

for (const [label, source] of [
  ["explicit async annotation", `
export function make(): () => Promise<number | void> {
  return async (): Promise<void> => {};
}
`],
  ["already constructed promise", `
export function make(pending: Promise<void>): () => Promise<number | void> {
  return () => pending;
}
`],
]) {
  test(`${label} is never reinterpreted by contextual async body selection`, () => {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": source } });
    assert.equal(result.artifacts.length, 0, "invariant constructed promise cannot be reinterpreted");
    assert.equal(result.diagnostics.length > 0, true);
  });
}

test("contextual async result selection preserves source checking of required body results", () => {
  assert.throws(() => compileRust({ surfaces: ["js"], files: { "index.ts": `
export function make(): () => Promise<number> { return async () => {}; }
` } }), /TS2322/u);
});

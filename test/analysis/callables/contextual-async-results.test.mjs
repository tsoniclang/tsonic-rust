import assert from "node:assert/strict";
import test from "node:test";
import { contextualAsyncResultSource, ordinaryAsyncResultSource } from "../../../../tsonic/test/fixtures/contextual-async-results.mjs";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { rustAsyncFunctionFactKey, rustClosureCaptureFactKey, rustSourceCallableReturnFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustCallableInvocationResult } from "../../../dist/analysis/facts/callable-results.js";
import { rustAwaitSelection, rustAwaitSelectionLeaves } from "../../../dist/target-model/types/await.js";
import { rustOptionElementCarrier } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { finalizedConversionIsValid } from "../../../dist/analysis/facts/finalized-operation/conversions.js";

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
  for (const [index, literal] of literals.entries()) {
    const asynchronous = program.facts.getFact(literal, rustAsyncFunctionFactKey);
    const closure = program.facts.getFact(literal, rustClosureCaptureFactKey);
    const label = `async literal ${index}`;
    assert.equal(asynchronous?.kind, "js-promise", label);
    assert.equal(asynchronous.storage.kind, "static", label);
    assert.equal(rustOptionElementCarrier(asynchronous.outputCarrier) !== undefined, true, label);
    assert.equal(rustTargetTypeRefEquals(program.facts.getFact(literal, rustSourceCallableReturnFactKey)?.returnCarrier,
      asynchronous.outputCarrier), true, `${label} body return`);
    assert.equal(rustTargetTypeRefEquals(rustCallableInvocationResult(program.facts, literal), asynchronous.futureCarrier), true, label);
    assert.equal(asynchronous.futureCarrier.genericArguments[0].lifetime.kind, "static", label);
    assert.equal(asynchronous.futureCarrier.genericArguments[2].type.id, "rust.program.TsonicError", label);
    assert.equal(closure !== undefined, true, label);
    if (closure.invocationResult !== undefined) {
      assert.equal(finalizedConversionIsValid(closure.invocationResult, program.typeDefinitions), true, label);
      assert.equal(closure.invocationResult.fallible, false, `${label} result injection`);
      assert.equal(rustTargetTypeRefEquals(closure.invocationResult.sourceCarrier, asynchronous.futureCarrier), true, label);
      const selected = rustAwaitSelection(closure.invocationResult.targetCarrier, program.typeDefinitions);
      assert.equal(selected !== undefined, true, label);
      const promises = rustAwaitSelectionLeaves(selected).filter(leaf => leaf.future !== undefined);
      assert.equal(promises.length, 1, label);
      assert.equal(rustTargetTypeRefEquals(promises[0].future.outputCarrier, asynchronous.outputCarrier), true, label);
    }
  }
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

test("ambiguous contextual Promise alternatives reject without publishing executable output", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
type Completion = void | Promise<string | void> | Promise<number | void>;
export function make(): () => Completion { return async () => {}; }
` } });
  assert.equal(result.artifacts.length, 0);
  assert.equal(result.diagnostics.some(row => row.code === "RUST_ASYNC_CONTEXTUAL_PROMISE_NOT_CLOSED"), true,
    result.diagnostics.map(row => row.code).join(", "));
});

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

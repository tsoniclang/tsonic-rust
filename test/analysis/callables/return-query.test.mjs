import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { createRustSourceCallableReturnProducer } from "../../../dist/analysis/program/records/callables/source-callable-return.js";
import { createRustRetainedEnvironmentProducer } from "../../../dist/analysis/program/records/callables/retained-environment.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { selectedSourceCallableReturn, selectRustCallableLogicalReturn } from "../../../dist/analysis/callables/calls/source-callable-abi.js";

const integer = { kind: "source-primitive", name: "int32" };
const text = { kind: "target-named", id: "rust.std.String" };
const header = 'import type { int32 } from "@tsonic/core/types.js";';

function fixture(source = "export function step(): int32 { return 3; }") {
  let walk;
  let declaration;
  analyzeRustErrorEffects(header + source, { surfaces: [] }, context => ({
    ...context,
    records: {
      ...context.records,
      sourceCallableReturns: {
        ...context.records.sourceCallableReturns,
        resolve(current, subject, carrier) {
          if (context.ast.is.IsFunctionDeclaration(subject) && context.ast.text(context.ast.name(subject)) === "step") {
            walk = current;
            declaration = subject;
          }
          return context.records.sourceCallableReturns.resolve(current, subject, carrier);
        },
      },
    },
  }));
  assert.equal(walk !== undefined && declaration !== undefined, true, "capture the actual checked source-return query");
  let closed = false;
  let completions = 0;
  const assertOpen = () => { if (closed) throw new Error("query is sealed"); };
  const environments = createRustRetainedEnvironmentProducer(assertOpen);
  const producer = createRustSourceCallableReturnProducer(assertOpen, environments);
  const query = { ...walk, context: { ...walk.context, semanticsFor(subject) {
    const semantics = walk.context.semanticsFor(subject);
    return { ...semantics, operations: { ...semantics.operations, callableCompletion(...arguments_) {
      completions++;
      return semantics.operations.callableCompletion(...arguments_);
    } } };
  } } };
  return { walk: query, declaration, producer, environments, assertOpen,
    completions: () => completions, close() { closed = true; } };
}

test("complete return queries keep exact completion and cache successful explicit and implicit requests", () => {
  const current = fixture();
  assert.equal(current.producer.resolve(current.walk, current.declaration, integer), true);
  const original = current.producer.records.get(current.declaration);
  assert.equal(original.returnCarrier === integer, true, "retain the selected native carrier identity");
  assert.equal(original.canFallThrough, false);
  assert.equal(current.completions(), 1);
  const noSelection = new Proxy({}, { get() { throw new Error("a completed return request is a lookup"); } });
  assert.equal(current.producer.resolve(noSelection, current.declaration), true);
  assert.equal(current.producer.resolve(noSelection, current.declaration, { ...integer }), true);
  assert.equal(current.producer.records.get(current.declaration) === original, true);
  assert.equal(current.completions(), 1, "completed requests do not recompute callable completion");
  const child = createRustSourceCallableReturnProducer(current.assertOpen, current.environments, current.producer.records);
  assert.equal(child.resolve(noSelection, current.declaration), true);
  assert.equal(child.records.get(current.declaration) === original, true);
  assert.throws(() => child.setter(current.declaration), /Conflicting Rust semantic plan/u,
    "a setter cannot silently ignore an incompatible inherited integer result");
  assert.equal(child.records.get(current.declaration) === original, true);
  current.close();
  assert.throws(() => current.producer.resolve(noSelection, current.declaration, integer), /query is sealed/u);
  assert.throws(() => current.producer.resolve(noSelection, current.declaration), /query is sealed/u);
  assert.equal(current.completions(), 1);
});

test("getter source returns use exact checked declaration signatures instead of property payload callability", () => {
  const current = fixture(`
    class Reading { get value(): int32 { return 3; } }
    export function step(): int32 { return new Reading().value; }
  `);
  const ast = current.walk.context.ast;
  const getters = [];
  const visit = node => {
    if (ast.is.IsGetAccessorDeclaration(node)) getters.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  current.walk.context.sourceFiles.forEach(visit);
  assert.equal(getters.length, 1);
  const declaration = getters[0];
  const semantics = current.walk.context.semanticsFor(declaration);
  const signature = semantics.types.declarationSignatureInfo(declaration);
  assert.equal(signature !== undefined, true);
  assert.equal(selectedSourceCallableReturn(current.walk, declaration) === signature.returnType, true);
  assert.equal(semantics.types.callSignatures(signature.returnType).length, 0, "the numeric property payload is not the getter signature");
  assert.equal(current.walk.context.records.sourceCallableReturn.get(declaration) !== undefined, true,
    "the actual getter keeps its complete native return record");
});

test("an implicit result validates a new explicit request before it becomes a cached query", () => {
  const current = fixture();
  assert.equal(current.producer.resolve(current.walk, current.declaration), true);
  const canonical = current.producer.records.get(current.declaration);
  assert.equal(current.producer.resolve(current.walk, current.declaration, integer), true);
  assert.equal(current.completions(), 2);
  assert.equal(current.producer.resolve({}, current.declaration, { ...integer }), true);
  assert.equal(current.completions(), 2);
  assert.throws(() => current.producer.resolve(current.walk, current.declaration, text),
    /Conflicting Rust semantic plan 'tsonic\.rust\.sourceCallableReturn'/u);
  assert.equal(current.producer.records.get(current.declaration) === canonical, true);
  assert.equal(current.completions(), 3, "a different native request must pass the complete selector");
});

test("an unavailable complete return query stays retryable and publishes nothing", () => {
  const environments = createRustRetainedEnvironmentProducer(() => {});
  const producer = createRustSourceCallableReturnProducer(() => {}, environments);
  const declaration = {};
  let requests = 0;
  const walk = { context: { records: { generator: { get: () => undefined }, asyncFunction: { get: () => undefined } },
    ast: { hasModifierKind: () => true }, semanticsFor() {
      requests++;
      return { operations: { generator: () => undefined } };
    } } };
  for (let index = 0; index < 2; index++) {
    assert.equal(producer.resolve(walk, declaration, integer), false);
    assert.equal(producer.records.get(declaration) === undefined, true);
    assert.equal(environments.records.get(declaration) === undefined, true);
  }
  assert.equal(requests, 2, "failure does not become completed request state");
});

test("the complete return owner preserves absence and implementation completion metadata", () => {
  const current = fixture('export function step(value: boolean): string | undefined { if (value) return "ready"; }');
  assert.equal(current.producer.resolve(current.walk, current.declaration), true);
  const fact = current.producer.records.get(current.declaration);
  assert.equal(fact.canFallThrough, true);
  assert.equal(fact.undefinedReturn, true);
  assert.equal(fact.fallthroughUndefined, true);
  const canonical = current.walk.context.records.sourceCallableReturn.get(current.declaration);
  assert.equal(rustTargetTypeRefEquals(fact.returnCarrier, canonical.returnCarrier), true);
  assert.equal(fact.implementationCompletion, canonical.implementationCompletion);
});

for (const [name, source, completion, canFallThrough] of [
  ["unit", "export function step(): void {}", "absence", true],
  ["diverging", 'export function step(): never { throw "stop"; }', "diverging", false],
]) test(`complete ${name} return queries keep implementation completion`, () => {
  const current = fixture(source);
  assert.equal(current.producer.resolve(current.walk, current.declaration), true);
  const fact = current.producer.records.get(current.declaration);
  assert.equal(fact.implementationCompletion, completion);
  assert.equal(fact.canFallThrough, canFallThrough);
});

test("a return query waits for every checked parameter ABI before publishing", () => {
  const current = fixture("export function step(value: int32): int32 { return value; }");
  const incomplete = { ...current.walk, context: { ...current.walk.context, records: {
    ...current.walk.context.records, sourceParameterAbi: { get: () => undefined },
  } } };
  assert.equal(current.producer.resolve(incomplete, current.declaration, integer), false);
  assert.equal(current.producer.records.get(current.declaration) === undefined, true);
  assert.equal(current.completions(), 0);
  assert.equal(current.producer.resolve(current.walk, current.declaration, integer), true);
  assert.equal(current.producer.records.get(current.declaration).returnCarrier === integer, true);
  assert.equal(current.completions(), 1, "missing parameter evidence did not poison the completed request cache");
});

test("logical pre-retention requests reuse the complete physical return and native environment", () => {
  const current = fixture('export function step(callback: () => int32): () => int32 { return callback; }');
  const parameter = current.walk.context.ast.parameters(current.declaration)[0];
  const selection = selectRustCallableLogicalReturn(current.walk, current.declaration);
  assert.equal(selection.kind, "complete", "the source owner completes the checked logical contract before physical retention");
  const logical = selection.carrier;
  assert.equal(logical !== undefined, true, "use the checked return annotation before result retention");
  assert.equal(current.producer.resolve(current.walk, current.declaration, logical), true);
  const canonical = current.producer.records.get(current.declaration);
  const environment = current.environments.records.get(current.declaration);
  assert.equal(environment !== undefined, true, "the native returned callback retains its exact checked input");
  assert.equal(environment.inputs.length, 1);
  assert.equal(environment.inputs[0].declaration === parameter, true);
  assert.equal(rustTargetTypeRefEquals(canonical.returnCarrier, logical), false,
    "the request is logical input, not the completed physical return carrier");
  assert.equal(current.producer.resolve({}, current.declaration, logical), true);
  assert.equal(current.producer.records.get(current.declaration) === canonical, true);
  assert.equal(current.environments.records.get(current.declaration) === environment, true);
  assert.equal(current.completions(), 1);
});

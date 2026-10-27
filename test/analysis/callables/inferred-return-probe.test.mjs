import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { selectRustInferredReturn } from "../../../dist/analysis/callables/calls/inferred-return.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { createRustCarrierProbe } from "../../../dist/analysis/program/carrier-probe.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { analyzeRustOperations } from "../../helpers/rust-operation-analysis.mjs";
import { resolveExpressionCarrier } from "../../../dist/analysis/source-evidence/types/resolution/expression-carriers.js";

for (const [name, source, callsSignature] of [
  ["property and callable scope", `
    function named(value: number): number { return value; }
    export function reveal() { return { call: named, size: 3 }.size; }
  `, true],
  ["numeric operands", `export function reveal(value: number) { return -(value + value); }`, false],
  ["conditional receiver", `export function reveal(flag: boolean, value: number) {
    return flag ? { value }.value : value;
  }`, false],
]) test(`inferred ${name} requests stay in their actual probe transaction`, () => {
  let walk;
  const context = analyzeRustErrorEffects(source, { surfaces: [] }, original => ({ ...original,
    records: { ...original.records, typeOnlyDeclarations: { ...original.records.typeOnlyDeclarations,
      finalize(current, files) { walk = current; return original.records.typeOnlyDeclarations.finalize(current, files); },
    } },
  }));
  assert.equal(walk !== undefined, true);
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
    context.ast.text(context.ast.name(node)) === "reveal");
  assert.equal(declaration !== undefined, true);
  const expected = context.records.sourceCallableReturn.get(declaration)?.returnCarrier;
  assert.equal(expected !== undefined, true);
  const scalar = { kind: "source-primitive", name: "float64" };
  const baseline = expected;
  assert.equal(baseline !== undefined, true);
  const original = context.sourceStorage.nodes.map(node => context.records.runtimeCarrier.get(node));
  let scoped = 0;
  const request = { ...walk, inferredReturns: new WeakMap(), resolvingReturns: new Set(),
    operationOptions: { ...walk.operationOptions, callableSignatureCarrier() {
      throw new Error("inferred return used the parent's callable query");
    } },
    callableSignatureCarrierFor(current, selected) {
      assert.equal(current === request, false, "signature resolution receives the actual child transaction");
      scoped++;
      return walk.callableSignatureCarrierFor(current, selected);
    },
  };
  const selected = selectRustInferredReturn(request, declaration, baseline);
  assert.equal(selected.kind, "complete");
  assert.equal(rustTargetTypeRefEquals(selected.carrier, expected), true, "the selected raw native result is unchanged");
  if (callsSignature) {
    const named = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
      context.ast.text(context.ast.name(node)) === "named");
    assert.equal(named !== undefined, true);
    const probe = createRustCarrierProbe(request);
    assert.equal(rustTargetTypeRefEquals(probe.operationOptions.callableSignatureCarrier(named),
      rustCallableTargetType([scalar], scalar)), true, "the actual checked source signature is resolved in its child");
    assert.equal(scoped > 0, true, "the checked callback is explicitly exercised, not inferred from a cached read");
  }
  assert.equal(context.sourceStorage.nodes.every((node, index) => context.records.runtimeCarrier.get(node) === original[index]), true,
    "the parent retains all exact runtime carrier identities");
  assert.equal(walk.inferredReturns === request.inferredReturns, false);
});

function freshRealization(walk, expression, families) {
  const inherited = createRustRecordFixture(Object.fromEntries(families.map(family => [family,
    { get: node => node === expression ? undefined : walk.context.records[family].get(node) }])), walk.context.records);
  return createRustCarrierProbe({ ...walk, context: { ...walk.context,
    records: createRustProgramRecordBuilder(walk.context.typeDefinitions, inherited) } });
}

test("actual candidate method realization never queues an adapter in its parent or sibling", () => {
  const { context, walk } = analyzeRustOperations(`
    interface Identity { apply<Value>(value: Value): Value; }
    function make(): Identity { return { apply<Value>(value: Value): Value { return value; } }; }
    export function run(): number { return make().apply(3); }
  `, { surfaces: [] });
  const expression = context.sourceStorage.nodes.find(node => context.ast.is.IsObjectLiteralExpression(node));
  assert.equal(expression !== undefined, true);
  const carrier = context.records.runtimeCarrier.get(expression)?.carrier;
  assert.equal(carrier !== undefined, true);
  const root = freshRealization(walk, expression, ["runtimeCarrier", "targetOperation", "objectLiteralMethodAdapter"]);
  const candidate = createRustCarrierProbe(root);
  const sibling = createRustCarrierProbe(root);
  const file = context.ast.getSourceFile(expression);
  const failed = createRustCarrierProbe(root);
  assert.equal(resolveExpressionCarrier(failed, expression, file, { kind: "source-primitive", name: "int32" }) === undefined, true,
    "an incompatible native candidate fails in its own transaction");
  assert.equal(root.objectLiteralMethodExpressions.size, 0);
  const foundation = root.context.records.minimumFoundation();
  const selected = resolveExpressionCarrier(candidate, expression, file, carrier);
  assert.equal(selected !== undefined, true, "the actual checked literal is realized in the child");
  assert.equal(candidate.objectLiteralMethodExpressions.has(expression), true, "the child really selects a method adapter");
  assert.equal(root.objectLiteralMethodExpressions.size, 0, "candidate-only obligations do not reach the parent");
  assert.equal(sibling.objectLiteralMethodExpressions.size, 0);
  assert.equal(root.context.records.minimumFoundation(), foundation, "child requests never account native requirements in the parent");
  assert.equal(root.context.records.runtimeCarrier.get(expression) === undefined, true);
  const realized = resolveExpressionCarrier(root, expression, file, carrier);
  assert.equal(realized !== undefined, true);
  assert.equal(resolveExpressionCarrier(root, expression, file, carrier) !== undefined, true);
  assert.equal(root.objectLiteralMethodExpressions.size, 1, "repeated root resolution retains one actual obligation");
  const issues = root.context.records.objectLiteralMethodAdapters.finalize({ ...root.context,
    expressions: root.objectLiteralMethodExpressions });
  assert.equal(issues.length, 0);
  const fact = root.context.records.objectLiteralMethodAdapter.get(expression);
  assert.equal(fact !== undefined, true);
  assert.equal(fact.implementations.length, 1);
  assert.equal(fact.dispatches.length, 1);
});

test("actual deferred provider preparation consumes only the requesting probe's pending call", () => {
  const { context, walk } = analyzeRustOperations("export function twice(values: number[]): number[] { return values.map(value => value * 2); }");
  const expression = context.sourceStorage.nodes.find(node => context.ast.is.IsCallExpression(node));
  assert.equal(expression !== undefined, true);
  const root = freshRealization(walk, expression, ["runtimeCarrier", "targetOperation", "preparedOperationResult", "selectedCall", "selectedOperation"]);
  const candidate = createRustCarrierProbe(root);
  const sibling = createRustCarrierProbe(root);
  const selected = resolveExpressionCarrier(candidate, expression, context.ast.getSourceFile(expression), undefined);
  assert.equal(selected !== undefined, true);
  assert.equal(candidate.preparedCallbackCalls.has(expression), true, "the real provider callback was prepared");
  assert.equal(candidate.context.records.preparedOperationResult.get(expression) !== undefined, true);
  assert.equal(root.preparedCallbackCalls.size, 0);
  assert.equal(root.deferredCallbackCalls.has(expression), false);
  assert.equal(sibling.preparedCallbackCalls.size, 0);
  assert.equal(root.context.records.preparedOperationResult.get(expression) === undefined, true);
  assert.equal(resolveExpressionCarrier(root, expression, context.ast.getSourceFile(expression), undefined) !== undefined, true);
  assert.equal(root.preparedCallbackCalls.size, 1);
  assert.equal(candidate.preparedCallbackCalls.size, 1, "root realization cannot consume the child's prepared completion");
});

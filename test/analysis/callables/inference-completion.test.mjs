import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustOperations } from "../../helpers/rust-operation-analysis.mjs";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { createRustCarrierProbe } from "../../../dist/analysis/program/carrier-probe.js";
import { rustResolutionContext } from "../../../dist/analysis/program/walk.js";
import { selectRustInferredReturn } from "../../../dist/analysis/callables/calls/inferred-return.js";
import { selectedSourceCallableReturn } from "../../../dist/analysis/callables/calls/source-callable-abi.js";
import { resolveRustTargetTypeRef } from "../../../dist/analysis/source-evidence/types/resolution/source.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustOptionTargetType } from "../../../dist/target-model/types/index.js";
import { rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { resolveFunctionExpressionCarrier } from "../../../dist/analysis/callables/values/closures.js";

function fixture(source, name = "width", maskParameters = false) {
  const { context, walk } = analyzeRustOperations(source);
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
    context.ast.text(context.ast.name(node)) === name);
  assert.equal(declaration !== undefined, true);
  const parameters = context.ast.parameters(declaration);
  const inherited = createRustRecordFixture({
    sourceCallableReturn: { get: node => node === declaration ? undefined : context.records.sourceCallableReturn.get(node) },
    sourceParameterAbi: { get: node => maskParameters && parameters.includes(node) ? undefined : context.records.sourceParameterAbi.get(node) },
  }, context.records);
  const current = createRustCarrierProbe({ ...walk, inferredReturns: new WeakMap(), resolvingReturns: new Set(),
    context: { ...context, records: createRustProgramRecordBuilder(context.typeDefinitions, inherited) } });
  const baseline = resolveRustTargetTypeRef(selectedSourceCallableReturn(current, declaration),
    rustResolutionContext(current, declaration), current.operationOptions);
  assert.equal(baseline !== undefined, true);
  return { context, current, declaration, parameters, baseline };
}

test("unannotated active inference is pending, publishes nothing, and retries after its real dependency closes", () => {
  const input = fixture("export function width(value: string) { return value.length; }");
  input.current.resolvingReturns.add(input.declaration);
  const pending = selectRustInferredReturn(input.current, input.declaration, input.baseline);
  assert.equal(pending.kind, "pending");
  assert.equal(input.current.inferredReturns.get(input.current.context.records) === undefined, true);
  assert.equal(input.current.context.records.sourceCallableReturns.resolve(input.current, input.declaration), false);
  assert.equal(input.current.context.records.sourceCallableReturn.get(input.declaration) === undefined, true);
  input.current.resolvingReturns.delete(input.declaration);
  const complete = selectRustInferredReturn(input.current, input.declaration, input.baseline);
  assert.equal(complete.kind, "complete");
  assert.equal(complete.carrier.name, "native-uint");
  assert.equal(input.current.context.records.sourceCallableReturns.resolve(input.current, input.declaration), true);
  assert.equal(rustTargetTypeRefEquals(input.current.context.records.sourceCallableReturn.get(input.declaration).returnCarrier,
    complete.carrier), true);
});

test("a fixed annotated recursive result stays complete without depending on its active body inference", () => {
  const input = fixture("export function recurse(value: number): number { return value <= 0 ? 0 : recurse(value - 1); }", "recurse");
  input.current.resolvingReturns.add(input.declaration);
  const selected = selectRustInferredReturn(input.current, input.declaration, input.baseline);
  assert.equal(selected.kind, "complete");
  assert.equal(selected.carrier === input.baseline, true);
  assert.equal(input.current.inferredReturns.get(input.current.context.records) === undefined, true);
});

test("an unavailable native parameter ABI cannot become a completed checker-baseline result", () => {
  const input = fixture("export function width(value: string) { return value.length; }", "width", true);
  assert.equal(selectRustInferredReturn(input.current, input.declaration, input.baseline).kind, "pending");
  assert.equal(input.current.inferredReturns.get(input.current.context.records) === undefined, true);
  const parameter = input.parameters[0];
  input.current.context.records.sourceParameterAbis.parameter(parameter, input.context.records.sourceParameterAbi.get(parameter));
  const complete = selectRustInferredReturn(input.current, input.declaration, input.baseline);
  assert.equal(complete.kind, "complete");
  assert.equal(complete.carrier.name, "native-uint");
});

test("completed inference includes its full baseline topology", () => {
  const input = fixture("export function width(value: string) { return value.length; }");
  const scalar = selectRustInferredReturn(input.current, input.declaration, input.baseline);
  const optional = selectRustInferredReturn(input.current, input.declaration, rustOptionTargetType(input.baseline));
  assert.equal(scalar.kind, "complete");
  assert.equal(optional.kind, "complete");
  assert.equal(rustTargetTypeRefEquals(optional.carrier, rustOptionTargetType(scalar.carrier)), true);
  assert.equal(rustTargetTypeRefEquals(optional.carrier, scalar.carrier), false);
});

test("shared inference memo answers remain scoped to the actual probe and canonical native ABIs", () => {
  const input = fixture("export function width(value: number) { return value; }");
  const scalar = selectRustInferredReturn(input.current, input.declaration, input.baseline);
  assert.equal(scalar.kind, "complete");
  const parameter = input.parameters[0];
  const inherited = createRustRecordFixture({ sourceParameterAbi: {
    get: node => node === parameter ? undefined : input.current.context.records.sourceParameterAbi.get(node),
  } }, input.current.context.records);
  const child = createRustCarrierProbe({ ...input.current, context: { ...input.current.context,
    records: createRustProgramRecordBuilder(input.current.context.typeDefinitions, inherited) } });
  const integer = { kind: "source-primitive", name: "uint64" };
  child.context.records.sourceParameterAbis.parameter(parameter, {
    ...input.context.records.sourceParameterAbi.get(parameter), valueCarrier: integer, parameterCarrier: integer,
  });
  const selected = selectRustInferredReturn(child, input.declaration, input.baseline);
  assert.equal(selected.kind, "complete");
  assert.equal(rustTargetTypeRefEquals(selected.carrier, integer), true);
  assert.equal(child.inferredReturns === input.current.inferredReturns, true);
  assert.equal(selectRustInferredReturn(input.current, input.declaration, input.baseline).carrier === scalar.carrier, true);
  assert.equal(input.current.context.records.sourceParameterAbi.get(parameter) === input.context.records.sourceParameterAbi.get(parameter), true);
});

test("an unresolved native branch cannot complete through a conditional checker-carrier fallback", () => {
  const input = fixture("function width(value: string) { return value.length; } export function choose(flag: boolean, value: string) { return flag ? width(value) : 0; }", "choose");
  const dependency = input.context.sourceStorage.nodes.find(node => input.context.ast.is.IsFunctionDeclaration(node) &&
    input.context.ast.text(input.context.ast.name(node)) === "width");
  assert.equal(dependency !== undefined, true);
  input.current.resolvingReturns.add(dependency);
  assert.equal(selectRustInferredReturn(input.current, input.declaration, input.baseline).kind, "pending");
  assert.equal(input.current.context.records.sourceCallableReturn.get(input.declaration) === undefined, true);
  input.current.resolvingReturns.delete(dependency);
  const completed = selectRustInferredReturn(input.current, input.declaration, input.baseline);
  assert.equal(completed.kind, "complete");
  assert.equal(rustTargetTypeRefEquals(completed.carrier,
    input.context.records.sourceCallableReturn.get(input.declaration).returnCarrier), true);
});

test("a closure without a selected expected contract cannot publish a pending logical hint", () => {
  const { context, walk } = analyzeRustOperations(`
function width(value: string) { return value.length; }
export function factory(value: string) { return () => width(value); }
`);
  const { ast, records } = context;
  const dependency = context.sourceStorage.nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "width");
  const arrow = context.sourceStorage.nodes.find(node => ast.is.IsArrowFunction(node));
  assert.equal(dependency !== undefined && arrow !== undefined, true);
  const inherited = createRustRecordFixture({ sourceCallableReturn: {
    get: node => node === dependency || node === arrow ? undefined : records.sourceCallableReturn.get(node),
  } }, records);
  const current = createRustCarrierProbe({ ...walk, inferredReturns: new WeakMap(), resolvingReturns: new Set([dependency]),
    context: { ...context, records: createRustProgramRecordBuilder(context.typeDefinitions, inherited) } });
  const sourceFile = ast.getSourceFile(arrow);
  assert.equal(resolveFunctionExpressionCarrier(current, arrow, sourceFile, undefined) === undefined, true);
  assert.equal(current.context.records.sourceCallableReturn.get(arrow) === undefined, true,
    "an unselected logical hint cannot become a final native source return");
  current.resolvingReturns.delete(dependency);
  const complete = resolveFunctionExpressionCarrier(current, arrow, sourceFile, undefined);
  assert.equal(complete !== undefined, true);
  assert.equal(rustCallableProtocol(complete)?.result.name, "native-uint");
});

test("an actual fixed contextual callback completes its logical contract before the body without re-inferring it", () => {
  const { context, walk } = analyzeRustOperations(`
import type { int32 } from "@tsonic/core/types.js";
export function floatingCapture(value: int32): () => number {
  const callback: () => number = () => value;
  return callback;
}
`, { surfaces: [] });
  const { ast, records } = context;
  const arrow = context.sourceStorage.nodes.find(node => ast.is.IsArrowFunction(node));
  assert.equal(arrow !== undefined, true);
  const selected = records.sourceCallableReturn.get(arrow);
  const expected = records.runtimeCarrier.get(ast.parent(arrow))?.carrier;
  assert.equal(selected?.returnCarrier.name, "float64");
  assert.equal(expected !== undefined, true);
  const current = createRustCarrierProbe(walk);
  let requests = 0;
  const query = { ...current, context: { ...current.context, records: { ...current.context.records,
    sourceCallableReturns: { ...current.context.records.sourceCallableReturns,
      resolve(...arguments_) { requests++; return current.context.records.sourceCallableReturns.resolve(...arguments_); },
    },
  } } };
  assert.equal(resolveFunctionExpressionCarrier(query, arrow, ast.getSourceFile(arrow), expected) !== undefined, true);
  assert.equal(query.context.records.sourceCallableReturn.get(arrow) === selected, true);
  assert.equal(requests, 1, "the post-body full query reuses the same selected logical request");
  const conversion = query.context.records.contextualValueConversion.get(ast.body(arrow));
  assert.equal(conversion?.sourceCarrier.name, "int32");
  assert.equal(conversion?.targetCarrier.name, "float64");
});

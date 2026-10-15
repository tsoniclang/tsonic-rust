import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustOperations } from "../../helpers/rust-operation-analysis.mjs";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { createRustCarrierProbe } from "../../../dist/analysis/program/carrier-probe.js";
import { rustResolutionContext } from "../../../dist/analysis/program/walk.js";
import { selectRustInferredReturn } from "../../../dist/analysis/callables/inferred-return.js";
import { selectedSourceCallableReturn } from "../../../dist/analysis/callables/signatures.js";
import { resolveRustTargetTypeRef } from "../../../dist/policy/types/resolution/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustOptionTargetType } from "../../../dist/target-model/types/index.js";

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

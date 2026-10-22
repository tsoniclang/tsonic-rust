import assert from "node:assert/strict";
import test from "node:test";
import { Node_Expression } from "@tsonic/target-api/source";
import { analyzeRustOperations } from "../../../helpers/rust-operation-analysis.mjs";
import { createRustCarrierProbe } from "../../../../dist/analysis/program/carrier-probe.js";
import { rustOperationContext } from "../../../../dist/analysis/program/walk.js";
import { recordProjectSourceBinding } from "../../../../dist/analysis/storage/source-bindings.js";
import { resolveExpressionCarrier } from "../../../../dist/analysis/source-evidence/types/resolution/expression-carriers.js";
import { applyFlowReadLane } from "../../../../dist/analysis/conversions/flow-read.js";
import { recordBindingWrite } from "../../../../dist/analysis/ownership/source-writes.js";
import { recordRustCompoundWrite } from "../../../../dist/analysis/operations/members/compound-writes.js";
import { recordRustNativeBacking, resolveRustRawLocationCarrier } from "../../../../dist/analysis/operations/native-memory.js";
import { resolveRustMemoryBindingCarrier } from "../../../../dist/analysis/operations/memory-bindings.js";
import { resolveRustRawAddressCarrier, resolveRustRawPointerIdentityCarrier } from "../../../../dist/analysis/operations/raw-addresses.js";
import { selectRustGenericNumericOperation } from "../../../../dist/analysis/operations/numeric/generic.js";
import { recordRustTypedLocationCall, selectRustTypedLocationCall } from "../../../../dist/analysis/operations/typed-locations.js";

const selected = analyzeRustOperations(`
export function selected(input: number): number { const copy = (input); return copy; }
`, { surfaces: [] });
const wrapper = selected.context.sourceStorage.nodes.find(node => selected.context.ast.kindName(node) === "KindParenthesizedExpression");
const reference = Node_Expression(selected.context.ast, wrapper);
const file = selected.context.ast.getSourceFile(reference);
const carrier = selected.context.records.runtimeCarrier.get(reference)?.carrier;
assert.equal(wrapper !== undefined && reference !== undefined && file !== undefined && carrier !== undefined, true);
const unreadable = new Proxy({}, { get() { assert.fail("closed analysis must refuse before reading caller metadata"); } });

for (const [name, invoke] of [
  ["source binding", current => recordProjectSourceBinding(current, reference)],
  ["binding mutation", current => recordBindingWrite(current, reference)],
  ["referent mutation", current => recordBindingWrite(current, reference, "referent")],
  ["cached wrapper realization", current => resolveExpressionCarrier(current, wrapper, file, undefined)],
  ["flow read", current => applyFlowReadLane(current, reference, carrier)],
  ["compound write", current => recordRustCompoundWrite(current, reference, reference, carrier)],
  ["native backing", current => recordRustNativeBacking(current)],
  ["raw location", current => resolveRustRawLocationCarrier(current, reference, file)],
  ["memory binding", current => resolveRustMemoryBindingCarrier(current, reference, file)],
  ["raw identity", current => resolveRustRawPointerIdentityCarrier(current, reference, file, unreadable)],
  ["raw address", current => resolveRustRawAddressCarrier(current, reference, file, unreadable)],
  ["generic numeric operation", current => selectRustGenericNumericOperation(current, reference, "===", reference, reference, carrier, carrier)],
  ["typed-location selection", (current, context) => selectRustTypedLocationCall(unreadable, unreadable, unreadable, context, unreadable)],
  ["typed-location publication", (current, context) => recordRustTypedLocationCall(unreadable, unreadable, carrier, carrier, [], carrier, [], context)],
]) test(`closed ${name} refuses before requirement mutation or metadata selection`, () => {
  const current = createRustCarrierProbe(selected.walk);
  const context = rustOperationContext(current, reference);
  const records = current.context.records.seal(current.context.requiredRecords);
  const required = [...current.context.requiredRecords];
  const original = records.runtimeCarrier.get(reference);
  const foundation = current.context.records.minimumFoundation();
  assert.throws(() => invoke(current, context), /after analysis is sealed/u);
  assert.equal(current.context.requiredRecords.length, required.length, "no obligation is appended after closure");
  assert.equal(current.context.requiredRecords.every((row, index) => row === required[index]), true, "existing row identities remain unchanged");
  assert.equal(records.runtimeCarrier.get(reference) === original, true, "the inherited native fact is untouched");
  assert.equal(current.context.records.minimumFoundation(), foundation, "refusal performs no native demand accounting");
});

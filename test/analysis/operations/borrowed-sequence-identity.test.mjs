import assert from "node:assert/strict";
import test from "node:test";
import { rustTargetOperationFactEquals } from "../../../dist/analysis/facts/operations/equality.js";
import { rustSourcePrimitiveTargetType, rustVecTargetType } from "../../../dist/target-model/types/index.js";
import { selectRustRestSequenceConversion } from "../../../dist/policy/conversions/rest-sequence.js";

test("borrowed spread equality preserves exact source identity, ordered controls and native carriers", () => {
  const elementCarrier = rustSourcePrimitiveTargetType("int32");
  const carrier = rustVecTargetType(elementCarrier);
  const expression = {};
  expression.parent = expression;
  const control = {};
  const leaf = {};
  const input = { expression, controlNodes: [control], inputs: [{ kind: "sequence", expression: leaf,
    carrier, presentCarrier: carrier, optional: false, conversion: selectRustRestSequenceConversion(carrier, elementCarrier) }] };
  const fact = { kind: "array-literal", operationId: "spread", lane: "native", elementCarrier,
    resultCarrier: carrier, length: 1, contributions: [{ kind: "spread", input }] };
  assert.equal(rustTargetOperationFactEquals(fact, { ...fact, contributions: [{ kind: "spread", input: {
    ...input, controlNodes: [...input.controlNodes], inputs: input.inputs.map(value => ({ ...value })),
  } }] }), true);
  for (const changed of [
    { ...input, expression: {} },
    { ...input, controlNodes: [{}] },
    { ...input, controlNodes: [control, {}] },
    { ...input, inputs: [{ ...input.inputs[0], expression: {} }] },
    { ...input, inputs: [{ ...input.inputs[0], optional: true }] },
    { ...input, inputs: [{ ...input.inputs[0], carrier: rustVecTargetType(rustSourcePrimitiveTargetType("float64")) }] },
  ]) assert.equal(rustTargetOperationFactEquals(fact, { ...fact, contributions: [{ kind: "spread", input: changed }] }), false);
});

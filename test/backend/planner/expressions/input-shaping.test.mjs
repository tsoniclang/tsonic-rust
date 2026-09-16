import assert from "node:assert/strict";
import test from "node:test";
import { applyFinalizedRustArgumentMode } from "../../../../dist/backend/planner/expressions/input-shaping.js";
import { rustStringTargetType } from "../../../../dist/target-model/types/index.js";
import { rustSourceParameterAbiFactKey } from "../../../../dist/analysis/facts/keys.js";

const stringCarrier = rustStringTargetType();
const input = {
  source: { kind: "argument", sourceIndex: 0 },
  sourceCarrier: stringCarrier,
  conversion: { kind: "identity" },
  mode: "ref",
  parameterCarrier: { kind: "reference", referent: stringCarrier, mutable: false },
};
const sourceNode = {};

function context(parameter, override) {
  return {
    input: { program: { facts: { getFact: (_node, key) =>
      key === rustSourceParameterAbiFactKey ? parameter : undefined } } },
    expressionOverrides: new Map(override === undefined ? [] : [[sourceNode, override]]),
  };
}

test("finalized native string references use views without copying or consuming values", () => {
  for (const expression of [
    { kind: "path", path: "value" },
    { kind: "call", callee: "next_value", args: [] },
  ]) {
    assert.deepEqual(applyFinalizedRustArgumentMode(context(), sourceNode, expression, input, false), {
      kind: "method-call", receiver: expression, method: "as_str", args: [],
    });
  }
  assert.deepEqual(applyFinalizedRustArgumentMode(context(), sourceNode,
    { kind: "string-literal", value: "value" }, input, false),
  { kind: "str-literal", value: "value" });
});

test("already borrowed native parameters and optional receiver views retain their exact ABI", () => {
  const expression = { kind: "path", path: "value" };
  const parameter = { mode: "ref", parameterCarrier: input.parameterCarrier };
  assert.equal(applyFinalizedRustArgumentMode(context(parameter), sourceNode, expression, input, false), expression);
  const override = { expression, carrier: stringCarrier, valueForm: "shared-reference" };
  assert.deepEqual(applyFinalizedRustArgumentMode(context(undefined, override), sourceNode, expression, input, true), {
    kind: "method-call", receiver: expression, method: "as_str", args: [],
  });
  assert.equal(applyFinalizedRustArgumentMode(context(), sourceNode, expression, { ...input, mode: "value" }, false), expression);
});

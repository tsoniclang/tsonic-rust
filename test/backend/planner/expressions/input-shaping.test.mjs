import assert from "node:assert/strict";
import test from "node:test";
import { applyFinalizedRustArgumentMode } from "../../../../dist/backend/planner/expressions/input-shaping.js";
import { rustStringTargetType } from "../../../../dist/target-model/types/index.js";
import { rustSourceParameterAbiFactKey } from "../../../../dist/analysis/facts/keys.js";
import { lowerRustValueConversion } from "../../../../dist/backend/planner/expressions/value-conversions.js";
import { rustValueConversionContract } from "../../../../dist/target-model/conversions/contracts.js";
import { rustStringToBorrowedStrValueConversion } from "../../../../dist/public/provider.js";

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

test("ordinary String reference arguments are not silently changed to native str views", () => {
  for (const expression of [
    { kind: "path", path: "value" },
    { kind: "call", path: "next_value", args: [] },
  ]) {
    assert.deepEqual(applyFinalizedRustArgumentMode(context(), sourceNode, expression, input, false), {
      kind: "reference", expr: expression,
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

test("explicit native str conversion creates a view without copying or reevaluating the source", () => {
  const contract = rustValueConversionContract(rustStringToBorrowedStrValueConversion);
  assert.equal(contract.sourceMode, "ref");
  assert.equal(contract.fallible, false);
  for (const expression of [
    { kind: "path", path: "value" },
    { kind: "call", path: "next_value", args: [] },
  ]) {
    assert.deepEqual(lowerRustValueConversion(contract, { kind: "reference", expr: expression }, {}, undefined), {
      kind: "method-call", receiver: expression, method: "as_str", args: [],
    });
  }
  for (const borrowed of [
    { kind: "str-literal", value: "value" },
    { kind: "path", path: "borrowed_parameter" },
  ]) {
    assert.equal(lowerRustValueConversion(contract, borrowed, {}, undefined), borrowed);
  }
});

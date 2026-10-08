import assert from "node:assert/strict";
import test from "node:test";
import { applyFinalizedRustArgumentMode } from "../../../../dist/backend/planner/expressions/input-shaping.js";
import { rustStringTargetType } from "../../../../dist/target-model/types/index.js";
import { rustSourceParameterAbiFactKey, rustSourceBindingFactKey } from "../../../../dist/analysis/facts/keys.js";
import { planRustSharedReceiver } from "../../../../dist/backend/planner/expressions/typed-locations.js";
import { lowerRustValueConversion } from "../../../../dist/backend/planner/expressions/value-conversions.js";
import { rustValueConversionContract } from "../../../../dist/target-model/conversions/contracts.js";
import { rustStringToBorrowedStrValueConversion } from "../../../../dist/public/provider.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";

const stringCarrier = rustStringTargetType();
const input = {
  source: { kind: "argument", sourceIndex: 0 },
  sourceCarrier: stringCarrier,
  conversion: { kind: "identity" },
  mode: "ref",
  parameterCarrier: { kind: "reference", referent: stringCarrier, mutable: false },
};
const sourceNode = {};

function context(parameter, override, capture) {
  const declaration = {};
  return {
    capturedBindings: capture === undefined ? [] : [{ declaration, expression: { kind: "path", path: "capture" },
      storage: "value", valueCarrier: stringCarrier, borrowed: capture }],
    input: { program: { typeDefinitions: emptyRustTypeDefinitions,
      callableValues: { generic: { definitionFor: () => undefined } },
      facts: { getFact: (_node, key) =>
      key === rustSourceParameterAbiFactKey ? parameter : key === rustSourceBindingFactKey
        ? { sourceDeclaration: declaration } : undefined,
      getRuntimeCarrierFact: () => ({ carrier: stringCarrier }) },
      source: { ast: { kindName: () => "KindIdentifier", is: {
        IsIdentifier: () => true, IsElementAccessExpression: () => false,
        IsParenthesizedExpression: () => false, IsAsExpression: () => false, IsSatisfiesExpression: () => false,
        IsNonNullExpression: () => false, IsTypeAssertion: () => false,
      } } } } },
    expressionOverrides: new Map(override === undefined ? [] : [[sourceNode, override]]),
  };
}

test("exact borrowed lexical captures pass once through the canonical shared-input owner", () => {
  const expression = { kind: "path", path: "capture" };
  for (const borrowed of ["shared", "mutable"]) {
    const selected = context(undefined, undefined, borrowed);
    const expected = borrowed === "shared" ? expression
      : { kind: "reference", expr: { kind: "dereference", pointer: expression } };
    assert.deepEqual(planRustSharedReceiver(sourceNode, expression, selected), expected);
    assert.deepEqual(applyFinalizedRustArgumentMode(selected, sourceNode, expression, input, false), expected);
  }
  const stored = context();
  assert.deepEqual(planRustSharedReceiver(sourceNode, expression, stored), { kind: "reference", expr: expression });
});

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

test("shared retained payload fields are reborrowed rather than passed as owned values", () => {
  const payload = { kind: "field", receiver: { kind: "path", path: "state" }, name: "payload" };
  const selected = context(undefined, undefined, "shared");
  selected.capturedBindings = [{ ...selected.capturedBindings[0],
    expression: { kind: "reference", expr: payload },
  }];
  const read = { kind: "method-call", receiver: payload, method: "clone", args: [] };
  const expected = { kind: "reference", expr: payload };
  assert.deepEqual(planRustSharedReceiver(sourceNode, read, selected), expected);
  assert.deepEqual(applyFinalizedRustArgumentMode(selected, sourceNode, read, input, false), expected);
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
    const source = { kind: "reference", expr: expression };
    assert.deepEqual(lowerRustValueConversion(contract, source, {}, undefined), {
      kind: "call", path: "core::convert::AsRef::<str>::as_ref", args: [source],
    });
  }
  for (const borrowed of [
    { kind: "str-literal", value: "value" },
    { kind: "path", path: "borrowed_parameter" },
  ]) {
    assert.deepEqual(lowerRustValueConversion(contract, borrowed, {}, undefined), {
      kind: "call", path: "core::convert::AsRef::<str>::as_ref", args: [borrowed],
    });
  }
});

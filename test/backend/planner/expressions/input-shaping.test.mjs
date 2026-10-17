import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { applyFinalizedRustArgumentMode } from "../../../../dist/backend/planner/expressions/input-shaping.js";
import { planExpressionBeforeValueProjections, planRustValueFormation } from "../../../../dist/backend/planner/expressions/entry.js";
import { rustStringTargetType } from "../../../../dist/target-model/types/index.js";


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
      ownership: { reads: new Map([[sourceNode, { carrier: stringCarrier, operandCarrier: stringCarrier,
        formation: { kind: "clone" }, source: { kind: "borrow", mutable: false }, value: { kind: "borrow", mutable: false },
        snapshot: { kind: "clone" }, stablePlace: true, readsStorage: true, pure: true,
        sharedReference: false, flowResultBorrow: false, flowConversionInputBorrow: false,
        borrowedAcross: new Set(), nativeResults: Object.freeze([]) }]]) },
      callableValues: { generic: { definitionFor: () => undefined } },
      records: createRustRecordFixture({sourceParameterAbi: { get: (_node) => parameter },
sourceBinding: { get: (_node) => ({ sourceDeclaration: declaration }) },
runtimeCarrier: { get: () => ({ carrier: stringCarrier }) }}),
      source: { ast: { kindName: () => "KindIdentifier", is: {
        IsIdentifier: () => true, IsElementAccessExpression: () => false,
        IsParenthesizedExpression: () => false, IsAsExpression: () => false, IsSatisfiesExpression: () => false,
        IsNonNullExpression: () => false, IsTypeAssertion: () => false,
      } } } } },
    expressionOverrides: new Map(override === undefined ? [] : [[sourceNode, override]]),
  };
}

test("storage overrides consume the admitted source read rather than snapshot capability", () => {
  const expression = { kind: "path", path: "pending" };
  for (const source of [{ kind: "move" }, { kind: "copy" }, { kind: "borrow", mutable: false },
    { kind: "borrow", mutable: true }, { kind: "clone" }]) {
    const selected = context(undefined, { expression, carrier: stringCarrier, valueForm: "storage" });
    const ownership = selected.input.program.ownership.reads.get(sourceNode);
    selected.input.program.ownership.reads.set(sourceNode, { ...ownership, source, snapshot: { kind: "clone" } });
    const actual = planExpressionBeforeValueProjections(sourceNode, selected, "value");
    if (source.kind === "clone") {
      assert.equal(actual.kind, "method-call", "only the admitted clone read emits a method call");
      assert.equal(actual.method, "clone", "the admitted source clone is retained");
      assert.equal(actual.receiver, expression, "cloning retains the original storage expression");
    } else {
      assert.equal(actual, expression, `${source.kind} retains the exact source expression without a snapshot clone`);
    }
  }
  const missing = context(undefined, { expression, carrier: stringCarrier, valueForm: "storage" });
  missing.input.program.ownership.reads.clear();
  assert.throws(() => planExpressionBeforeValueProjections(sourceNode, missing, "value"),
    error => error instanceof Error && error.message.includes("ownership"),
    "missing admission remains an invariant failure rather than an implicit move");
});

test("contextual owner stabilization renders only the completed formation contract", () => {
  const expression = { kind: "path", path: "captured" };
  for (const formation of [{ kind: "move" }, { kind: "clone" }, { kind: "borrow", mutable: false },
    { kind: "borrow", mutable: true }]) {
    const selected = context(undefined, { expression, carrier: stringCarrier, valueForm: "storage" });
    const ownership = selected.input.program.ownership.reads.get(sourceNode);
    selected.input.program.ownership.reads.set(sourceNode, { ...ownership, formation });
    const actual = planRustValueFormation(sourceNode, selected);
    if (formation.kind === "move") {
      assert.equal(actual, expression, "an admitted owned transfer is not replaced with a snapshot");
    } else if (formation.kind === "clone") {
      assert.equal(actual.kind, "method-call", "the selected native snapshot is rendered once");
      assert.equal(actual.method, "clone", "only the admitted formation selects cloning");
      assert.equal(actual.receiver, expression, "snapshotting retains the original source place");
    } else {
      assert.equal(actual.kind, "reference", "a borrowed-only formation never consumes the native owner");
      assert.equal(actual.expr, expression, "the original place supplies the admitted borrow");
      assert.equal(actual.mutable === true, formation.mutable, "the actual borrow qualifier is retained");
    }
  }
});

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
  assert.equal(applyFinalizedRustArgumentMode(context(undefined, override), sourceNode, expression, input, true), expression);
  const borrowed = { kind: "reference", expr: expression };
  assert.equal(applyFinalizedRustArgumentMode(context(undefined, { ...override, expression: borrowed }),
    sourceNode, borrowed, input, true), borrowed);
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

test("typed shared identity inputs use native deref coercion without changing semantic views", () => {
  const pointer = { kind: "path", path: "guard" };
  const expression = { kind: "dereference", pointer };
  const selected = context(undefined, { expression, carrier: stringCarrier, valueForm: "storage" });
  assert.deepEqual(applyFinalizedRustArgumentMode(selected, sourceNode, expression, input, false), {
    kind: "reference", expr: pointer,
  });
  for (const other of [
    { ...input, conversion: { kind: "semantic", conversion: rustStringToBorrowedStrValueConversion } },
    { ...input, mode: "mut-ref" },
    { ...input, parameterCarrier: { kind: "reference", referent: { kind: "primitive", name: "bool" }, mutable: false } },
    { ...input, parameterCarrier: { ...input.parameterCarrier, mutable: true } },
  ]) {
    const planned = applyFinalizedRustArgumentMode(selected, sourceNode, expression, other, false);
    assert.equal(planned.kind === "reference" && planned.expr === pointer, false);
  }
  const copied = { ...expression };
  assert.deepEqual(applyFinalizedRustArgumentMode(selected, sourceNode, copied, input, false), {
    kind: "reference", expr: copied,
  });
});

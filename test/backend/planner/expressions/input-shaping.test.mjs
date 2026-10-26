import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { applyFinalizedRustArgumentMode, createRustSharedReferenceArgument } from "../../../../dist/backend/planner/expressions/input-shaping.js";
import { rustStringTargetType } from "../../../../dist/target-model/types/index.js";


import { planRustIdentifierValue, planRustSharedReceiver } from "../../../../dist/backend/planner/expressions/typed-locations.js";
import { lowerRustValueConversion } from "../../../../dist/backend/planner/expressions/value-conversions.js";
import { rustValueConversionContract } from "../../../../dist/policy/conversions/contracts.js";
import { rustStringToBorrowedStrValueConversion } from "../../../../dist/public/provider.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";

const stringCarrier = rustStringTargetType();
const input = {
  source: { kind: "argument", sourceIndex: 0 },
  sourceCarrier: stringCarrier,
  conversion: { kind: "identity", sourceCarrier: stringCarrier, targetCarrier: stringCarrier, fallible: false },
  mode: "ref",
  parameterCarrier: { kind: "reference", referent: stringCarrier, mutable: false },
  sharedConversion: false,
  elementView: "value",
};
const sourceNode = {};
const identityProjection = Object.freeze({
  exits: false, flow: undefined, upcast: undefined, downcast: undefined,
  object: undefined, contextual: undefined, option: undefined, fused: undefined,
  borrowable: false, borrowedOptionIdentity: false, borrowConversion: false, referenceReborrow: false,
  contextualIdentity: true, contextualConsumesSource: false,
  preserveAbsenceEffect: false, absenceDiscard: "value",
});

function context(parameter, override, capture) {
  const declaration = {};
  const ownership = capture !== undefined || override?.valueForm === "storage"
    ? { kind: "borrow", mutable: false } : { kind: "move" };
  return {
    capturedBindings: capture === undefined ? [] : [{ declaration, expression: { kind: "path", path: "capture" },
      storage: "value", valueCarrier: stringCarrier, borrowed: capture }],
    input: { program: { typeDefinitions: emptyRustTypeDefinitions,
      callableValues: { generic: { definitionFor: () => undefined } },
      records: createRustRecordFixture({sourceParameterAbi: { get: (_node) => parameter },
sourceBinding: { get: (_node) => ({ sourceDeclaration: declaration }) },
runtimeCarrier: { get: () => ({ carrier: stringCarrier }) },
providerReference: { get: (_node, selected) => selected.conversion.kind === "identity" && selected.mode === "ref" &&
  (parameter?.mode === "ref" || parameter?.mode === "mut-ref" || override?.valueForm === "shared-reference") },
valueProjection: { get: () => identityProjection },
readOwnership: { get: () => ({ carrier: stringCarrier, source: ownership, value: ownership,
  snapshot: undefined, stablePlace: true, readsStorage: true, pure: true,
  sharedReference: false, borrowedAcross: new Set() }) }}),
      source: { ast: { kindName: () => "KindIdentifier", is: {
        IsIdentifier: () => true, IsParameterDeclaration: () => false, IsElementAccessExpression: () => false,
        IsParenthesizedExpression: () => false, IsAsExpression: () => false, IsSatisfiesExpression: () => false,
        IsNonNullExpression: () => false, IsTypeAssertion: () => false,
      } } } } },
    expressionOverrides: new Map(override === undefined ? [] : [[sourceNode, override]]),
  };
}

test("comparison-only native String views do not replace an ordinary shared native argument ABI", () => {
  const expression = { kind: "path", path: "owned_native_string" };
  for (const inputForm of ["value", "shared-reference"]) {
    const selected = context();
    selected.input.program.records = { ...selected.input.program.records,
      stringComparisonView: { get: () => ({ kind: "native-str-reference", inputForm }) } };
    const shared = createRustSharedReferenceArgument(selected, { stage: "source", expression, node: sourceNode });
    assert.equal(shared.kind, "reference", `${inputForm}: the actual &String argument remains a native reference`);
    assert.equal(shared.expr === expression, true, `${inputForm}: the argument preserves its exact original native storage`);
    const parameter = context({ mode: "ref" });
    parameter.input.program.records = { ...parameter.input.program.records,
      stringComparisonView: { get: () => ({ kind: "native-str-reference", inputForm }) } };
    assert.equal(createRustSharedReferenceArgument(parameter, { stage: "source", expression, node: sourceNode }) === expression,
      true, `${inputForm}: an already borrowed native parameter is still reused once`);
  }
});

test("exact borrowed lexical captures pass once through the canonical shared-input owner", () => {
  const expression = { kind: "path", path: "capture" };
  for (const borrowed of ["shared", "mutable"]) {
    const selected = context(undefined, undefined, borrowed);
    const place = planRustIdentifierValue(sourceNode, "capture", selected, "shared-receiver");
    assert.equal(place === selected.capturedBindings[0].expression, borrowed === "shared",
      `${borrowed}: only the actual shared native capture ABI supplies a nonconsuming receiver directly`);
    const expected = borrowed === "shared" ? expression
      : { kind: "reference", expr: { kind: "dereference", pointer: expression } };
    assert.deepEqual(planRustSharedReceiver(sourceNode, place, selected), expected);
    assert.deepEqual(applyFinalizedRustArgumentMode(selected, sourceNode, place, input, false), expected);
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
  { kind: "reference", expr: { kind: "string-literal", value: "value" } });
});

test("shared retained payload fields are reborrowed rather than passed as owned values", () => {
  const payload = { kind: "field", receiver: { kind: "path", path: "state" }, name: "payload" };
  const selected = context(undefined, undefined, "shared");
  selected.capturedBindings = [{ ...selected.capturedBindings[0],
    expression: { kind: "reference", expr: payload },
    referent: payload,
  }];
  const read = planRustIdentifierValue(sourceNode, "capture", selected, "shared-receiver");
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

test("typed shared identity inputs borrow the exact guard payload without guessing its pointer carrier", () => {
  const pointer = { kind: "path", path: "guard" };
  const expression = { kind: "dereference", pointer };
  const selected = context(undefined, { expression, carrier: stringCarrier, valueForm: "storage", storageForm: "plain" });
  assert.deepEqual(applyFinalizedRustArgumentMode(selected, sourceNode, expression, input, false), {
    kind: "reference", expr: expression,
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

test("a sealed borrowed flow reference is re-used only without a storage or flow override", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export function measure(value: string | number): number {
  if (typeof value === "string") {
    const length = value.length;
    return length + value.length;
  }
  return 0;
}
` } });
  const pending = program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile);
  let subject;
  while (pending.length !== 0) {
    const node = pending.pop();
    if (program.source.ast.is.IsIdentifier(node) && program.source.ast.text(node) === "value" &&
      program.records.valueProjection.get(node)?.borrowable === true) subject = node;
    pending.push(...program.source.ast.children(node));
  }
  assert.equal(subject !== undefined, true, "actual narrowed payload retains an admitted borrowed flow projection");
  const pointer = { kind: "path", path: "payload_reference" };
  const expression = { kind: "dereference", pointer };
  const selected = context();
  selected.input.program = program;
  assert.equal(planRustSharedReceiver(subject, expression, selected) === pointer, true, "admitted native flow reference");
  assert.equal(createRustSharedReferenceArgument(selected, { stage: "source", node: subject, expression }) === pointer, true,
    "the shared native input consumes the same completed projection reference without rebuilding its raw source view");
  assert.deepEqual(createRustSharedReferenceArgument(selected, { stage: "finalized", expression }),
    { kind: "reference", expr: expression }, "a finalized value has no source-projection reference authority");
  selected.flowReadOverrides = new Map([[subject, expression]]);
  assert.deepEqual(planRustSharedReceiver(subject, expression, selected), { kind: "reference", expr: expression });
  assert.deepEqual(createRustSharedReferenceArgument(selected, { stage: "source", node: subject, expression }),
    { kind: "reference", expr: expression }, "an overridden flow value retains its actual new borrowing boundary");
  selected.flowReadOverrides = undefined;
  selected.expressionOverrides = new Map([[subject, { expression, carrier: stringCarrier, valueForm: "storage", storageForm: "plain" }]]);
  assert.deepEqual(planRustSharedReceiver(subject, expression, selected), { kind: "reference", expr: expression });
  assert.deepEqual(createRustSharedReferenceArgument(selected, { stage: "source", node: subject, expression }),
    { kind: "reference", expr: expression }, "an overridden native storage value never reuses the original payload reference");
});

import assert from "node:assert/strict";
import test from "node:test";
import { selectRustFlowReadProjection } from "../../../dist/policy/types/value-carrier-reconciliation.js";
import { rustFlowReadProjectionMatches } from "../../../dist/analysis/facts/flow-read-projections.js";
import { rustJsValueTargetType, rustJsErrorTargetType, rustProgramErrorTargetType,
  rustSourcePrimitiveTargetType, rustStringTargetType, rustTsValueTargetType } from "../../../dist/target-model/types/index.js";
import { selectRustClosedTypeTestPlan } from "../../../dist/policy/operations/operators/type-tests.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustSourceErrorTargetType, rustWritableSourceErrorTargetType, rustMutableJsErrorTargetType,
  rustRetainedErrorTargetType, rustWritableRetainedErrorTargetType } from "../../../dist/target-model/types/carriers/source-error.js";

const policy = {
  definitionForCarrier: () => undefined,
  sourceErrorCarrier: () => rustSourceErrorTargetType(),
  sourceCreatedErrorOrigins: [],
  sourceErrorDefinitions: [],
  programErrorVariant: () => undefined,
  relationship: () => ({ kind: "unrelated" }),
};

test("closed Error projection retains exact native capability views, never an immutable-only replacement", () => {
  for (const source of [rustJsValueTargetType(), rustTsValueTargetType()]) {
    for (const target of [rustSourceErrorTargetType(), rustWritableSourceErrorTargetType(),
      rustRetainedErrorTargetType(), rustWritableRetainedErrorTargetType()]) {
      const selected = selectRustFlowReadProjection(source, target, policy);
      assert.equal(selected.kind, "projection");
      assert.equal(selected.fact.kind, "builtin-error");
    }
    for (const target of [rustJsErrorTargetType(), rustMutableJsErrorTargetType(),
      { ...rustSourceErrorTargetType(), genericArguments: [{ kind: "type", type: rustSourcePrimitiveTargetType("int32") }] },
      { kind: "target-named", id: "project.Unrelated" }]) {
      assert.equal(selectRustFlowReadProjection(source, target, policy).kind, "incompatible");
    }
  }
  assert.equal(selectRustFlowReadProjection(rustSourcePrimitiveTargetType("int32"), rustSourceErrorTargetType(), policy).kind, "incompatible");
});

test("both canonical closed carriers expose their retained Error predicate, not property-name classification", () => {
  for (const source of [rustTsValueTargetType(), rustJsValueTargetType()]) {
    assert.deepEqual(selectRustClosedTypeTestPlan(source, { kind: "error", errorKind: "any" },
      policy, emptyRustTypeDefinitions), { kind: "error", lowering: "closed-value" });
  }
});

test("readonly caught Error recovery admits the exact native Error root without a subclass or mutable origin", () => {
  const nativeRoot = { ...policy, sourceErrorCarrier: () => rustJsErrorTargetType() };
  const selectedCarrier = rustSourceErrorTargetType();
  for (const sourceCarrier of [rustProgramErrorTargetType(), rustWritableSourceErrorTargetType(),
    rustRetainedErrorTargetType(), rustWritableRetainedErrorTargetType()]) {
    const fact = { kind: "builtin-error", sourceCarrier, selectedCarrier };
    assert.deepEqual(selectRustFlowReadProjection(sourceCarrier, selectedCarrier, nativeRoot), { kind: "projection", fact });
    assert.equal(rustFlowReadProjectionMatches(fact, nativeRoot, emptyRustTypeDefinitions), true);
  }
  for (const sourceCarrier of [rustProgramErrorTargetType(), rustRetainedErrorTargetType()]) {
    assert.equal(selectRustFlowReadProjection(sourceCarrier, rustWritableSourceErrorTargetType(), nativeRoot).kind, "incompatible");
  }
});

test("native Error recovery does not fabricate an absent, unrelated, generic or writable root", () => {
  const sourceCarrier = rustProgramErrorTargetType();
  for (const root of [undefined, rustStringTargetType(),
    { ...rustJsErrorTargetType(), genericArguments: [{ kind: "type", type: rustSourcePrimitiveTargetType("int32") }] },
    { kind: "target-named", id: "native.UnrelatedError" }]) {
    const selected = { ...policy, sourceErrorCarrier: () => root };
    assert.equal(selectRustFlowReadProjection(sourceCarrier, rustSourceErrorTargetType(), selected).kind, "incompatible");
    assert.equal(selectRustFlowReadProjection(sourceCarrier, rustWritableSourceErrorTargetType(), selected).kind, "incompatible");
    assert.equal(rustFlowReadProjectionMatches({ kind: "builtin-error", sourceCarrier,
      selectedCarrier: rustSourceErrorTargetType() }, selected, emptyRustTypeDefinitions), false);
  }
  const nativeRoot = { ...policy, sourceErrorCarrier: () => rustJsErrorTargetType() };
  assert.equal(selectRustFlowReadProjection(sourceCarrier, rustWritableSourceErrorTargetType(), nativeRoot).kind, "incompatible");
  assert.equal(selectRustFlowReadProjection(sourceCarrier, {
    ...rustSourceErrorTargetType(), genericArguments: [{ kind: "type", type: rustSourcePrimitiveTargetType("int32") }],
  }, nativeRoot).kind, "incompatible");
});

import assert from "node:assert/strict";
import test from "node:test";
import { selectRustFlowReadProjection } from "../../../dist/policy/types/value-carrier-reconciliation.js";
import { rustJsValueTargetType, rustJsErrorTargetType, rustSourcePrimitiveTargetType, rustTsValueTargetType } from "../../../dist/target-model/types/index.js";
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

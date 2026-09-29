import assert from "node:assert/strict";
import test from "node:test";
import { getRustTypeofRuntimeKind } from "../../dist/target-model/types/runtime-kind.js";
import { rustOptionTargetType, rustStringTargetType, rustSourcePrimitiveTargetType, rustJsValueTargetType, rustJsSymbolTargetType, rustJsStringTargetType } from "../../dist/target-model/types/index.js";
import { emptyRustTypeDefinitions } from "../../dist/target-model/types/source-union-definitions.js";
import { planRustRuntimeCategory } from "../../dist/backend/planner/expressions/runtime-category.js";
import { rustClosedValueCategoryProjection } from "../../dist/target-model/types/carriers/closed-values.js";
import { rustUnionLeaves, selectRustUnionProjection } from "../../dist/target-model/types/union-relations.js";

test("closed runtime values expose exact categories without claiming exhaustive union arms", () => {
  const source = rustJsValueTargetType();
  const selected = getRustTypeofRuntimeKind(source, emptyRustTypeDefinitions);
  assert.deepEqual(selected, { kind: "runtime-method", sourceCarrier: source, method: "type_of" });
  const context = { input: { program: { typeDefinitions: emptyRustTypeDefinitions } } };
  const input = { kind: "path", path: "value" };
  assert.deepEqual(planRustRuntimeCategory(input, selected, context), {
    kind: "owned-string-from-borrowed-str",
    expression: { kind: "method-call", receiver: input, method: "type_of", args: [] },
  });
  assert.equal(planRustRuntimeCategory(input, { ...selected, method: "guessed" }, context), undefined);
  assert.equal(rustUnionLeaves(source, emptyRustTypeDefinitions), undefined);
  for (const [carrier, variant, category] of [
    [rustStringTargetType(), "String", true],
    [rustSourcePrimitiveTargetType("bool"), "Bool", true],
    [rustJsSymbolTargetType(), "Symbol", true],
    [rustJsStringTargetType(), "Utf16String", false],
    [rustSourcePrimitiveTargetType("uint64"), "UnsignedInteger", false],
    [rustSourcePrimitiveTargetType("native-uint"), "NativeUint", false],
    [rustSourcePrimitiveTargetType("int32"), "Int32", false],
    [rustSourcePrimitiveTargetType("float32"), "Float32", false],
    [rustSourcePrimitiveTargetType("float64"), "Number", false],
  ]) {
    assert.deepEqual(selectRustUnionProjection(source, carrier, emptyRustTypeDefinitions)?.variant,
      { kind: "payload", name: variant });
    assert.equal(rustClosedValueCategoryProjection(carrier), category);
  }
  assert.equal(getRustTypeofRuntimeKind(rustJsSymbolTargetType(), emptyRustTypeDefinitions), "symbol");
  assert.equal(selectRustUnionProjection(source, rustSourcePrimitiveTargetType("int128"), emptyRustTypeDefinitions), undefined);
});

test("optional runtime categories preserve their exact present kind and reject forged nested facts", () => {
  for (const [value, kind] of [[rustStringTargetType(), "string"], [rustSourcePrimitiveTargetType("uint64"), "bigint"]]) {
    const sourceCarrier = rustOptionTargetType(value);
    const selected = getRustTypeofRuntimeKind(sourceCarrier, emptyRustTypeDefinitions);
    assert.deepEqual(selected, { kind: "optional", sourceCarrier, value: kind });
    const context = { input: { program: { typeDefinitions: emptyRustTypeDefinitions } }, syntheticNames: {} };
    const input = { kind: "path", path: "value" };
    const planned = planRustRuntimeCategory(input, selected, context);
    assert.deepEqual(planned.expression, { kind: "reference", expr: input });
    assert.deepEqual(planned.arms[0].expression, { kind: "string-literal", value: kind });
    assert.deepEqual(planned.arms[1].expression, { kind: "string-literal", value: "object" });
    assert.equal(planRustRuntimeCategory(input, { ...selected, value: "boolean" }, context), undefined);
    assert.equal(planRustRuntimeCategory(input, { ...selected, sourceCarrier: value }, context), undefined);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { getRustTypeofRuntimeKind } from "../../dist/target-model/types/runtime-kind.js";
import { rustOptionTargetType, rustStringTargetType, rustSourcePrimitiveTargetType } from "../../dist/target-model/types/index.js";
import { emptyRustTypeDefinitions } from "../../dist/target-model/types/source-union-definitions.js";
import { planRustRuntimeCategory } from "../../dist/backend/planner/expressions/runtime-category.js";

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

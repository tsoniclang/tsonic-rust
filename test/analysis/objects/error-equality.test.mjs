import assert from "node:assert/strict";
import test from "node:test";
import { selectRustProgramErrorEquality } from "../../../dist/analysis/operations/error-equality.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustJsErrorTargetType, rustProgramErrorTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

const walk = { context: { typeDefinitions: emptyRustTypeDefinitions, projectTypes: {
  definitionForCarrier: () => undefined,
} } };

test("Error identity selects transport before observation in either operand order", () => {
  const transport = rustProgramErrorTargetType();
  const observed = rustJsErrorTargetType();
  for (const negated of [false, true]) {
    for (const errorOperand of ["left", "right"]) {
      const fact = selectRustProgramErrorEquality(walk,
        errorOperand === "left" ? transport : observed,
        errorOperand === "left" ? observed : transport, negated);
      assert.equal(fact !== undefined, true);
      assert.equal(fact.errorOperand, errorOperand);
      assert.equal(fact.negated, negated);
      assert.deepEqual(fact.sourceCarrier, transport);
      assert.deepEqual(fact.targetCarrier, observed);
      assert.equal(fact.comparison.kind, "builtin");
    }
  }
});

test("Error identity never admits an unrelated carrier by operand direction", () => {
  const integer = rustSourcePrimitiveTargetType("int32");
  for (const error of [rustProgramErrorTargetType(), rustJsErrorTargetType()]) {
    for (const negated of [false, true]) {
      assert.equal(selectRustProgramErrorEquality(walk, error, integer, negated), undefined);
      assert.equal(selectRustProgramErrorEquality(walk, integer, error, negated), undefined);
    }
  }
});

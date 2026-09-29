import assert from "node:assert/strict";
import test from "node:test";
import { rustExpressionExitsCallable } from "../../../../dist/backend/target-ast/inspection/callable-exits.js";
import { applyRustFallibleResultExpression, rustExpressionUsesTryInCurrentRegion } from "../../../../dist/backend/planner/types/fallible-shape.js";

const errorType = { kind: "primitive", name: "i32" };
const operand = { kind: "path", path: "outcome" };
const propagation = { kind: "try", expr: operand, nativeReturn: true, resultErrorType: errorType, operandErrorType: errorType };

test("native propagation is an authored return, not a source throw", () => {
  assert.equal(rustExpressionExitsCallable(propagation), true);
  assert.equal(rustExpressionUsesTryInCurrentRegion(propagation), false);
  assert.deepEqual(applyRustFallibleResultExpression(propagation, { errorType }), {
    kind: "call", path: "Ok", genericArguments: [
      { kind: "type", type: { kind: "infer" } }, { kind: "type", type: errorType },
    ], args: [propagation],
  });
  const throwing = { ...propagation, nativeReturn: undefined };
  assert.equal(rustExpressionUsesTryInCurrentRegion(throwing), true);
  assert.deepEqual(applyRustFallibleResultExpression(throwing, { errorType }), operand);
});

test("callable-exit inspection follows expressions but stops at authored closure boundaries", () => {
  assert.equal(rustExpressionExitsCallable({ kind: "call", path: "consume", args: [propagation] }), true);
  assert.equal(rustExpressionExitsCallable({ kind: "return-expression", expr: operand }), true);
  assert.equal(rustExpressionExitsCallable({ kind: "closure", params: [], body: propagation }), false);
  assert.equal(rustExpressionExitsCallable({ kind: "block", bindings: [{ name: "value", value: propagation }], value: operand }), true);
});

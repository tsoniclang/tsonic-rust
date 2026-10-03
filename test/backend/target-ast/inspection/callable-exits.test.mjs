import { rustValueBlock } from "../../../../dist/backend/target-ast/value-block.js";
import assert from "node:assert/strict";
import test from "node:test";
import { rustExpressionExitsCallable } from "../../../../dist/backend/target-ast/inspection/callable-exits.js";
import { applyRustFallibleResultExpression, rustExpressionUsesTryInCurrentRegion } from "../../../../dist/backend/planner/types/fallible-shape.js";
import { rustExpressionReferencesPath } from "../../../../dist/backend/target-ast/inspection/source-usage.js";
import { rustItemsReferenceModuleAlias } from "../../../../dist/backend/target-ast/inspection/source-module-usage.js";
import { maxWritesInStatements } from "../../../../dist/backend/target-ast/inspection/source-dataflow.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";

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
  assert.equal(rustExpressionExitsCallable(rustValueBlock([{ name: "value", value: propagation }], operand)), true);
});

test("native async blocks preserve their deferred boundary and exact captured uses", () => {
  const future = { kind: "async-block", move: true, body: { statements: [
    { kind: "assign", target: { kind: "path", path: "captured" }, operator: "=", value: { kind: "int-literal", text: "1" } },
    { kind: "tail", expr: { kind: "return-expression", expr: { kind: "call", path: "rt::complete", args: [propagation] } } },
  ] } };
  assert.equal(rustExpressionExitsCallable(future), false);
  assert.equal(rustExpressionUsesTryInCurrentRegion(future), false);
  assert.equal(rustExpressionReferencesPath(future, "captured"), true);
  assert.equal(rustExpressionReferencesPath(future, "unrelated"), false);
  assert.equal(rustItemsReferenceModuleAlias([{ kind: "function", name: "create", visibility: "private",
    generics: { parameters: [], wherePredicates: [] }, params: [], body: { statements: [{ kind: "tail", expr: future }] },
  }], "rt"), true);
  assert.equal(maxWritesInStatements([{ kind: "expr", expr: future }], "captured"), 2);
  assert.match(printRustExpr(future), /^async move \{/u);
  assert.doesNotMatch(printRustExpr(future), /\|\||\}\)\(\)/u);
});

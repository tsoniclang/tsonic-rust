import assert from "node:assert/strict";
import test from "node:test";
import { applyFallibleShape } from "../../../../dist/backend/planner/types/fallible-shape.js";

const effect = { kind: "call", path: "write", args: [] };
const errorType = { kind: "named", path: "NativeError", identity: "native:error" };

test("fallible unit bodies evaluate native effects once before constructing the unit result", () => {
  const body = applyFallibleShape({ statements: [{ kind: "tail", expr: effect }] },
    { fallible: true, hasReturnValue: false, errorType, inferErrorTypeFromReturnType: true });
  assert.equal(body.statements.length, 1);
  const tail = body.statements[0].expr;
  assert.equal(tail.kind, "evaluate-then");
  assert.equal(tail.effect.kind, "call");
  assert.equal(tail.effect.path, "write");
  assert.equal(tail.effect.args.length, 0);
  assert.equal(tail.discard, "unit");
  assert.equal(tail.value.path, "Ok");
  assert.equal(tail.value.args[0].path, "()");
});

test("fallible value bodies retain their result and actual error propagation", () => {
  const propagate = { kind: "try", expr: effect, operandErrorType: errorType, resultErrorType: errorType };
  const body = applyFallibleShape({ statements: [{ kind: "tail", expr: propagate }] },
    { fallible: true, hasReturnValue: true, errorType, inferErrorTypeFromReturnType: true });
  assert.equal(body.statements.length, 1);
  assert.equal(body.statements[0].expr.kind, "call");
  assert.equal(body.statements[0].expr.path, "write");
  assert.equal(body.statements[0].expr.args.length, 0);
});

test("fallible value bodies preserve actual cross-domain error conversion", () => {
  const operand = { kind: "named", path: "OtherError", identity: "other:error" };
  const propagate = { kind: "try", expr: effect, operandErrorType: operand, resultErrorType: errorType };
  const body = applyFallibleShape({ statements: [{ kind: "tail", expr: propagate }] },
    { fallible: true, hasReturnValue: true, errorType, inferErrorTypeFromReturnType: true });
  const result = body.statements[0].expr;
  assert.equal(result.kind, "method-call");
  assert.equal(result.method, "map_err");
  assert.equal(result.receiver.path, "write");
  assert.equal(result.args[0].owner === errorType, true);
  assert.equal(result.args[0].name, "from");
});

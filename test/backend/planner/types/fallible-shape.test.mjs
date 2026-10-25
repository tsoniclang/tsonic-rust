import assert from "node:assert/strict";
import test from "node:test";
import { applyFallibleShape } from "../../../../dist/backend/planner/types/fallible-shape.js";
import { rustTypeFromCarrier } from "../../../../dist/backend/planner/types/carrier-syntax.js";
import { rustTypeEquals } from "../../../../dist/backend/target-ast/syntax/type-equality.js";
import { rustNamedTargetType, rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { rustRuntimeErrorTargetType, rustRuntimeErrorTypeIdentity } from "../../../../dist/target-model/types/carriers/runtime-carriers.js";

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

test("unit values become one native Ok without a redundant unit effect", () => {
  for (const unit of [{ kind: "path", path: "()" }, { kind: "tuple-literal", elements: [] }]) {
    const body = applyFallibleShape({ statements: [{ kind: "tail", expr: unit }] }, {
      fallible: true, hasReturnValue: false, errorType, inferErrorTypeFromReturnType: false, canFallThrough: false,
    });
    assert.equal(body.statements.length, 1, "one authored completion stays one native completion");
    const result = body.statements[0].expr;
    assert.equal(result.kind === "call" && result.path === "Ok" && result.args[0] === unit, true,
      "the existing unit value is returned directly, not re-evaluated in a discarded scope");
  }
});

test("native named error carriers preserve checked identity across qualified and package aliases", () => {
  const selected = rustTypeFromCarrier(rustRuntimeErrorTargetType());
  const boundary = { kind: "named", path: "rt::TsonicError", identity: rustRuntimeErrorTypeIdentity };
  assert.equal(selected?.identity, rustRuntimeErrorTypeIdentity, "the actual physical factory identity reaches native syntax");
  assert.equal(rustTypeEquals(selected, boundary), true, "an alias preserves the same checked native type");
  const expression = { kind: "try", expr: effect, operandErrorType: boundary, resultErrorType: boundary };
  const body = applyFallibleShape({ statements: [{ kind: "tail", expr: expression }] }, {
    fallible: true, hasReturnValue: true, errorType: selected, inferErrorTypeFromReturnType: false, canFallThrough: false,
  });
  assert.deepEqual(body.statements[0].expr, effect, "the completed identical Result contains precisely the original native call without Ok or question-mark wrappers");
  const foreign = rustTypeFromCarrier(rustNamedTargetType("another-runtime:TsonicError", selected.path));
  assert.equal(rustTypeEquals(foreign, boundary), false, "matching spelling cannot erase a different native identity");
});

test("native named syntax retains generic identity and rejects contradictory physical arguments", () => {
  const integer = rustSourcePrimitiveTargetType("int32");
  const boolean = rustSourcePrimitiveTargetType("bool");
  const selected = rustTypeFromCarrier(rustNamedTargetType("native:Container", "native::Container", [{ kind: "type", type: integer }]));
  const alias = rustTypeFromCarrier(rustNamedTargetType("native:Container", "container_alias::Container", [{ kind: "type", type: integer }]));
  const foreign = rustTypeFromCarrier(rustNamedTargetType("foreign:Container", "native::Container", [{ kind: "type", type: integer }]));
  const differentArgument = rustTypeFromCarrier(rustNamedTargetType("native:Container", "native::Container", [{ kind: "type", type: boolean }]));
  assert.equal(rustTypeEquals(selected, alias), true, "aliases retain the exact declared native identity and argument vector");
  assert.equal(rustTypeEquals(selected, foreign), false, "a foreign declaration cannot acquire identity from the rendered path");
  assert.equal(rustTypeEquals(selected, differentArgument), false, "the same declaration cannot erase an actual native argument mismatch");
});

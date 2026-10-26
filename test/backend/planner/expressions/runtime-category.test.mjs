import assert from "node:assert/strict";
import test from "node:test";
import { planRustRuntimeCategory } from "../../../../dist/backend/planner/expressions/runtime-category.js";
import { getRustTypeofRuntimeKind } from "../../../../dist/policy/operations/syntax/runtime-kind.js";
import { rustJsValueTargetType } from "../../../../dist/target-model/types/index.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";

test("selected native category methods borrow automatically without a copied or explicitly borrowed receiver", () => {
  const result = getRustTypeofRuntimeKind(rustJsValueTargetType(), emptyRustTypeDefinitions);
  assert.equal(result.kind, "runtime-method");
  const context = { input: { program: { typeDefinitions: emptyRustTypeDefinitions } } };
  const value = { kind: "path", path: "value" };
  const expected = {
    kind: "method-call", receiver: value, method: result.method, args: [],
  };
  assert.deepEqual(planRustRuntimeCategory(value, result, context), expected);
  assert.deepEqual(planRustRuntimeCategory({ kind: "reference", expr: value }, result, context, true), expected);
  assert.equal(result.method, "type_of", "the single producer and literal method contract exclude forged method names");
  assert.equal(getRustTypeofRuntimeKind({ kind: "type-parameter", identity: "fixture.T", name: "T" },
    emptyRustTypeDefinitions), undefined, "unsupported native category evidence is rejected before any render plan exists");
});

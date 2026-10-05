import assert from "node:assert/strict";
import test from "node:test";
import { planRustNonConsumingValue } from "../../../../dist/backend/planner/expressions/typed-locations.js";
import { rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";

function context(kind, semantics = "stored") {
  return { input: { program: { source: { ast: {
    is: { IsParenthesizedExpression: () => false, IsAsExpression: () => false,
      IsSatisfiesExpression: () => false, IsNonNullExpression: () => false,
      IsTypeAssertion: () => false, IsIdentifier: () => kind === "KindIdentifier",
      IsElementAccessExpression: () => kind === "KindElementAccessExpression" },
    kindName: () => kind,
  } }, facts: { getFact(_node, key) {
    return key === rustTargetOperationFactKey && kind === "KindPropertyAccessExpression"
      ? { kind: "source-field", valueSemantics: { kind: semantics } } : undefined;
  } } } } };
}

test("native storage borrows remove implicit whole-owner clones without requiring Clone on an unread payload", () => {
  const owner = { kind: "field", receiver: { kind: "path", path: "environment" }, name: "capture_0" };
  const cloned = { kind: "method-call", receiver: owner, method: "clone", args: [] };
  for (const kind of ["KindIdentifier", "KindElementAccessExpression", "KindThisKeyword", "KindPropertyAccessExpression"]) {
    assert.equal(planRustNonConsumingValue({}, cloned, context(kind)) === owner, true, kind);
  }
});

test("authored clone calls, accessors and argument-bearing operations retain their effects", () => {
  const owner = { kind: "path", path: "value" };
  const cloned = { kind: "method-call", receiver: owner, method: "clone", args: [] };
  for (const selected of [context("KindCallExpression"), context("KindPropertyAccessExpression", "accessor")]) {
    assert.equal(planRustNonConsumingValue({}, cloned, selected) === cloned, true, "authored effect");
  }
  for (const expression of [owner, { ...cloned, args: [{ kind: "int-literal", text: "1" }] },
    { ...cloned, method: "load" }]) {
    assert.equal(planRustNonConsumingValue({}, expression, context("KindIdentifier")) === expression, true,
      "only the implicit zero-argument storage clone is removed");
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { rustReferenceToPlace } from "../../../../dist/backend/target-ast/syntax/expressions.js";

test("a sequenced place borrows its tail without moving it through an owned block result", () => {
  const place = { kind: "path", path: "original" };
  const first = { kind: "call", path: "before", args: [] };
  const second = { kind: "call", path: "after", args: [] };
  const expression = { kind: "evaluate-then", effect: first, discard: "unit", value: {
    kind: "evaluate-then", effect: second, discard: "value", value: place,
  } };
  const selected = rustReferenceToPlace(expression);
  assert.equal(selected.kind, "evaluate-then");
  assert.equal(selected.effect === first && selected.value.effect === second, true);
  assert.equal(selected.discard, "unit");
  assert.equal(selected.value.discard, "value");
  assert.equal(selected.value.value.kind, "reference");
  assert.equal(selected.value.value.expr === place, true);
  assert.equal(expression.value.value === place, true, "the input AST remains unchanged");
});

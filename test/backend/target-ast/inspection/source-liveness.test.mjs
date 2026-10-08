import assert from "node:assert/strict";
import test from "node:test";
import { finalizeRustBlockLiveness } from "../../../../dist/backend/target-ast/inspection/source-liveness.js";

const input = { kind: "path", path: "input" };
const present = { kind: "path", path: "present" };
const owner = { kind: "path", path: "owner" };
const increment = { kind: "block", body: { statements: [
  { kind: "let", name: "value", mutable: false,
    init: { kind: "method-call", receiver: owner, method: "get", args: [] } },
  { kind: "let", name: "next", mutable: false, init:
    { kind: "binary", operator: "+", left: { kind: "path", path: "value" }, right: { kind: "int-literal", text: "1" } } },
  { kind: "expr", expr: { kind: "method-call", receiver: owner, method: "set", args: [
    { kind: "path", path: "next" },
  ] } },
  { kind: "tail", expr: { kind: "path", path: "next" } },
] } };
const sequenced = { ...increment, body: { statements: [
  ...increment.body.statements.slice(0, -2),
  { kind: "tail", expr: { kind: "evaluate-then", discard: "unit",
    effect: increment.body.statements[2].expr, value: increment.body.statements[3].expr } },
] } };
const branch = (selector, fallback) => ({ kind: "match", expression: selector, arms: [
  { pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: "present" }] }, expression: present },
  { pattern: { kind: "path", path: "None" }, expression: fallback },
] });
const block = expression => ({ statements: [
  { kind: "let", name: "selected", mutable: false, init: expression },
  { kind: "tail", expr: { kind: "path", path: "selected" } },
] });

test("terminal conditional values fold one redundant binding without changing lazy mutation", () => {
  for (const expression of [branch(input, increment), branch(input, sequenced),
    { kind: "conditional", condition: input, whenTrue: present, whenFalse: increment }]) {
    const normalized = finalizeRustBlockLiveness(block(expression));
    assert.equal(normalized.statements.length, 1);
    assert.equal(normalized.statements[0].kind, "tail");
    assert.equal(JSON.stringify(normalized.statements[0].expr) === JSON.stringify(expression), true,
      "the branch retains every effect, order and exact owning scope");
  }
});

test("terminal folding retains bindings required by temporary receiver, label and type scopes", () => {
  const guard = { kind: "method-call", receiver: owner, method: "borrow", args: [] };
  const borrowed = { kind: "method-call", receiver: guard, method: "get", args: [] };
  for (const expression of [branch(guard, increment), branch(input, borrowed),
    branch(input, { kind: "evaluate-then", discard: "unit", effect: borrowed, value: present }),
    branch(input, { ...increment, label: "scope" })]) {
    assert.equal(finalizeRustBlockLiveness(block(expression)).statements.length, 2,
      "do not extend a guard or remove an authored scope");
  }
  const typed = block(branch(input, increment));
  typed.statements[0].type = { kind: "named", path: "i32" };
  assert.equal(finalizeRustBlockLiveness(typed).statements.length, 2,
    "explicit type selection remains mandatory");
});

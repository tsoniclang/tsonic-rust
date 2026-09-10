import assert from "node:assert/strict";
import { test } from "node:test";
import { finalizeRustBlockLiveness } from "../../../dist/backend/target-ast/inspection/source-liveness.js";

const path = (name) => ({ kind: "path", path: name });
const literal = (value) => ({ kind: "int-literal", value });
const assign = (name, value) => ({ kind: "assign", target: path(name), operator: "=", value });
const block = (...statements) => ({ statements });
const branch = (then, otherwise) => ({ kind: "if", condition: path("flag"), then, else: otherwise });
const declaration = { kind: "let", name: "result", mutable: true };

function normalize(conditional, following = []) {
  return finalizeRustBlockLiveness(block(declaration, conditional, ...following, {
    kind: "return", expr: path("result"),
  }));
}

test("conditional initialization retains exact side effects and nested branches", () => {
  const effect = assign("offset", literal(4));
  const conditional = branch(
    block(effect, assign("result", path("offset"))),
    block(branch(block(assign("result", literal(2))), block(assign("result", literal(3))))),
  );
  const result = normalize(conditional).statements[0];
  assert.equal(result.kind, "let");
  assert.equal(result.mutable, false);
  assert.equal(result.init.kind, "conditional");
  assert.deepEqual(result.init.whenTrue, {
    kind: "evaluate-then",
    effect: { kind: "assignment", target: effect.target, operator: "=", value: effect.value },
    discard: "unit",
    value: path("offset"),
  });
  assert.equal(result.init.whenFalse.kind, "conditional");
  assert.equal(normalize(conditional, [assign("result", literal(5))]).statements[0].mutable, true);
});

test("conditional initialization leaves unsafe-to-move bindings unchanged", () => {
  const terminal = assign("result", literal(1));
  const complete = block(terminal);
  const cases = [
    branch(block({ kind: "expr", expr: path("result") }, terminal), complete),
    branch(block(assign("result", path("result"))), complete),
    branch(block({ kind: "let", name: "result", mutable: false, init: literal(0) }, terminal), complete),
    branch(block({ kind: "let", name: "local", mutable: false, init: path("result") }, terminal), complete),
    branch(block({ kind: "return", expr: literal(0) }, terminal), complete),
    branch(complete, block()),
    { ...branch(complete, complete), else: undefined },
    { ...branch(complete, complete), condition: path("result") },
    { ...branch(complete, complete), attrs: ["#[allow(unused)]"] },
    branch({ ...complete, innerAttrs: ["#![allow(unused)]"] }, complete),
    branch(complete, block(branch(complete, block()))),
  ];
  for (const conditional of cases) {
    const result = normalize(conditional);
    assert.equal(result.statements[0].kind, "let");
    assert.equal(result.statements[0].init, undefined, JSON.stringify(conditional));
    assert.equal(result.statements[1].kind, "if");
  }
});

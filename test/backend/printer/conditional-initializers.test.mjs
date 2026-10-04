import { rustValueBlock } from "../../../dist/backend/target-ast/value-block.js";
import { rustListAttribute, rustWordAttribute } from "../../../dist/backend/target-ast/attributes.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { finalizeRustBlockLiveness } from "../../../dist/backend/target-ast/inspection/source-liveness.js";
import { printRustExpr } from "../../../dist/print/source/expressions/core.js";

const path = (name) => ({ kind: "path", path: name });
const literal = (value) => ({ kind: "int-literal", text: String(value) });
const assign = (name, value) => ({ kind: "assign", target: path(name), operator: "=", value });
const block = (...statements) => ({ statements });
const branch = (then, otherwise) => ({ kind: "if", condition: path("flag"), then, else: otherwise });
const declaration = { kind: "let", name: "result", type: { kind: "primitive", name: "i32" }, mutable: true };

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
    { ...branch(complete, complete), attrs: [rustListAttribute("allow", [rustWordAttribute("unused")])] },
    branch({ ...complete, innerAttrs: [rustListAttribute("allow", [rustWordAttribute("unused")])] }, complete),
    branch(complete, block(branch(complete, block()))),
  ];
  for (const conditional of cases) {
    const result = normalize(conditional);
    assert.equal(result.statements[0].kind, "let");
    assert.equal(result.statements[0].init, undefined, JSON.stringify(conditional));
    assert.equal(result.statements[1].kind, "if");
  }
});

test("conditional printing preserves scoped attributes and discarded-value effects", () => {
  const scoped = rustValueBlock([{ name: "local", value: literal(2) }], literal(3), { inner: [rustListAttribute("allow", [rustWordAttribute("unused_variables")])] });
  const source = printRustExpr({
    kind: "conditional",
    condition: path("flag"),
    whenTrue: {
      kind: "evaluate-then",
      effect: { kind: "call", path: "step", args: [] },
      discard: "value",
      value: scoped,
    },
    whenFalse: literal(0),
  });
  assert.equal(source, "if flag { let _ = step(); { #![allow(unused_variables)] let local = 2; 3 } } else { 0 }");
});

test("native completion blocks preserve exact dead-write expectations without changing effects", () => {
  const dead = assign("marker", { kind: "call", path: "record", args: [] });
  const inside = { kind: "block", body: block(dead, { kind: "tail", expr: literal(0) }) };
  const normalizeBlock = (value, following = []) => finalizeRustBlockLiveness(block(
    { kind: "let", name: "marker", mutable: true, init: literal(1) },
    { kind: "let", name: "flow", mutable: false, init: value }, ...following,
  ));
  const result = normalizeBlock(inside);
  const protectedWrite = result.statements[1].init.body.statements[0];
  assert.equal(protectedWrite.kind, "scope");
  assert.deepEqual(protectedWrite.body.statements[0], dead);
  assert.equal(protectedWrite.body.innerAttrs[0].path, "expect");
  assert.deepEqual(finalizeRustBlockLiveness(result), result);
  const observed = normalizeBlock(inside, [{ kind: "expr", expr: path("marker") }]);
  assert.equal(observed.statements[1].init.body.statements[0].kind, "assign");
  const sibling = normalizeBlock({ kind: "tuple-literal", elements: [inside, path("marker")] });
  assert.equal(sibling.statements[1].init.elements[0].body.statements[0].kind, "assign");
  const callback = normalizeBlock({ kind: "closure-block", move: false, async: false, params: [], body: inside.body });
  assert.equal(callback.statements[1].init.body.statements[0].kind, "assign");
  const global = finalizeRustBlockLiveness(block({ kind: "expr", expr: inside }));
  assert.equal(global.statements[0].expr.body.statements[0].kind, "assign");
  const awaited = normalizeBlock({ kind: "await", expr: { kind: "async-block", move: false, body: inside.body } });
  assert.equal(awaited.statements[1].init.expr.body.statements[0].kind, "assign");
});

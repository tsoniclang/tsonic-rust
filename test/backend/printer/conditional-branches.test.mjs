import assert from "node:assert/strict";
import test from "node:test";
import { mergeRustAdjacentConditionalBranches, simplifyRustBooleanConditional } from "../../../dist/backend/target-ast/normalization/conditional-branches.js";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";
import { createRustSourceFile, emptyRustGenerics } from "../../../dist/backend/target-ast/nodes.js";

test("conditional return and tail statements share boolean normalization", () => {
  const condition = { kind: "call", path: "observe", args: [] };
  for (const kind of ["return", "tail"]) {
    const model = createRustSourceFile([{ kind: "function", name: "choose", visibility: "public",
      generics: emptyRustGenerics, params: [], returnType: { kind: "primitive", name: "bool" },
      body: { statements: [{ kind: "if", condition,
        then: { statements: [{ kind, expr: { kind: "bool-literal", value: true } }] },
        else: { statements: [{ kind, expr: { kind: "bool-literal", value: false } }] },
      }] },
    }]);
    assert.deepEqual(finalizeRustSourceStyle(model).items[0].body.statements, [{ kind, expr: condition }]);
  }
});

test("boolean conditional normalization retains one exact condition evaluation", () => {
  const condition = { kind: "call", path: "observe", args: [] };
  const literal = value => ({ kind: "bool-literal", value });
  assert.strictEqual(simplifyRustBooleanConditional(condition, literal(true), literal(false)), condition);
  assert.deepEqual(simplifyRustBooleanConditional(condition, literal(false), literal(true)), {
    kind: "unary", operator: "!", operand: condition,
  });
  for (const value of [true, false]) assert.deepEqual(
    simplifyRustBooleanConditional(condition, literal(value), literal(value)),
    { kind: "evaluate-then", effect: condition, discard: "value", value: literal(value) },
  );
  assert.equal(simplifyRustBooleanConditional(condition, condition, literal(false)), undefined);
  assert.equal(simplifyRustBooleanConditional(condition, literal(true), condition), undefined);
});

test("identical branches merge only when both conditions have no temporary lifetimes", () => {
  const compare = value => ({ kind: "binary", operator: "==", left: { kind: "path", path: "key" },
    right: { kind: "str-literal", value } });
  const first = compare("first");
  const second = compare("second");
  const value = { kind: "call", path: "selected", args: [] };
  const otherwise = { kind: "call", path: "otherwise", args: [] };
  const tail = { kind: "conditional", condition: second, whenTrue: structuredClone(value), whenFalse: otherwise };
  assert.deepEqual(mergeRustAdjacentConditionalBranches(first, value, tail), {
    kind: "conditional", condition: { kind: "binary", operator: "||", left: first, right: second },
    whenTrue: value, whenFalse: otherwise,
  });
  for (const condition of [{ kind: "call", path: "with_temporaries", args: [] },
    { ...first, left: { kind: "call", path: "borrow", args: [] } },
    { ...first, right: { kind: "string-literal", value: "owned" } }]) {
    assert.equal(mergeRustAdjacentConditionalBranches(condition, value, tail), undefined);
    assert.equal(mergeRustAdjacentConditionalBranches(first, value, { ...tail, condition }), undefined);
  }
  assert.equal(mergeRustAdjacentConditionalBranches(first, value, { ...tail, whenTrue: otherwise }), undefined);
});

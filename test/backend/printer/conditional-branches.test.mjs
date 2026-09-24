import assert from "node:assert/strict";
import test from "node:test";
import { mergeRustAdjacentConditionalBranches } from "../../../dist/backend/target-ast/normalization/conditional-branches.js";

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

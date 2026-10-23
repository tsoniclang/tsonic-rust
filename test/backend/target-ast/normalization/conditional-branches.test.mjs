import assert from "node:assert/strict";
import test from "node:test";
import { finalizeRustSourceStyle } from "../../../../dist/backend/target-ast/normalization/source-style.js";
import { emptyRustGenerics } from "../../../../dist/backend/target-ast/syntax/nodes.js";

const call = name => ({ kind: "call", path: name, args: [] });
const normalize = expression => finalizeRustSourceStyle({ items: [{
  kind: "function", name: "run", visibility: "public", generics: emptyRustGenerics, params: [],
  body: { statements: [{ kind: "tail", expr: expression }] },
}] }).items[0].body.statements[0].expr;
const sameSyntax = (actual, expected, label) => assert.equal(JSON.stringify(actual) === JSON.stringify(expected), true, label);

test("identical conditional branches keep one condition evaluation before their shared expression", () => {
  const selected = normalize({ kind: "conditional", condition: call("condition"), whenTrue: call("value"), whenFalse: call("value") });
  sameSyntax(selected, { kind: "evaluate-then", effect: call("condition"), discard: "value", value: call("value") },
    "condition remains once before the selected value");
  sameSyntax(normalize(selected), selected, "normalization is idempotent");
});

test("adjacent identical absence branches merge with ordered short-circuit conditions", () => {
  const absent = () => ({ kind: "call", path: "js_abi::JsValue::from", args: [{ kind: "tuple-literal", elements: [] }] });
  const original = { kind: "conditional", condition: call("first"), whenTrue: absent(), whenFalse: {
    kind: "conditional", condition: call("second"), whenTrue: absent(), whenFalse: {
      kind: "conditional", condition: call("third"), whenTrue: absent(), whenFalse: call("present"),
    },
  } };
  const selected = normalize(original);
  sameSyntax(selected, { kind: "conditional", condition: {
    kind: "binary", operator: "||", left: call("first"), right: {
      kind: "binary", operator: "||", left: call("second"), right: call("third"),
    },
  }, whenTrue: absent(), whenFalse: call("present") }, "tests stay left-to-right and later tests stay short-circuited");
  sameSyntax(normalize(selected), selected, "merged absence normalization is idempotent");
});

test("different branches, typed invocations and alternative effect order are never conflated", () => {
  const originals = [
    { kind: "conditional", condition: call("first"), whenTrue: call("left"), whenFalse: call("right") },
    { kind: "conditional", condition: call("first"), whenTrue: {
      kind: "call", path: "value", args: [], genericArguments: [{ kind: "type", type: { kind: "primitive", name: "i32" } }],
    }, whenFalse: { kind: "call", path: "value", args: [], genericArguments: [
      { kind: "type", type: { kind: "primitive", name: "u32" } },
    ] } },
    { kind: "conditional", condition: call("first"), whenTrue: call("shared"), whenFalse: {
      kind: "conditional", condition: call("second"), whenTrue: call("different"), whenFalse: call("shared"),
    } },
  ];
  for (const [index, original] of originals.entries()) sameSyntax(normalize(original), original, `distinct syntax ${index}`);
});

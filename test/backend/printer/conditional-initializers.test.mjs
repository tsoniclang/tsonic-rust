import { rustValueBlock } from "../../../dist/backend/target-ast/syntax/value-block.js";
import { rustListAttribute, rustWordAttribute } from "../../../dist/backend/target-ast/syntax/attributes.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { printRustExpr } from "../../../dist/print/source/expressions/core.js";
import { cloneRustExpression } from "../../../dist/backend/target-ast/syntax/expressions.js";

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

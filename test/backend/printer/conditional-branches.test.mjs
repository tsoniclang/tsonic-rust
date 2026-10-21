import assert from "node:assert/strict";
import test from "node:test";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";
import { createRustSourceFile, emptyRustGenerics } from "../../../dist/backend/target-ast/syntax/nodes.js";
import { printRustExpr } from "../../../dist/print/source/expressions/core.js";

test("conditional and if-let arms preserve their exact lexical block targets", () => {
  const selected = { kind: "block", label: "selected", body: { statements: [{ kind: "tail", expr: {
    kind: "break-expression", label: "selected", expr: { kind: "int-literal", text: "7" },
  } }] } };
  for (const expression of [
    { kind: "conditional", condition: { kind: "path", path: "ready" }, whenTrue: selected, whenFalse: selected },
    { kind: "if-let", pattern: { kind: "binding", name: "value" }, expression: { kind: "path", path: "candidate" },
      whenTrue: selected, whenFalse: selected },
  ]) {
    const printed = printRustExpr(expression);
    assert.equal((printed.match(/'selected:\s*\{/gu) ?? []).length, 2, "both lexical targets are retained");
    assert.equal((printed.match(/break 'selected 7/gu) ?? []).length, 2, "both exits keep the selected target");
  }
});

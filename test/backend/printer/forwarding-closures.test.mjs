import assert from "node:assert/strict";
import test from "node:test";
import { collapseRustForwardingClosure } from "../../../dist/backend/target-ast/normalization/forwarding-closures.js";
import { printRustExpr } from "../../../dist/print/source/expressions/core.js";
import { rustItemsReferenceModuleAlias } from "../../../dist/backend/target-ast/inspection/source-module-usage.js";

const parameter = name => ({ name, byRefCopy: false });
const path = name => ({ kind: "path", path: name });
const genericArguments = [{ kind: "type", type: { kind: "named", path: "rt::TsonicError" } }];

test("exact static forwarding retains typed function items without a redundant closure", () => {
  for (const names of [[], ["value"], ["first", "second"]]) {
    const selected = collapseRustForwardingClosure({
      kind: "closure", move: true, params: names.map(parameter),
      body: { kind: "call", path: "retain", genericArguments, args: names.map(path) },
    });
    assert.deepEqual(selected, { kind: "path", path: "retain", genericArguments });
    assert.equal(printRustExpr(selected), "retain::<rt::TsonicError>");
    const items = [{ kind: "const", name: "VALUE", type: { kind: "unit" }, value: selected }];
    assert.equal(rustItemsReferenceModuleAlias(items, "rt"), true);
    assert.equal(rustItemsReferenceModuleAlias(items, "unrelated"), false);
  }
});

test("forwarding does not erase captures, dereferences, effects or argument order", () => {
  for (const [params, body] of [
    [[parameter("value")], { kind: "call", path: "retain", args: [path("captured")] }],
    [[parameter("value")], { kind: "call", path: "value", args: [path("value")] }],
    [[{ name: "value", byRefCopy: true }], { kind: "call", path: "retain", args: [path("value")] }],
    [[parameter("first"), parameter("second")], { kind: "call", path: "retain", args: [path("second"), path("first")] }],
    [[parameter("value")], { kind: "call", path: "retain", args: [{ kind: "call", path: "next", args: [] }] }],
    [[parameter("value")], { kind: "invoke", callee: path("callback"), args: [path("value")] }],
    [[parameter("value")], { kind: "unsafe", expression: { kind: "call", path: "retain", args: [path("value")] } }],
    [[parameter("value")], { kind: "try", expr: { kind: "call", path: "retain", args: [path("value")] },
      resultErrorType: { kind: "named", path: "rt::TsonicError" },
      operandErrorType: { kind: "named", path: "rt::TsonicError" } }],
  ]) {
    const closure = { kind: "closure", params, body };
    assert.equal(collapseRustForwardingClosure(closure), closure);
  }
});

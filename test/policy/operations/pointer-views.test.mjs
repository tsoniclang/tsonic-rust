import assert from "node:assert/strict";
import test from "node:test";
import { tsonicPointerViewFactKey } from "@tsonic/source-core/facts";
import { selectRustPointerViewCall } from "../../../dist/analysis/operations/pointer-views.js";

for (const changed of ["call", "pointerExpression", "readExpression", "writeExpression", "arguments"]) {
  test(`pointer view rejects changed ${changed} before lowering`, () => {
    const call = {};
    const operands = [{}, {}, {}];
    const original = {
      call, pointerExpression: operands[0], readExpression: operands[1], writeExpression: operands[2],
      sourcePointeeType: {}, pointeeType: {}, pointerType: {}, readType: {}, writeType: {},
      resultType: {}, optional: false,
    };
    const fact = changed === "arguments" ? original : { ...original, [changed]: {} };
    const request = { source: { call,
      sourceArguments: (changed === "arguments" ? operands.slice(0, 2) : operands).map(expression => ({ expression })),
    } };
    const result = selectRustPointerViewCall(request, {
      ast: { arguments: () => operands },
      source: { sourceFacts: { getFact: (_subject, key) => key === tsonicPointerViewFactKey ? fact : undefined } },
      extensionId: "tsonic.rust.policy",
    }, {});
    assert.equal(result.kind, "reject");
    assert.equal(result.diagnostic.extensionCode, "RUST_POINTER_VIEW_NOT_PROVEN");
  });
}

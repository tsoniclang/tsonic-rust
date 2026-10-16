import assert from "node:assert/strict";
import test from "node:test";
import { wrapRustJsPromiseBody } from "../../../../dist/backend/planner/declarations/callables/async-promise.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";

test("settled JS bodies run synchronously inside a native stack closure", () => {
  const body = { statements: [{ kind: "return", expr: { kind: "int-literal", text: "7" } }] };
  for (const fallible of [false, true]) {
    const wrapped = wrapRustJsPromiseBody(body, fallible, { kind: "settled", settledAwaits: [] });
    const call = wrapped.statements[0].expr;
    assert.equal(call.path, fallible ? "js_abi::JsPromise::from_result" : "js_abi::JsPromise::resolved");
    assert.equal(call.args[0].kind, "invoke");
    assert.equal(call.args[0].callee.async, false);
    assert.equal(call.args[0].callee.body === body, true);
    const printed = printRustExpr(call);
    assert.equal(printed.replace(/\s+/gu, " ").includes("(move || { return 7; })()"), true, printed);
    assert.equal(printed.includes("async"), false);
  }
});

test("suspending owned JS bodies pass their selected future factory without an IIFE", () => {
  const body = { statements: [] };
  for (const fallible of [false, true]) {
    const wrapped = wrapRustJsPromiseBody(body, fallible, { kind: "factory", capturedParameters: [] });
    const call = wrapped.statements[0].expr;
    assert.equal(call.path, fallible ? "js_abi::JsPromise::from_fallible_factory" : "js_abi::JsPromise::from_infallible_factory");
    assert.equal(call.args[0].kind, "closure-block");
    assert.equal(call.args[0].async, true);
    assert.equal(call.args[0].body === body, true);
  }
});

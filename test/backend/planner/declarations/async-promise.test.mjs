import assert from "node:assert/strict";
import test from "node:test";
import { wrapRustJsPromiseBody, wrapRustJsPromiseCompletion } from "../../../../dist/backend/planner/declarations/callables/async-promise.js";
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

test("settled atomic completions need no invented capture or return boundary", () => {
  const expressions = [
    { kind: "int-literal", text: "7" },
    { kind: "path", path: "value" },
    { kind: "field", receiver: { kind: "path", path: "state" }, name: "value" },
    { kind: "tuple-literal", elements: [] },
  ];
  for (const expression of expressions) {
    const wrapped = wrapRustJsPromiseBody({ statements: [{ kind: "tail", expr: expression }] },
      false, { kind: "settled", settledAwaits: [] });
    assert.equal(wrapped.statements[0].expr.args[0] === expression, true,
      `${expression.kind}: preserve the exact owned completion`);
  }
});

test("native-body adapters transport the already-computed result directly", () => {
  for (const fallible of [false, true]) {
    const completion = { kind: "call", path: "crate::body", args: [{ kind: "path", path: "value" }] };
    const call = wrapRustJsPromiseCompletion(completion, fallible).statements[0].expr;
    assert.equal(call.path, fallible ? "js_abi::JsPromise::from_result" : "js_abi::JsPromise::resolved",
      `${fallible}: selected settled constructor`);
    assert.equal(call.args[0] === completion, true, `${fallible}: one native invocation, no extra closure`);
  }
});

test("body-local exits and captured computations keep their native boundary", () => {
  const expressions = [
    { kind: "return-expression", expr: { kind: "int-literal", text: "7" } },
    { kind: "try", expr: { kind: "call", path: "fallible", args: [] } },
    { kind: "method-call", receiver: { kind: "path", path: "value" }, method: "read", args: [] },
    { kind: "field", receiver: { kind: "call", path: "read", args: [] }, name: "value" },
  ];
  for (const expression of expressions) {
    const wrapped = wrapRustJsPromiseBody({ statements: [{ kind: "tail", expr: expression }] },
      false, { kind: "settled", settledAwaits: [] });
    assert.equal(wrapped.statements[0].expr.args[0].kind, "invoke",
      `${expression.kind}: retain completion and capture lifetime`);
  }
});

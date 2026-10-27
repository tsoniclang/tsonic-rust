import assert from "node:assert/strict";
import test from "node:test";
import { wrapRustJsPromiseBody, wrapRustJsPromiseCompletion } from "../../../../dist/backend/planner/declarations/callables/async-promise.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";
import { rustSourcePrimitiveTargetType, rustUnitTargetType } from "../../../../dist/target-model/types/index.js";

const integerCompletion = rustSourcePrimitiveTargetType("int32");
const unitCompletion = rustUnitTargetType();

test("the superseded Promise helpers without physical completion evidence are rejected", () => {
  const expression = { kind: "call", path: "body", args: [] };
  assert.throws(() => wrapRustJsPromiseCompletion(expression, false),
    /A Promise completion requires its sealed physical native carrier\./u);
  assert.throws(() => wrapRustJsPromiseBody({ statements: [{ kind: "tail", expr: expression }] }, false,
    { kind: "settled", settledAwaits: [] }), /A Promise body requires its sealed physical native completion\./u);
});

test("settled JS bodies run synchronously inside a native stack closure", () => {
  const body = { statements: [{ kind: "return", expr: { kind: "int-literal", text: "7" } }] };
  for (const fallible of [false, true]) {
    const wrapped = wrapRustJsPromiseBody(body, fallible, { kind: "settled", settledAwaits: [] }, integerCompletion);
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
    const wrapped = wrapRustJsPromiseBody(body, fallible, { kind: "factory", capturedParameters: [] }, unitCompletion);
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
  ];
  for (const expression of expressions) {
    const wrapped = wrapRustJsPromiseBody({ statements: [{ kind: "tail", expr: expression }] },
      false, { kind: "settled", settledAwaits: [] }, integerCompletion);
    assert.equal(wrapped.statements[0].expr.args[0] === expression, true,
      `${expression.kind}: preserve the exact owned completion`);
  }
});

test("native-body adapters transport the already-computed result directly", () => {
  for (const fallible of [false, true]) {
    const completion = { kind: "call", path: "crate::body", args: [{ kind: "path", path: "value" }] };
    const call = wrapRustJsPromiseCompletion(completion, fallible, integerCompletion).statements[0].expr;
    assert.equal(call.path, fallible ? "js_abi::JsPromise::from_result" : "js_abi::JsPromise::resolved",
      `${fallible}: selected settled constructor`);
    assert.equal(call.args[0] === completion, true, `${fallible}: one native invocation, no extra closure`);
  }
});

test("body-local exits and captured computations keep their native boundary", () => {
  const expressions = [
    { kind: "return-expression", expr: { kind: "int-literal", text: "7" } },
    { kind: "try", expr: { kind: "call", path: "fallible", args: [] } },
  ];
  for (const expression of expressions) {
    const wrapped = wrapRustJsPromiseBody({ statements: [{ kind: "tail", expr: expression }] },
      false, { kind: "settled", settledAwaits: [] }, integerCompletion);
    assert.equal(wrapped.statements[0].expr.args[0].kind, "invoke",
      `${expression.kind}: retain completion and capture lifetime`);
  }
});

test("settled tail errors preserve the exact native payload without a redundant closure", () => {
  const error = { kind: "call", path: "actual_error", args: [] };
  const tail = { kind: "throw", error, tail: true };
  const wrapped = wrapRustJsPromiseBody({ statements: [tail] }, true,
    { kind: "settled", settledAwaits: [] }, integerCompletion).statements[0].expr;
  assert.equal(wrapped.path, "js_abi::JsPromise::from_result", "the existing native rejection transport is retained");
  assert.equal(wrapped.args[0].kind, "call", "a completed Err value introduces no callable boundary");
  assert.equal(wrapped.args[0].path, "Err", "the native payload is not relabelled");
  assert.equal(wrapped.args[0].args[0] === error, true, "the identical original payload evaluates once");
  assert.equal(printRustExpr(wrapped), "js_abi::JsPromise::from_result(Err(actual_error()))");
  const body = { statements: [
    { kind: "let", name: "first", mutable: false, init: { kind: "call", path: "before", args: [] } }, tail,
  ] };
  const scoped = wrapRustJsPromiseBody(body, true, { kind: "settled", settledAwaits: [] }, integerCompletion).statements[0].expr;
  assert.equal(scoped.args[0].kind, "block", "earlier effects retain their lexical evaluation order");
  assert.equal(scoped.args[0].body === body, true, "no statement or payload is copied, lost or reordered");
  const attributed = { statements: [{ ...tail, attrs: [{ kind: "list", path: "cfg", arguments: [{ kind: "list", path: "all", arguments: [] }] }] }] };
  const preserved = wrapRustJsPromiseBody(attributed, true, { kind: "settled", settledAwaits: [] }, integerCompletion).statements[0].expr;
  assert.equal(preserved.args[0].kind, "block", "attributes prevent direct tail extraction");
  assert.equal(preserved.args[0].body === attributed, true, "the complete attributed syntax survives");
});

test("tail error payloads with real propagation and non-tail throws keep their boundary", () => {
  for (const statement of [
    { kind: "throw", error: { kind: "try", expr: { kind: "call", path: "actual_error", args: [] } }, tail: true },
    { kind: "throw", error: { kind: "path", path: "error" } },
  ]) {
    const body = { statements: [statement] };
    const wrapped = wrapRustJsPromiseBody(body, true, { kind: "settled", settledAwaits: [] }, integerCompletion).statements[0].expr;
    assert.equal(wrapped.args[0].kind, "invoke", "real return or question-mark still targets the original body");
    assert.equal(wrapped.args[0].callee.body === body, true, "the original completion body is retained unchanged");
  }
});

test("settled native calls and scoped computations introduce no redundant closure", () => {
  for (const expression of [
    { kind: "method-call", receiver: { kind: "path", path: "value" }, method: "read", args: [] },
    { kind: "field", receiver: { kind: "call", path: "read", args: [] }, name: "value" },
    { kind: "call", path: "Ok", args: [{ kind: "call", path: "read", args: [] }] },
    { kind: "closure", params: [], body: { kind: "return-expression", expr: { kind: "int-literal", text: "7" } } },
  ]) {
    const call = wrapRustJsPromiseBody({ statements: [{ kind: "tail", expr: expression }] }, false,
      { kind: "settled", settledAwaits: [] }, integerCompletion).statements[0].expr;
    assert.equal(call.args[0] === expression, true, `${expression.kind}: exactly one original expression`);
  }
  const body = { statements: [
    { kind: "let", name: "value", mutable: false, init: { kind: "call", path: "read", args: [] } },
    { kind: "tail", expr: { kind: "path", path: "value" } },
  ] };
  const call = wrapRustJsPromiseBody(body, false, { kind: "settled", settledAwaits: [] }, integerCompletion).statements[0].expr;
  assert.equal(call.args[0].kind, "block", "native locals keep one lexical evaluation scope");
  assert.equal(call.args[0].body === body, true, "no copied, reordered or dropped computation");
});

test("nested native early returns and error propagation retain their exact boundary", () => {
  for (const body of [
    { statements: [{ kind: "scope", body: { statements: [{ kind: "return", expr: { kind: "int-literal", text: "7" } }] } }] },
    { statements: [{ kind: "tail", expr: { kind: "call", path: "Ok", args: [
      { kind: "try", expr: { kind: "call", path: "read", args: [] } },
    ] } }] },
    { statements: [{ kind: "if", condition: { kind: "bool-literal", value: true },
      then: { statements: [{ kind: "return", expr: { kind: "int-literal", text: "7" } }] } }] },
  ]) {
    const call = wrapRustJsPromiseBody(body, true, { kind: "settled", settledAwaits: [] }, integerCompletion).statements[0].expr;
    assert.equal(call.args[0].kind, "invoke", "return and question-mark target this body, not the outer Promise factory");
    assert.equal(call.args[0].callee.body === body, true, "every early-exit/error operation is preserved");
  }
});

test("infallible native unit completion executes once before resolving the unit value", () => {
  for (const completion of [
    { kind: "call", path: "body", args: [] },
    { kind: "method-call", receiver: { kind: "path", path: "receiver" }, method: "body", args: [] },
    { kind: "invoke", callee: { kind: "path", path: "callback" }, args: [] },
    { kind: "tuple-literal", elements: [] },
  ]) {
    const selected = wrapRustJsPromiseCompletion(completion, false, unitCompletion).statements[0].expr;
    assert.equal(selected.kind, "evaluate-then", `${completion.kind}: native unit work precedes Promise construction`);
    assert.equal(selected.effect === completion, true, `${completion.kind}: preserve the sole original evaluation`);
    assert.equal(selected.discard, "unit", `${completion.kind}: the exact native unit value is discarded`);
    assert.equal(selected.value.path, "js_abi::JsPromise::resolved", `${completion.kind}: preserve shared Promise construction`);
    assert.equal(selected.value.args.length, 1, `${completion.kind}: exactly one resolved argument`);
    assert.equal(selected.value.args[0].kind, "tuple-literal", `${completion.kind}: pass the actual native unit literal`);
    assert.equal(selected.value.args[0].elements.length, 0, `${completion.kind}: no boxed or tagged absence payload`);
    const body = { statements: [{ kind: "tail", expr: completion }] };
    const wrapped = wrapRustJsPromiseBody(body, false, { kind: "settled", settledAwaits: [] }, unitCompletion);
    assert.equal(wrapped.statements[0].expr.effect === completion, true, `${completion.kind}: all settled bodies use the same recipe`);
  }
});

test("fallible unit completion preserves the complete native Result and rejection identity", () => {
  const completion = { kind: "call", path: "fallible_body", args: [] };
  const selected = wrapRustJsPromiseCompletion(completion, true, unitCompletion).statements[0].expr;
  assert.equal(selected.kind, "call", "a native Result<(), E> is a value, not a unit effect");
  assert.equal(selected.path, "js_abi::JsPromise::from_result", "the existing rejection transport remains authoritative");
  assert.equal(selected.args[0] === completion, true, "keep the exact original Result without re-running or mapping it");
});

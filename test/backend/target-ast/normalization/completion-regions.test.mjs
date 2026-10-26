import assert from "node:assert/strict";
import test from "node:test";
import { lowerRustCompletionScope } from "../../../../dist/backend/target-ast/normalization/completion-regions.js";
import { finalizeRustSourceStyle } from "../../../../dist/backend/target-ast/normalization/source-style.js";
import { emptyRustGenerics } from "../../../../dist/backend/target-ast/syntax/nodes.js";
import { printRustBlockStatements } from "../../../../dist/print/source/statements.js";

const path = name => ({ kind: "path", path: name });
const error = { kind: "named", path: "rt::TsonicError" };
const completion = { kind: "completion-exit", completion: "return", resultWrapped: true, expr: path("selected") };
const region = overrides => ({ kind: "try-scope", bodyName: "body_flow", flowName: "flow",
  dispatchResultWrapped: true,
  returnType: { kind: "primitive", name: "i32" }, errorType: error, asynchronous: false,
  body: { statements: [completion] }, bodyErrorType: error, bodyTerminates: true,
  propagate: false, dispatchReturn: true, dispatchTargets: [], terminates: true, ...overrides });
const styled = statement => finalizeRustSourceStyle({ headerComment: "native completion proof", items: [{
  kind: "function", name: "run", visibility: "public", params: [], generics: emptyRustGenerics,
  body: { statements: [statement] },
}] });

test("completion semantics are lowered before printing, never interpreted by the printer", () => {
  for (const asynchronous of [false, true]) {
    assert.throws(() => printRustBlockStatements({ statements: [region({ asynchronous })] }, 0),
      /Unsupported Rust unnormalized completion region syntax reached printer: (try|resource)-scope/u);
    const normalized = lowerRustCompletionScope(region({ asynchronous }));
    assert.equal(normalized.kind, "scope");
    // A synchronous region that is exactly one exit is that exit's value (no single-break labeled block).
    assert.equal(normalized.body.statements[0].init.kind, asynchronous ? "await" : "call");
    const text = printRustBlockStatements({ statements: [normalized] }, 0);
    assert.doesNotMatch(text, /completion_region|\|\||MaybeUninit|assume_init/u);
    assert.match(text, asynchronous ? /async \{[\s\S]*Ok\(rt::Completion::Return/u
      : /let body_flow: [^=]*= Ok\(rt::Completion::Return\(selected\)\);/u);
    if (asynchronous) assert.doesNotMatch(text, /return Ok\(rt::Completion::Return/u);
  }
});

test("native Result failure exits its lexical region and retains exact error conversion", () => {
  const failure = { kind: "try", expr: { kind: "call", path: "produce", args: [] },
    resultErrorType: error, operandErrorType: { kind: "named", path: "NativeError" } };
  const statement = region({ body: { statements: [{ kind: "let", name: "value", mutable: false, init: failure }] },
    bodyTerminates: false, terminates: false });
  const text = printRustBlockStatements({ statements: [lowerRustCompletionScope(statement)] }, 0);
  assert.match(text, /match produce\(\)[\s\S]*Err\(error\) => break 'body_flow Err\(rt::TsonicError::from\(error\)\)/u);
  assert.doesNotMatch(text, /produce\(\)\?/u);
  const asyncText = printRustBlockStatements({ statements: [lowerRustCompletionScope({ ...statement, asynchronous: true })] }, 0);
  assert.match(asyncText, /produce\(\)\?/u);
});

test("completion return Result shape is independent of the local throw channel", () => {
  for (const dispatchResultWrapped of [false, true]) {
    const statement = region({ dispatchResultWrapped, errorType: undefined, bodyErrorType: undefined,
      body: { statements: [{ ...completion, resultWrapped: false }] } });
    const text = printRustBlockStatements({ statements: [lowerRustCompletionScope(statement)] }, 0);
    assert.equal(text.includes("rt::Completion::Return(value) => Ok(value)"), dispatchResultWrapped,
      "only the exact outward Result target wraps the returned native value");
    assert.equal(text.includes("let body_flow: rt::Completion<i32, ()> = rt::Completion::Return(selected);"), true,
      "the pure local completion never acquires a synthetic Result envelope");
    assert.equal(text.includes("Err("), false, "a return ABI adds no inhabited error path");
  }
});

test("nested pure completions reach the single outer Result return target", () => {
  const child = region({ bodyName: "child_body", flowName: "child_flow", errorType: undefined, bodyErrorType: undefined,
    dispatchResultWrapped: false, propagate: true, body: { statements: [{ ...completion, resultWrapped: false }] } });
  const parent = region({ errorType: undefined, bodyErrorType: undefined, dispatchResultWrapped: true,
    body: { statements: [child] } });
  const source = styled(parent);
  const text = printRustBlockStatements(source.items[0].body, 0);
  assert.equal(text.includes("rt::Completion::Return(value) => Ok(value)"), true,
    "the callable's outward boundary alone adds its native Ok");
  assert.equal(text.includes("Ok(rt::Completion::Return"), false,
    "neither pure inner boundary returns a Result to its pure parent");
});

test("pure resource cleanup precedes its exact Result return dispatch", () => {
  const scope = { kind: "resource-scope", flowName: "resource_flow", cleanupName: "cleanup_flow",
    returnType: { kind: "primitive", name: "i32" }, errorType: undefined, asynchronous: false,
    body: { statements: [{ ...completion, resultWrapped: false }] },
    cleanup: { statements: [{ kind: "expr", expr: { kind: "call", path: "cleanup", args: [] } }] },
    propagate: false, dispatchResultWrapped: true, dispatchReturn: true, dispatchTargets: [], terminates: true };
  const text = printRustBlockStatements({ statements: [lowerRustCompletionScope(scope)] }, 0);
  assert.equal(text.split("cleanup();").length - 1, 1, "the original cleanup is present exactly once");
  assert.equal(text.includes("rt::Completion::Return(value) => Ok(value)"), true,
    "the resource returns through its actual outer Result ABI");
  assert.equal(text.indexOf("cleanup();") < text.indexOf("rt::Completion::Return(value) => Ok(value)"), true,
    "the original pure cleanup runs before outward return dispatch");
  assert.equal(text.includes("finish_resource"), false, "pure cleanup invents no fallible suppression channel");
  assert.equal(text.includes("Result<"), false, "only the real native return ABI is wrapped, not local resource values");
});

test("completion dispatch rejects a missing required return-result shape", () => {
  const missing = region({});
  delete missing.dispatchResultWrapped;
  assert.throws(() => lowerRustCompletionScope(missing), /exact nearest return-result shape/u,
    "there is no compatibility default from the unrelated error-effect field");
});

test("genuine callable boundaries retain their own returns while nested completions propagate", () => {
  const callback = { kind: "closure-block", params: [], move: false, async: false,
    body: { statements: [{ kind: "return", expr: path("callback_value") }] } };
  const child = region({ bodyName: "child_body", flowName: "child_flow", propagate: true });
  const statement = region({ body: { statements: [
    { kind: "let", name: "read", mutable: false, init: callback }, child,
  ] } });
  const lowered = lowerRustCompletionScope(statement);
  const capture = lowered.body.statements[0].init;
  assert.equal(capture.body.statements[0].init, callback);
  const text = printRustBlockStatements({ statements: [lowered] }, 0);
  assert.match(text, /return callback_value;/u);
  for (const completion of ["Return", "Break", "Continue"]) {
    assert.equal(text.includes(`rt::Completion::${completion}(value) => break 'body_flow Ok(rt::Completion::${completion}(value))`), true, completion);
  }
  assert.doesNotMatch(text, /break 'body_flow callback_value/u);
});

test("resource cleanup retains suppression, loop targets and ordered continue prelude", () => {
  const statement = { kind: "resource-scope", flowName: "resource_flow", cleanupName: "cleanup_flow",
    dispatchResultWrapped: true,
    returnType: { kind: "unit" }, errorType: error, asynchronous: false,
    body: { statements: [{ kind: "completion-exit", completion: "continue", loopId: 3, resultWrapped: true }] },
    cleanup: { statements: [{ kind: "expr", expr: { kind: "try", expr: { kind: "call", path: "dispose", args: [] },
      resultErrorType: error, operandErrorType: error } }] },
    propagate: false, dispatchReturn: false, dispatchTargets: [{ kind: "loop", id: 3, label: "outer",
      continuePrelude: [{ kind: "expr", expr: { kind: "call", path: "increment", args: [] } }] }], terminates: true };
  const text = printRustBlockStatements({ statements: [lowerRustCompletionScope(statement)] }, 0);
  assert.match(text, /let resource_flow: [^=]*= Ok\(rt::Completion::Continue\(3\)\);/u);
  assert.match(text, /Err\(error\) => break 'cleanup_flow Err\(error\)/u);
  assert.match(text, /rt::finish_resource\(resource_flow, cleanup_flow\)\?/u);
  assert.match(text, /rt::Completion::Continue\(3\)[\s\S]*increment\(\);[\s\S]*continue 'outer/u);
});

test("completion operands exit only after their fallible native value is evaluated", () => {
  const value = { kind: "try", expr: { kind: "call", path: "construct", args: [] },
    resultErrorType: error, operandErrorType: error };
  for (const terminal of [{ kind: "throw", error: value }, { ...completion, expr: value }]) {
    const lowered = lowerRustCompletionScope(region({ body: { statements: [terminal] } }));
    const capture = lowered.body.statements[0].init;
    const exit = capture.body.statements[0].expr;
    assert.equal(exit.kind, "block");
    assert.equal(exit.body.statements[0].kind, "let");
    assert.equal(exit.body.statements[0].name, "body_flow");
    assert.equal(exit.body.statements[1].expr.kind, "break-expression");
    assert.equal(exit.body.statements[1].expr.expr.kind, "path");
    const normalized = styled(region({ body: { statements: [terminal] } }));
    assert.equal(JSON.stringify(finalizeRustSourceStyle(normalized)) === JSON.stringify(normalized), true);
    const text = printRustBlockStatements(normalized.items[0].body, 0);
    assert.match(text, /let body_flow = [\s\S]*match construct\(\)/u);
    assert.match(text, /break 'body_flow body_flow/u);
    assert.doesNotMatch(text, /completion_region|\|\||MaybeUninit|assume_init/u);
  }
});

test("normalization is idempotent and cannot discard a label still used inside its terminal value", () => {
  const statement = region({ body: { statements: [{ kind: "completion-exit", completion: "return", resultWrapped: true,
    expr: { kind: "try", expr: { kind: "call", path: "produce", args: [] }, resultErrorType: error, operandErrorType: error } }] } });
  const result = styled(statement);
  assert.deepEqual(finalizeRustSourceStyle(result), result);
  const text = printRustBlockStatements(result.items[0].body, 0);
  assert.match(text, /'body_flow:/u);
  assert.match(text, /break 'body_flow Err\(error\)/u);
  const simple = styled(region({ body: { statements: [completion] } }));
  assert.doesNotMatch(printRustBlockStatements(simple.items[0].body, 0), /'body_flow:|break 'body_flow/u);
});

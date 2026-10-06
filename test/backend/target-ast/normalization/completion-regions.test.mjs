import assert from "node:assert/strict";
import test from "node:test";
import { lowerRustCompletionScope } from "../../../../dist/backend/target-ast/normalization/completion-regions.js";
import { finalizeRustSourceStyle } from "../../../../dist/backend/target-ast/normalization/source-style.js";
import { emptyRustGenerics } from "../../../../dist/backend/target-ast/nodes.js";
import { printRustBlockStatements } from "../../../../dist/print/source/blocks.js";

const path = name => ({ kind: "path", path: name });
const error = { kind: "named", path: "rt::TsonicError" };
const completion = { kind: "completion-exit", completion: "return", resultWrapped: true, expr: path("selected") };
const region = overrides => ({ kind: "try-scope", bodyName: "body_flow", flowName: "flow",
  returnType: { kind: "primitive", name: "i32" }, fallible: true, asynchronous: false,
  body: { statements: [completion] }, bodyFallible: true, bodyTerminates: true,
  propagate: false, dispatchReturn: true, dispatchTargets: [], terminates: true, ...overrides });
const styled = statement => finalizeRustSourceStyle({ headerComment: "native completion proof", items: [{
  kind: "function", name: "run", visibility: "public", params: [], generics: emptyRustGenerics,
  body: { statements: [statement] },
}] });

test("completion semantics are lowered before printing, never interpreted by the printer", () => {
  for (const asynchronous of [false, true]) {
    assert.throws(() => printRustBlockStatements({ statements: [region({ asynchronous })] }, 0),
      /must be normalized to native AST/u);
    const normalized = lowerRustCompletionScope(region({ asynchronous }));
    assert.equal(normalized.kind, "scope");
    assert.equal(normalized.body.statements[0].init.kind, asynchronous ? "await" : "block");
    const text = printRustBlockStatements({ statements: [normalized] }, 0);
    assert.doesNotMatch(text, /completion_region|\|\||MaybeUninit|assume_init/u);
    assert.match(text, asynchronous ? /async \{[\s\S]*Ok\(rt::Completion::Return/u
      : /'body_flow:[\s\S]*break 'body_flow Ok\(rt::Completion::Return/u);
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
    returnType: { kind: "unit" }, fallible: true, asynchronous: false,
    body: { statements: [{ kind: "completion-exit", completion: "continue", loopId: 3, resultWrapped: true }] },
    cleanup: { statements: [{ kind: "expr", expr: { kind: "try", expr: { kind: "call", path: "dispose", args: [] },
      resultErrorType: error, operandErrorType: error } }] },
    propagate: false, dispatchReturn: false, dispatchTargets: [{ kind: "loop", id: 3, label: "outer",
      continuePrelude: [{ kind: "expr", expr: { kind: "call", path: "increment", args: [] } }] }], terminates: true };
  const text = printRustBlockStatements({ statements: [lowerRustCompletionScope(statement)] }, 0);
  assert.match(text, /break 'resource_flow Ok\(rt::Completion::Continue\(3\)\)/u);
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

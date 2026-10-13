import assert from "node:assert/strict";
import test from "node:test";
import { lowerRustCompletionScope } from "../../../../dist/backend/target-ast/normalization/completion-regions.js";
import { rustItemsReferenceModuleAlias } from "../../../../dist/backend/target-ast/inspection/source-module-usage.js";
import { emptyRustGenerics } from "../../../../dist/backend/target-ast/syntax/nodes.js";
import { printRustBlockStatements } from "../../../../dist/print/source/blocks.js";

const nativeError = { kind: "qualified", owner: { kind: "named", path: "Producer" },
  trait: { kind: "named", path: "callback::Invoke" }, member: "Error" };
const region = (errorType, overrides = {}) => ({
  kind: "try-scope", bodyName: "body_flow", flowName: "flow", returnType: { kind: "unit" },
  errorType, bodyErrorType: errorType, asynchronous: false,
  body: { statements: errorType === undefined ? [] : [{ kind: "expr", expr: {
    kind: "try", expr: { kind: "call", path: "produce", args: [] }, operandErrorType: errorType, resultErrorType: errorType,
  } }] }, bodyTerminates: false, propagate: false, dispatchReturn: false, dispatchTargets: [], terminates: false,
  ...overrides,
});
const capturedError = statement => statement.type.genericArguments[1].type;
const printed = scope => printRustBlockStatements({ statements: [lowerRustCompletionScope(scope)] }, 0);

test("completion captures retain exact named, associated and borrowed error types without coercion", () => {
  const errors = [nativeError, { kind: "named", path: "ForeignError", identity: "foreign:error" },
    { kind: "reference", mutable: true, lifetime: { kind: "named", name: "scope" }, referent: { kind: "primitive", name: "u32" } }];
  for (const [index, errorType] of errors.entries()) {
    for (const asynchronous of [false, true]) {
      const scope = region(errorType, { asynchronous });
      const statements = lowerRustCompletionScope(scope).body.statements;
      assert.equal(capturedError(statements[0]) === errorType, true, `capture ${index}`);
      assert.equal(capturedError(statements[1]) === errorType, true, `flow ${index}`);
      assert.equal(statements[2].init.resultErrorType === errorType, true, `outgoing ${index}`);
      assert.equal(statements[2].init.operandErrorType === errorType, true, `incoming ${index}`);
      const text = printed(scope);
      assert.match(text, /core::result::Result</u);
      assert.doesNotMatch(text, /TsonicError|TsonicResult|::from\(|\.clone\(|Default|Box|dyn |'static/u);
      assert.match(text, asynchronous ? /produce\(\)\?/u : /Err\(error\) => break 'body_flow Err\(error\)/u);
    }
  }
});

test("catch captures keep their own error distinct from the handled body's exact error", () => {
  const handled = { kind: "named", path: "dependency::Error", identity: "dependency:error" };
  const caught = { binding: "error", body: { statements: [] }, errorType: nativeError, terminates: false };
  const scope = region(handled, { errorType: nativeError, catchClause: caught });
  const statements = lowerRustCompletionScope(scope).body.statements;
  assert.equal(capturedError(statements[0]) === handled, true);
  assert.equal(capturedError(statements[1]) === nativeError, true);
  assert.equal(capturedError(statements[1].init.arms[1].expression.body.statements[0]) === nativeError, true);
  assert.equal(statements[2].init.resultErrorType === nativeError, true);
  assert.doesNotMatch(printed(scope), /::from\(|TsonicError|TsonicResult/u);
});

test("finally joins only exact errors and lifts pure completion values without adding error carriers", () => {
  for (const bodyFallible of [false, true]) {
    for (const finallyFallible of [false, true]) {
      const errorType = bodyFallible || finallyFallible ? nativeError : undefined;
      const scope = region(bodyFallible ? nativeError : undefined, {
        errorType, finallyName: "finally_flow", finallyClause: {
          body: { statements: [] }, errorType: finallyFallible ? nativeError : undefined, terminates: false,
        },
      });
      const statements = lowerRustCompletionScope(scope).body.statements;
      const joined = statements[3];
      if (errorType === undefined) {
        assert.equal(joined.type.path, "rt::Completion");
        assert.equal(joined.init.kind, "match");
        assert.doesNotMatch(printed(scope), /Result|finish_finally|\bOk\(|\?/u);
      } else {
        assert.equal(capturedError(joined) === nativeError, true);
        assert.equal(joined.init.path, "rt::finish_finally");
        assert.equal(joined.init.args[0].kind, bodyFallible ? "path" : "call");
        assert.equal(joined.init.args[1].kind, finallyFallible ? "path" : "call");
        assert.equal(statements[4].init.resultErrorType === nativeError, true);
        assert.doesNotMatch(printed(scope), /TsonicError|TsonicResult|::from\(/u);
      }
    }
  }
});

test("completion contracts reject absent evidence, pure catches and unplanned error joins", () => {
  for (const key of ["errorType", "bodyErrorType"]) {
    const scope = region(nativeError);
    delete scope[key];
    assert.throws(() => lowerRustCompletionScope(scope), /explicit exact error/u);
  }
  for (const clause of ["catchClause", "finallyClause"]) {
    assert.throws(() => lowerRustCompletionScope(region(nativeError, {
      [clause]: { binding: "error", body: { statements: [] }, fallible: true, terminates: false },
    })), /explicit exact error/u);
  }
  assert.throws(() => lowerRustCompletionScope(region(undefined, { catchClause: {
    binding: "error", body: { statements: [] }, errorType: undefined, terminates: false,
  } })), /catch completion requires an exact body error/u);
  assert.throws(() => lowerRustCompletionScope(region(nativeError, { errorType: undefined })), /exact enclosing error/u);
  assert.throws(() => lowerRustCompletionScope(region(nativeError, { finallyName: "finally_flow", finallyClause: {
    body: { statements: [] }, errorType: { kind: "named", path: "OtherError" }, terminates: false,
  } })), /one exact joined error/u);
});

test("resource completion preserves the concrete selected suppression owner's exact error", () => {
  const errorType = { kind: "named", path: "rt::TsonicError", identity: "package:resource-owner" };
  const scope = { kind: "resource-scope", flowName: "flow", cleanupName: "cleanup", returnType: { kind: "unit" },
    errorType, asynchronous: false, body: { statements: [] }, cleanup: { statements: [] },
    propagate: false, dispatchReturn: false, dispatchTargets: [], terminates: false };
  const statements = lowerRustCompletionScope(scope).body.statements;
  assert.equal(capturedError(statements[0]) === errorType, true);
  assert.equal(capturedError(statements[1]) === errorType, true);
  assert.equal(statements[2].init.expr.path, "rt::finish_resource");
  assert.equal(statements[2].init.operandErrorType === errorType, true);
  assert.equal(statements[2].init.resultErrorType === errorType, true);
  const missing = { ...scope };
  delete missing.errorType;
  assert.throws(() => lowerRustCompletionScope(missing), /explicit exact error/u);
});

test("completion-only exact error types retain their imported module aliases", () => {
  const referenced = scope => rustItemsReferenceModuleAlias([{ kind: "function", name: "run", visibility: "private",
    params: [], generics: emptyRustGenerics, body: { statements: [scope] } }], "callback");
  for (const scope of [
    region(undefined, { errorType: nativeError }),
    region(undefined, { bodyErrorType: nativeError }),
    region(undefined, { catchClause: { binding: "error", body: { statements: [] }, errorType: nativeError, terminates: false } }),
    region(undefined, { finallyClause: { body: { statements: [] }, errorType: nativeError, terminates: false } }),
    { kind: "resource-scope", returnType: { kind: "unit" }, errorType: nativeError, body: { statements: [] },
      cleanup: { statements: [] }, dispatchTargets: [] },
  ]) {
    assert.equal(referenced(scope), true);
  }
  assert.equal(referenced(region(undefined)), false);
});

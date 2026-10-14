import assert from "node:assert/strict";
import test from "node:test";
import { planRustBinaryErrors } from "../../../../dist/backend/planner/program/binary-errors.js";
import { planRustAsyncExecution } from "../../../../dist/backend/planner/program/async-execution.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";

const lifecycle = { kind: "named", path: "RuntimeError", identity: "runtime-error" };
const provider = { kind: "named", path: "ProviderError", identity: "provider-error" };
const result = { kind: "call", path: "operation", args: [] };
const lifecycleSelection = { sources: [{ kind: "lifecycle", identity: "lifecycle", variant: "Lifecycle" }] };

test("binary initialization preserves its selected error without an ambient conversion", () => {
  const selected = planRustBinaryErrors(lifecycleSelection, lifecycle);
  assert.equal(selected.errorType === lifecycle, true);
  assert.equal(printRustExpr(selected.lifecycle(result, lifecycle)), "operation()?");
  assert.doesNotMatch(printRustExpr(selected.lifecycle(result, lifecycle)), /Box|clone|from|unwrap/u);
});

test("binary lifecycle converts a provider error once without a second implicit-entry sum", () => {
  const selected = planRustBinaryErrors(lifecycleSelection, lifecycle);
  assert.equal(printRustExpr(selected.lifecycle(result, provider)), "operation().map_err(RuntimeError::from)?");
  assert.doesNotMatch(printRustExpr(selected.lifecycle(result, provider)), /Box|clone|BinaryErrors|unwrap/u);
  assert.equal(printRustExpr(selected.lifecycleError({ kind: "path", path: "error" }, provider)), "RuntimeError::from(error)");
});

test("equivalent lifecycle error aliases do not acquire a redundant conversion", () => {
  const selected = planRustBinaryErrors(lifecycleSelection, lifecycle);
  assert.equal(selected.errorType === lifecycle, true);
  assert.equal(printRustExpr(selected.lifecycle(result, { ...lifecycle, path: "other::Alias" })), "operation()?");
});

test("binary errors have no implicit source entry operation and retain native error identity", () => {
  const selected = planRustBinaryErrors(lifecycleSelection, lifecycle);
  assert.equal(Object.hasOwn(selected, "entry"), false);
  const error = { kind: "path", path: "error" };
  assert.equal(selected.lifecycleError(error, lifecycle) === error, true);
  assert.equal(Object.isFrozen(selected), true);
});

test("native initialization errors retain their exact channel without a package conversion", () => {
  const original = { kind: "named", path: "OriginalError", identity: "original-error" };
  const source = { identity: "initialization", variant: "Initialization", errorType: original };
  const selected = planRustBinaryErrors({ sources: [...lifecycleSelection.sources,
    { kind: "initialization", identity: source.identity, variant: source.variant }] }, lifecycle, [source]);
  assert.equal(selected.items.length, 1);
  assert.equal(selected.items[0].kind, "enum");
  assert.equal(selected.errorType.genericArguments[1].type === original, true, "the original native payload is retained");
  const propagated = selected.propagate(source, result);
  assert.equal(propagated.expr.args[0].name, "Initialization");
  assert.equal(propagated.expr.args[0].owner === selected.errorType, true, "one exact startup sum owns injection");
  assert.doesNotMatch(printRustExpr(propagated), /Box|clone|from|unwrap/u);
  assert.throws(() => selected.propagate({ ...source, identity: "foreign" }, result), /exact selected native error channel/u);
  assert.throws(() => selected.propagate({ ...source, errorType: provider }, result), /exact selected native error channel/u);
  const lifecycleResult = printRustExpr(selected.lifecycle(result, provider));
  assert.equal((lifecycleResult.match(/RuntimeError::from/gu) ?? []).length, 1, "provider conversion occurs exactly once");
});

test("an initialization-only executable has no unused lifecycle variant or error wrapper", () => {
  const source = { identity: "initialization", variant: "Initialization", errorType: provider };
  const selected = planRustBinaryErrors({ sources: [
    { kind: "initialization", identity: source.identity, variant: source.variant }] }, lifecycle, [source]);
  assert.equal(selected.errorType === provider, true, "one native error is transported directly");
  assert.equal(selected.items.length, 0, "no redundant error enum is emitted");
  assert.equal(printRustExpr(selected.propagate(source, result)), "operation()?");
  assert.throws(() => selected.lifecycle(result, lifecycle), /exact selected native error channel/u);
});

test("native async executors propagate their own error exactly once without consuming the future output", () => {
  const calls = [];
  const propagate = (expression, hook) => { calls.push(hook); return { kind: "reference", expr: expression }; };
  for (const executor of [undefined, { isFallible: false }])
    assert.equal(planRustAsyncExecution(result, executor, propagate) === result, true);
  const executor = { isFallible: true, errorBoundary: "provider-native" };
  const selected = planRustAsyncExecution(result, executor, propagate);
  assert.equal(selected.expr === result, true);
  assert.deepEqual(calls, [executor]);
});

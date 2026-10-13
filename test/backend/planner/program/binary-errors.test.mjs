import assert from "node:assert/strict";
import test from "node:test";
import { planRustBinaryErrors } from "../../../../dist/backend/planner/program/binary-errors.js";
import { planRustAsyncExecution } from "../../../../dist/backend/planner/program/async-execution.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";

const lifecycle = { kind: "named", path: "RuntimeError", identity: "runtime-error" };
const provider = { kind: "named", path: "ProviderError", identity: "provider-error" };
const result = { kind: "call", path: "operation", args: [] };

test("binary initialization preserves its selected error without an ambient conversion", () => {
  const selected = planRustBinaryErrors(lifecycle);
  assert.equal(selected.errorType === lifecycle, true);
  assert.equal(printRustExpr(selected.lifecycle(result, lifecycle)), "operation()?");
  assert.doesNotMatch(printRustExpr(selected.lifecycle(result, lifecycle)), /Box|clone|from|unwrap/u);
});

test("binary lifecycle converts a provider error once without a second implicit-entry sum", () => {
  const selected = planRustBinaryErrors(lifecycle);
  assert.equal(printRustExpr(selected.lifecycle(result, provider)), "operation().map_err(RuntimeError::from)?");
  assert.doesNotMatch(printRustExpr(selected.lifecycle(result, provider)), /Box|clone|BinaryErrors|unwrap/u);
  assert.equal(printRustExpr(selected.lifecycleError({ kind: "path", path: "error" }, provider)), "RuntimeError::from(error)");
});

test("equivalent lifecycle error aliases do not acquire a redundant conversion", () => {
  const selected = planRustBinaryErrors(lifecycle);
  assert.equal(selected.errorType === lifecycle, true);
  assert.equal(printRustExpr(selected.lifecycle(result, { ...lifecycle, path: "other::Alias" })), "operation()?");
});

test("binary errors have no implicit source entry operation and retain native error identity", () => {
  const selected = planRustBinaryErrors(lifecycle);
  assert.equal(Object.hasOwn(selected, "entry"), false);
  const error = { kind: "path", path: "error" };
  assert.equal(selected.lifecycleError(error, lifecycle) === error, true);
  assert.equal(Object.isFrozen(selected), true);
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

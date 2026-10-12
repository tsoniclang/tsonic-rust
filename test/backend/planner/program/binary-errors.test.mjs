import assert from "node:assert/strict";
import test from "node:test";
import { planRustBinaryErrors } from "../../../../dist/backend/planner/program/binary-errors.js";
import { planRustAsyncExecution } from "../../../../dist/backend/planner/program/async-execution.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";

const lifecycle = { kind: "named", path: "RuntimeError", identity: "runtime-error" };
const entry = { kind: "named", path: "application::EntryError", identity: "entry-error" };
const provider = { kind: "named", path: "ProviderError", identity: "provider-error" };
const result = { kind: "call", path: "operation", args: [] };

test("native binary preserves its source entry error without an ambient conversion", () => {
  const selected = planRustBinaryErrors({ entryErrorType: entry, lifecycleErrorType: lifecycle, lifecycleFallible: false });
  assert.equal(selected !== undefined, true);
  assert.equal(selected.errorType === entry, true);
  assert.equal(selected.items.length, 0);
  assert.equal(printRustExpr(selected.entry(result)), "operation()?");
  assert.throws(() => selected.lifecycle(result, lifecycle), /exact native source/u);
});

test("binary lifecycle and entry errors share the existing allocation-free exact sum", () => {
  const selected = planRustBinaryErrors({ entryErrorType: entry, lifecycleErrorType: lifecycle, lifecycleFallible: true });
  assert.equal(selected !== undefined, true);
  assert.equal(selected.items.length, 1);
  assert.deepEqual(selected.errorType.genericArguments.map(argument => argument.type), [lifecycle, entry]);
  assert.match(printRustExpr(selected.entry(result)), /map_err\(BinaryErrors::<RuntimeError, application::EntryError>::Entry\)\?/u);
  assert.match(printRustExpr(selected.lifecycle(result, provider)), /map_err\(RuntimeError::from\)\.map_err\(BinaryErrors::<RuntimeError, application::EntryError>::Lifecycle\)\?/u);
  assert.doesNotMatch(printRustExpr(selected.entry(result)), /Box|clone|from|unwrap/u);
  assert.match(printRustExpr(selected.lifecycleError({ kind: "path", path: "error" }, provider)),
    /BinaryErrors::<RuntimeError, application::EntryError>::Lifecycle\(RuntimeError::from\(error\)\)/u);
});

test("equivalent entry and lifecycle errors do not acquire a redundant sum", () => {
  const selected = planRustBinaryErrors({ entryErrorType: { ...lifecycle, path: "other::Alias" },
    lifecycleErrorType: lifecycle, lifecycleFallible: true });
  assert.equal(selected !== undefined, true);
  assert.equal(selected.items.length, 0);
  assert.equal(selected.errorType === lifecycle, true);
  assert.equal(printRustExpr(selected.entry(result)), "operation()?");
  assert.equal(printRustExpr(selected.lifecycle(result, lifecycle)), "operation()?");
});

test("infallible entry cannot invent an error source while lifecycle remains precise", () => {
  const selected = planRustBinaryErrors({ entryErrorType: undefined, lifecycleErrorType: lifecycle, lifecycleFallible: true });
  assert.equal(selected !== undefined, true);
  assert.equal(selected.items.length, 0);
  assert.throws(() => selected.entry(result), /infallible binary entry/u);
  assert.equal(printRustExpr(selected.lifecycle(result, provider)), "operation().map_err(RuntimeError::from)?");
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

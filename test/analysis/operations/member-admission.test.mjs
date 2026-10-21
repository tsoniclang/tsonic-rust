import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustOperations } from "../../helpers/rust-operation-analysis.mjs";
import { selectRustCheckedElementAccess, selectRustCheckedPropertyAccess } from "../../../dist/analysis/operations/selected-members.js";
import { checkedPropertySelectionInput } from "../../../dist/analysis/operations/member-access.js";
import { rustOperationContext } from "../../../dist/analysis/program/walk.js";
import { createRustCarrierProbe } from "../../../dist/analysis/program/carrier-probe.js";

test("callee selection and normal property resolution share one admitted native member", () => {
  const { context, walk, admissions } = analyzeRustOperations(`
    import type { int32 } from "@tsonic/core/types.js";
    interface Handler { run: (value: int32) => int32; }
    export function invoke(handler: Handler, value: int32): int32 { return handler.run(value); }
  `, { surfaces: [] });
  const expression = context.sourceStorage.nodes.find(node => context.ast.is.IsPropertyAccessExpression(node));
  assert.equal(expression !== undefined, true);
  const current = rustOperationContext(walk, expression);
  const source = current.currentSemantics.operations.propertyAccess(expression);
  const request = checkedPropertySelectionInput(current, expression, source);
  const completed = walk.operationAttempts.get(expression);
  assert.equal(completed?.kind, "property");
  const unreadable = new Proxy({}, { get() { throw new Error("member resolution replayed"); } });
  const guarded = { ...current, ast: unreadable, currentSemantics: unreadable };
  const repeated = selectRustCheckedPropertyAccess({ ...request }, guarded, walk.operationOptions);
  assert.equal(repeated === completed.selection, true);
  assert.equal(repeated.value.operation === context.records.selectedOperation.get(expression), true);
  assert.equal(repeated.value.targetFact === context.records.targetOperation.get(expression), true);
  assert.equal(admissions.target.get(expression), 1, "the early callee and ordinary walker admit one target");
  assert.equal(admissions.operation.get(expression), 1, "the early callee and ordinary walker admit one operation");
  for (const changed of [{ ...request, receiver: {} }, { ...request, accessMode: "write" },
    { ...request, sourceReadType: {} }, { ...request, sourceSelectedWriteDeclaration: {} }]) {
    assert.throws(() => selectRustCheckedPropertyAccess(changed, guarded, walk.operationOptions), /Conflicting Rust checked member request/u);
  }
  const probe = createRustCarrierProbe(walk);
  assert.equal(probe.operationAttempts.has(expression), false);
  const inherited = selectRustCheckedPropertyAccess(request, rustOperationContext(probe, expression), probe.operationOptions);
  assert.equal(inherited.kind, "accept");
  assert.equal(inherited.value.operation === repeated.value.operation, true);
  assert.equal(inherited.value.targetFact === repeated.value.targetFact, true);
  context.records.seal(context.requiredRecords);
  assert.throws(() => selectRustCheckedPropertyAccess(unreadable, guarded, walk.operationOptions), /sealed/u);
});

test("an element request returns its complete canonical native index decision", () => {
  const { context, walk, admissions } = analyzeRustOperations("export function at(values: number[], index: number): number { return values[index]; }");
  const expression = context.sourceStorage.nodes.find(node => context.ast.is.IsElementAccessExpression(node));
  assert.equal(expression !== undefined, true);
  const completed = walk.operationAttempts.get(expression);
  assert.equal(completed?.kind, "element");
  const current = rustOperationContext(walk, expression);
  const unreadable = new Proxy({}, { get() { throw new Error("element resolution replayed"); } });
  const guarded = { ...current, ast: unreadable, currentSemantics: unreadable };
  const repeated = selectRustCheckedElementAccess({ ...completed.request }, guarded, walk.operationOptions);
  assert.equal(repeated === completed.selection, true);
  assert.equal(admissions.target.get(expression), 1);
  assert.equal(admissions.operation.get(expression), 1);
  for (const changed of [{ ...completed.request, argument: {} }, { ...completed.request, sourceArgumentType: {} },
    { ...completed.request, sourceSelectedElementIndex: 1 }]) {
    assert.throws(() => selectRustCheckedElementAccess(changed, guarded, walk.operationOptions), /Conflicting Rust checked member request/u);
  }
  context.records.seal(context.requiredRecords);
  assert.throws(() => selectRustCheckedElementAccess(unreadable, guarded, walk.operationOptions), /sealed/u);
});

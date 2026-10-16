import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";

import { rustBorrowedElementRead, rustBorrowPureProviderInputs } from "../../../dist/analysis/program/borrowed-element-purity.js";
import { finalizeRustProviderOperationAbi } from "../../../dist/analysis/operations/finalized-operation/finalize.js";

test("borrowed indexed reads require their own exact pure operation, not owned Clone purity", () => {
  const { source, program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    export function length(values: string[]): number { return values[0]!.length; }
  ` } });
  let receiver;
  let element;
  const visit = node => {
    if (source.ast.is.IsNonNullExpression(node)) receiver = node;
    if (source.ast.is.IsElementAccessExpression(node)) element = node;
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.ok(receiver);
  assert.ok(element);
  const operation = program.records.targetOperation.get(element);
  assert.equal(operation?.kind, "provider-operation");
  assert.equal(operation.abi.effects.evaluation, "observable");
  assert.deepEqual(operation.borrowedIndexOperation, { method: "borrow_number_element", evaluation: "pure" });
  assert.ok(Object.isFrozen(operation.borrowedIndexOperation));
  assert.equal(rustBorrowedElementRead(receiver, source.ast, program.records)?.method, "borrow_number_element");
  for (const replacement of [
    { ...operation, borrowedIndexOperation: undefined },
    { ...operation, borrowedIndexOperation: { evaluation: "pure" } },
    { ...operation, borrowedIndexOperation: { ...operation.borrowedIndexOperation, extra: true } },
    { ...operation, borrowedIndexOperation: { ...operation.borrowedIndexOperation, method: "" } },
    { ...operation, borrowedIndexOperation: { ...operation.borrowedIndexOperation, evaluation: "observable" } },
    { ...operation, borrowedIndexOperation: { ...operation.borrowedIndexOperation, method: "read; mutate()" } },
    ...[{ safety: "requires-unsafe" }, { invocation: "fallible" }].map(effects => ({ ...operation,
      abi: { ...operation.abi, effects: { ...operation.abi.effects, ...effects } } })),
    { ...operation, abi: { ...operation.abi, result: { ...operation.abi.result, kind: "async" } } },
  ]) {
    const records = createRustRecordFixture({
targetOperation: { get: (subject) => {
    return subject === element
        ? replacement : program.records.targetOperation.get(subject);
} }}, program.records);
    assert.equal(rustBorrowedElementRead(receiver, source.ast, records), undefined);
  }
});

test("provider purity includes an evaluation-only receiver even when the target takes only its index", () => {
  const { source, program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    function selected(): string[] { return ["value"]; }
    export function observed(): number { return selected()[0]!.length; }
  ` } });
  let element;
  const visit = node => {
    if (source.ast.is.IsElementAccessExpression(node)) element = node;
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(element !== undefined, true, "the checked source contains its selected indexed read");
  const operation = program.records.targetOperation.get(element);
  assert.equal(operation?.kind, "provider-operation");
  const receiver = source.ast.as.AsElementAccessExpression(element).Expression;
  const index = source.ast.as.AsElementAccessExpression(element).ArgumentExpression;
  const abi = finalizeRustProviderOperationAbi({ operationKind: "indexer",
    form: { form: "call", path: "fixture::selected_index", argModes: ["value"] },
    sourceReceiver: { kind: "runtime", carrier: operation.abi.sourceReceiver.carrier },
    sourceArgumentCarriers: operation.abi.sourceArguments.map(argument => argument.carrier),
    resultCarrier: operation.abi.result.carrier, isAsync: false, isFallible: false, evaluation: "pure" },
  program.typeDefinitions);
  assert.equal(abi !== undefined, true, "the source-only receiver ABI is canonical");
  const records = createRustRecordFixture({ targetOperation: { get: subject => subject === element
    ? { ...operation, abi } : program.records.targetOperation.get(subject) } }, program.records);
  const inputs = rustBorrowPureProviderInputs(element, source.ast, records);
  assert.equal(inputs !== undefined, true, "the exact pure-provider input proof is available");
  assert.equal(inputs.length, 2, "both source receiver and index participate in purity");
  assert.equal(inputs[0] === receiver, true, "the effectful checked receiver identity is retained");
  assert.equal(inputs[1] === index, true, "the selected source index identity is retained");
  assert.equal(program.sourceNavigation.expressionEffects(receiver).invokes, true,
    "the retained receiver carries the source invocation effect");
});

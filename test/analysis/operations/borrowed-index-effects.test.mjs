import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";

import { rustBorrowedElementRead } from "../../../dist/analysis/program/borrowed-element-purity.js";

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

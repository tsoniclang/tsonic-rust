import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";

import { sourceIndexSelectedOperationMatches } from "../../../../dist/backend/planner/objects/indexed-records.js";

test("optional record selection validates the effective result without weakening member evidence", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function read(values: Record<string, string> | undefined): string | undefined {
  return values?.["content-type"];
}
` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind === "source-index-signature") operations.push({ node, fact });
    for (const child of ast.children(node)) visit(child);
  };
  for (const sourceFile of program.sourceFiles) visit(sourceFile);
  assert.equal(operations.length, 1);
  const { node, fact } = operations[0];
  const optional = program.records.optionalChain.get(node);
  const selected = program.records.selectedOperation.get(node);
  assert.equal(optional !== undefined, true);
  assert.equal(selected !== undefined, true);
  const context = records => ({ input: { program: { ...program, records } }, diagnostics: [],
    sourceFile: ast.getSourceFile(node) });
  const valid = context(program.records);
  assert.equal(sourceIndexSelectedOperationMatches(node, fact, valid), true);
  assertNoTargetDiagnostics(valid.diagnostics);
  for (const mutation of [
    undefined,
    { ...selected, operationId: "incorrect" },
    { ...selected, operationKind: "method" },
    { ...selected, resultType: fact.resultCarrier },
    { ...selected, resultType: fact.receiverCarrier },
  ]) {
    const changed = context(createRustRecordFixture({
selectedOperation: { get: (subject) => subject === node ? mutation : program.records.selectedOperation.get(subject) }}, program.records));
    assert.equal(sourceIndexSelectedOperationMatches(node, fact, changed), false);
  }
  for (const innerResultCarrier of [fact.receiverCarrier, optional.resultCarrier]) {
    const changed = context(createRustRecordFixture({
optionalChain: { get: (subject) => subject === node
    ? { ...optional, innerResultCarrier } : program.records.optionalChain.get(subject) }}, program.records));
    assert.equal(sourceIndexSelectedOperationMatches(node, fact, changed), false);
    assert.equal(changed.diagnostics.length, 1);
    assert.equal(changed.diagnostics[0].evidence.includes("target.capability=rust.backend.optional-chain-inner-result"), true);
  }
});

import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";

import { analyzeRustIndexedRecords } from "../../../../dist/analysis/objects/indexed-records.js";
import { createRustIndexedRecordProducer } from "../../../../dist/analysis/program/records/objects/indexed-records.js";

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
  for (const { sourceFile } of program.records.sourceArtifacts.get()) visit(sourceFile);
  assert.equal(operations.length, 1);
  const { node, fact } = operations[0];
  const optional = program.records.optionalChain.get(node);
  const selected = program.records.selectedOperation.get(node);
  assert.equal(optional !== undefined, true);
  assert.equal(selected !== undefined, true);
  const admit = records => {
    const producer = createRustIndexedRecordProducer(() => {});
    const issues = analyzeRustIndexedRecords({ ...program, records,
      projectTypes: { definitionForCarrier: () => undefined },
      objectRepresentations: { representationFor: () => undefined },
    }, [node], producer);
    return { producer, issues };
  };
  const valid = admit(program.records);
  assertNoTargetDiagnostics(valid.issues);
  assert.equal(valid.producer.records.indexedRecordAccess.get(node) !== undefined, true);
  for (const mutation of [
    undefined,
    { ...selected, operationId: "incorrect" },
    { ...selected, operationKind: "method" },
    { ...selected, resultType: fact.resultCarrier },
    { ...selected, resultType: fact.receiverCarrier },
  ]) {
    const changed = createRustRecordFixture({
selectedOperation: { get: (subject) => subject === node ? mutation : program.records.selectedOperation.get(subject) }}, program.records);
    assert.throws(() => admit(changed), error => error.diagnostic?.code === "TSONIC_INTERNAL_ANALYSIS_INVARIANT",
      "corrupted checked correspondence cannot publish an indexed access");
  }
  for (const innerResultCarrier of [fact.receiverCarrier, optional.resultCarrier]) {
    const changed = createRustRecordFixture({
optionalChain: { get: (subject) => subject === node
    ? { ...optional, innerResultCarrier } : program.records.optionalChain.get(subject) }}, program.records);
    assert.throws(() => admit(changed), error => error.diagnostic?.code === "TSONIC_INTERNAL_ANALYSIS_INVARIANT",
      "the exact optional result correspondence is required before sealing");
  }
});

import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { analyzeRustObjectLiteralEmission } from "../../../dist/analysis/objects/object-literal-emission.js";
import { createRustObjectLiteralEmissionProducer } from "../../../dist/analysis/program/records/objects/object-literal-emission.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

// Closed record admission moved from the planner to object literal emission analysis, which publishes the sealed
// closedRecord record only for an exact ordered data-property fact. These cases carry over the planner test's
// corrupted-evidence assertions: each rejects and publishes nothing.
test("closed record admission rejects corrupted ordered property and native carrier evidence", () => {
  const { program, source: checked } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export function run(first: unknown, second: unknown): unknown {
  return { first, second };
}
` } });
  const { ast } = program.source;
  let literal;
  const visit = node => {
    if (ast.is.IsObjectLiteralExpression(node)) literal = node;
    for (const child of ast.children(node)) visit(child);
  };
  for (const sourceFile of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) visit(sourceFile);
  assert.equal(literal !== undefined, true);
  const fact = program.records.targetOperation.get(literal);
  assert.equal(fact?.kind, "closed-record-literal");
  assert.equal(fact.fields.length, 2);
  const first = fact.fields[0];
  const second = fact.fields[1];
  const integer = rustSourcePrimitiveTargetType("int32");
  const admit = records => {
    const producer = createRustObjectLiteralEmissionProducer(() => {});
    const issues = analyzeRustObjectLiteralEmission({ ...program, records }, [literal], producer, () => undefined, () => undefined,
      createTargetSourceProgram(checked));
    return { issues, closed: producer.records.closedRecord.get(literal) };
  };
  const accepted = admit(program.records);
  assert.deepEqual(accepted.issues, []);
  assert.equal(accepted.closed === fact, true, "the exact checked fact is published");
  for (const mutation of [
    { ...fact, resultCarrier: integer },
    { ...fact, fields: [] },
    { ...fact, fields: [first] },
    { ...fact, fields: [second, first] },
    { ...fact, fields: [{ ...first, property: second.property }, second] },
    { ...fact, fields: [{ ...first, expression: second.expression }, second] },
    { ...fact, fields: [{ ...first, sourceName: "changed" }, second] },
    { ...fact, fields: [first, { ...second, sourceName: first.sourceName }] },
  ]) {
    const selected = admit(createRustRecordFixture({ targetOperation: { get: node => node === literal
      ? mutation : program.records.targetOperation.get(node) } }, program.records));
    assert.equal(selected.closed === undefined, true);
    assert.equal(selected.issues.some(issue => issue.evidence.includes("target.capability=rust.backend.closed-record")), true);
  }
  for (const subject of [literal, first.expression]) {
    const selected = admit(createRustRecordFixture({ runtimeCarrier: { get: node => node === subject
      ? { carrier: integer } : program.records.runtimeCarrier.get(node) } }, program.records));
    assert.equal(selected.closed === undefined, true);
    assert.equal(selected.issues.some(issue => issue.evidence.includes("target.capability=rust.backend.closed-record")), true);
  }
});

import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";

import { planRustClosedRecordLiteral } from "../../../../dist/backend/planner/expressions/closed-records.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";

test("closed record planning rejects corrupted ordered property and native carrier evidence", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
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
  const makeContext = records => ({ input: { program: { ...program, records } }, diagnostics: [],
    sourceFile: ast.getSourceFile(literal),
  });
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
    const context = makeContext(program.records);
    assert.equal(planRustClosedRecordLiteral(literal, mutation, context) === undefined, true);
    assert.equal(context.diagnostics.length !== 0, true);
  }
  for (const subject of [literal, first.expression]) {
    const context = makeContext(createRustRecordFixture({
runtimeCarrier: { get: (node) => node === subject
    ? { carrier: integer } : program.records.runtimeCarrier.get(node) }}, program.records));
    assert.equal(planRustClosedRecordLiteral(literal, fact, context) === undefined, true);
    assert.equal(context.diagnostics.length !== 0, true);
  }
});

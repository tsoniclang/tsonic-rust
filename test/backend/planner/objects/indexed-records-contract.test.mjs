import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustOptionalChainFactKey, rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";
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
    const fact = program.facts.getFact(node, rustTargetOperationFactKey);
    if (fact?.kind === "source-index-signature") operations.push({ node, fact });
    for (const child of ast.children(node)) visit(child);
  };
  for (const sourceFile of program.sourceFiles) visit(sourceFile);
  assert.equal(operations.length, 1);
  const { node, fact } = operations[0];
  const optional = program.facts.getFact(node, rustOptionalChainFactKey);
  const selected = program.facts.getSelectedTargetElementAccess(node);
  assert.equal(optional !== undefined, true);
  assert.equal(selected !== undefined, true);
  const context = facts => ({ input: { program: { ...program, facts } }, diagnostics: [],
    sourceFile: ast.getSourceFile(node) });
  const valid = context(program.facts);
  assert.equal(sourceIndexSelectedOperationMatches(node, fact, valid), true);
  assertNoTargetDiagnostics(valid.diagnostics);
  for (const mutation of [
    undefined,
    { ...selected, operationId: "incorrect" },
    { ...selected, operationKind: "method" },
    { ...selected, resultType: fact.resultCarrier },
    { ...selected, resultType: fact.receiverCarrier },
  ]) {
    const changed = context({ ...program.facts, getSelectedTargetElementAccess: subject =>
      subject === node ? mutation : program.facts.getSelectedTargetElementAccess(subject) });
    assert.equal(sourceIndexSelectedOperationMatches(node, fact, changed), false);
  }
  for (const innerResultCarrier of [fact.receiverCarrier, optional.resultCarrier]) {
    const changed = context({ ...program.facts, getFact: (subject, key) =>
      subject === node && key === rustOptionalChainFactKey
        ? { ...optional, innerResultCarrier } : program.facts.getFact(subject, key) });
    assert.equal(sourceIndexSelectedOperationMatches(node, fact, changed), false);
    assert.equal(changed.diagnostics.length, 1);
    assert.equal(changed.diagnostics[0].evidence.includes("target.capability=rust.backend.optional-chain-inner-result"), true);
  }
});

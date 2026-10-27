import assert from "node:assert/strict";
import test from "node:test";
import { planBlockLike } from "../../../../dist/backend/planner/statements/planning.js";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustNativeFixtureNodes } from "../../../helpers/records.mjs";
import { rustSourceFilePlanContext } from "../../../helpers/plan-context.mjs";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { analyzeRustStatementCompletions } from "../../../../dist/analysis/control-flow/statement-completion.js";
import { createRustStatementCompletionProducer } from "../../../../dist/analysis/program/records/operations/statement-completion.js";

test("canonical block planning retains empty native bodies and rejects every missing statement slot", () => {
  const { source: checked, program } = analyzeRust({ files: { "index.ts": "export function empty(): void { ; }" } });
  const source = createTargetSourceProgram(checked);
  const { ast } = source;
  const callable = ast.statements(program.sourceFiles[0]).find(ast.is.IsFunctionDeclaration);
  const block = ast.body(callable);
  const emptyStatement = ast.statements(block)[0];
  assert.equal(ast.is.IsEmptyStatement(emptyStatement), true, "the original empty statement has an actual checked identity");
  const nodes = rustNativeFixtureNodes(program);
  const native = new Set(nodes);
  const context = children => {
    const selectedAst = { ...ast, statements: node => node === block ? children : ast.statements(node) };
    return rustSourceFilePlanContext({ ...program, source: { ...program.source, ast: selectedAst } }, block);
  };
  for (const children of [[], [emptyStatement]]) {
    const input = context(children);
    assert.deepEqual(planBlockLike(block, input), { statements: [] });
    assert.equal(input.diagnostics.length, 0);
  }
  for (const children of [[undefined], Array(1), [emptyStatement, undefined, emptyStatement], [undefined, undefined]]) {
    const selectedAst = { ...ast, statements: node => node === block ? children : ast.statements(node) };
    const producer = createRustStatementCompletionProducer(() => {});
    const selected = analyzeRustStatementCompletions({ source: { ...source, ast: selectedAst },
      sourceFiles: program.sourceFiles, isNativeNode: node => native.has(node), records: program.records,
      names: program.names, typeDefinitions: program.typeDefinitions, errorRegions: program.errorRegions,
      projectFlowReadSelections: program.projectFlowReadSelections, producer, required: [], countedLoops: new Map(),
      safetyApplications: program.safetyApplications, components: program.sourcePackageComponents,
      ownership: program.ownership, projectTypes: program.projectTypes, projectFieldDispatch: program.projectFieldDispatch,
      structuralShapes: program.structuralShapes, frozenDataWrites: program.frozenDataWrites });
    assert.equal(selected.kind, "rejected", "each original dense/sparse missing slot rejects before publication");
    const count = children.length === 2 ? 2 : 1;
    assert.equal(selected.diagnostics.length, count);
    assert.equal(selected.diagnostics.every(diagnostic => diagnostic.code === "RUST_STATEMENT_SEQUENCE_NOT_PROVEN" &&
      diagnostic.sourceNode === block && diagnostic.message === "A runtime control body requires its exact checked source statement."), true);
    assert.equal(producer.records.statementAdmission.get(block) === undefined, true, "no malformed native body is published");
    assert.throws(() => planBlockLike(block, context(children)), error =>
      error.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
      error.message === "Statement sequence requires its dense checked source nodes.",
    "bypassing the actual source admission remains an internal invariant, not an empty body");
  }
});

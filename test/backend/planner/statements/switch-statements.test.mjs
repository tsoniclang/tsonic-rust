import { createRustRecordFixture, rustNativeFixtureNodes } from "../../../helpers/records.mjs";
import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";

import { planSwitchStatement } from "../../../../dist/backend/planner/statements/switch-statements.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { rustSourceFilePlanContext } from "../../../helpers/plan-context.mjs";
import { analyzeRustStatementCompletions } from "../../../../dist/analysis/control-flow/statement-completion.js";
import { createRustStatementCompletionProducer } from "../../../../dist/analysis/program/records/operations/statement-completion.js";
import { createTargetSourceProgram } from "@tsonic/target-api/source";

test("switch rejects missing or forged case equality and absence evidence", () => {
  const { source: checked, program } = analyzeRust({ files: { "index.ts": `
export function choose(value: string | undefined, candidate: string | undefined): number {
  switch (value) { case "fixed": return 1; case candidate: return 2; case undefined: return 3; default: return 0; }
}` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind === "switch") operations.push({ node, fact });
    for (const child of ast.children(node)) visit(child);
  };
  for (const file of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) visit(file);
  assert.equal(operations.length, 1);
  const { node, fact } = operations[0];
  const source = createTargetSourceProgram(checked);
  const native = new Set(rustNativeFixtureNodes(program));
  assert.ok(Object.isFrozen(fact.clauses) && fact.clauses.every(Object.isFrozen));
  const recordsFor = selected => createRustRecordFixture({ targetOperation: { get: subject => subject === node
    ? selected : program.records.targetOperation.get(subject) } }, program.records);
  const context = selected => rustSourceFilePlanContext({ ...program, records: recordsFor(selected) }, node,
    { controlFlow: { nextLoopId: 0 }, syntheticNames: createRustSyntheticNameState(ast, node, []) });
  const valid = context(fact);
  assert.ok(planSwitchStatement(node, valid), JSON.stringify(valid.diagnostics.map(({ code, message }) => ({ code, message }))));
  assertNoTargetDiagnostics(valid.diagnostics);
  const first = fact.clauses[0];
  const failures = [];
  const mutations = [
    { clauses: undefined }, { clauses: [] }, { clauses: new Array(fact.clauses.length) },
    { clauses: [null, ...fact.clauses.slice(1)] }, { operationId: "changed" },
    { discriminantCarrier: rustSourcePrimitiveTargetType("int32") },
    ...[
      { comparison: undefined }, { comparison: { kind: "constant", value: true } },
      { comparison: { ...first.comparison, leftOptional: false } },
      { comparison: { ...first.comparison, operation: { ...first.comparison.operation, rustOperator: "!=" } } },
      { carrier: rustSourcePrimitiveTargetType("int32") }, { expression: fact.clauses[1].expression },
    ].map(change => ({ clauses: [{ ...first, ...change }, ...fact.clauses.slice(1)] })),
    { clauses: [...fact.clauses.slice(0, -1), { ...fact.clauses.at(-1), comparison: first.comparison }] },
  ];
  assert.equal(mutations.length, 13, "every original missing/forged equality and absence vector is retained");
  for (const [index, mutation] of mutations.entries()) {
    const producer = createRustStatementCompletionProducer(() => {});
    try {
      const selected = analyzeRustStatementCompletions({ source, sourceFiles: program.sourceFiles,
        isNativeNode: subject => native.has(subject), records: recordsFor({ ...fact, ...mutation }),
        names: program.names, typeDefinitions: program.typeDefinitions, errorRegions: program.errorRegions,
        projectFlowReadSelections: program.projectFlowReadSelections, producer, required: [], countedLoops: new Map(),
        safetyApplications: program.safetyApplications, components: program.sourcePackageComponents,
        ownership: program.ownership, projectTypes: program.projectTypes, projectFieldDispatch: program.projectFieldDispatch,
        structuralShapes: program.structuralShapes, frozenDataWrites: program.frozenDataWrites });
      assert.equal(selected.kind, "rejected", `switch inverse ${index}: refuse before native publication`);
      assert.equal(selected.diagnostics.some(issue => ["RUST_SWITCH_SELECTION_NOT_PROVEN", "RUST_SWITCH_CLAUSE_NOT_PROVEN"].includes(issue.code)),
        true, `switch inverse ${index}: precise existing admission owner`);
      assert.equal(producer.records.statementAdmission.get(node) === undefined, true,
        `switch inverse ${index}: no inconsistent final switch is admitted`);
    } catch (error) {
      failures.push({ vector: index, message: String(error.message).slice(0, 600) });
    }
  }
  assert.deepEqual(failures, [], "all13 original switch inverses must reject at admission without a JavaScript crash");
  assert.throws(() => planSwitchStatement(node, context(undefined)), error =>
    error.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
      error.message === "Switch lowering requires its admitted native discriminant and clause selection.",
    "a missing final switch remains a required-record invariant");
});

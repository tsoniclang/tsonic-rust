import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustSourceFilePlanContext } from "../../../helpers/plan-context.mjs";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import { planRustErrorRegion } from "../../../../dist/backend/planner/program/error-regions.js";
import { rustAwaitValueMatchesCarrier } from "../../../../dist/analysis/callables/async/await-values.js";
import { createRustAwaitValueProducer } from "../../../../dist/analysis/program/records/await-value.js";
import { selectRustSourceValueConversion } from "../../../../dist/policy/conversions/selection.js";
import { rustAwaitSelectionLeaves } from "../../../../dist/target-model/types/await.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { planRustAwaitExpression } from "../../../../dist/backend/planner/expressions/await.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";

const invariant = message => error => error?.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
  message.test(error.diagnostic.message);

function awaitProgram(source) {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": source } });
  const operations = [];
  const visit = node => {
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "await-op") operations.push({ node, operation,
      fact: program.records.awaitValue.get(node) });
    for (const child of program.source.ast.children(node)) visit(child);
  };
  for (const sourceFile of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) visit(sourceFile);
  assert.equal(operations.length, 1);
  return { program, ...operations[0] };
}

function contextFor(program, node, records = program.records) {
  const { ast } = program.source;
  const selected = rustSourceFilePlanContext({ ...program, records }, node);
  const declaration = sourceEnclosingCallable(node, ast);
  assert.equal(declaration !== undefined, true, "the original await has its checked callable owner");
  const region = planRustErrorRegion(declaration, selected);
  assert.equal(region !== undefined, true, "the real completed native error region is available");
  return { ...selected, callableDeclaration: declaration, fallibleBoundary: region.boundary };
}

test("finite await planner emits native branch selection and preserves one operand evaluation", () => {
  const { program, node, fact } = awaitProgram(`
import type { uint64 } from "@tsonic/core/types.js";
export async function read(value: uint64 | Promise<uint64>): Promise<uint64> { return await value; }
`);
  assert.equal(fact.selection.kind, "union");
  const selected = contextFor(program, node);
  const operand = { kind: "call", path: "next", args: [] };
  let evaluations = 0;
  const result = planRustAwaitExpression(node, selected, () => { evaluations += 1; return operand; });
  assertNoTargetDiagnostics(selected.diagnostics);
  assert.equal(evaluations, 1);
  assert.equal(result.kind, "match");
  assert.equal(result.expression, operand);
  assert.equal(result.arms.length, 2);
  const deferred = result.arms.find(arm => arm.expression.kind === "try");
  const direct = result.arms.find(arm => arm.expression.kind === "path");
  assert.ok(direct);
  assert.equal(deferred.expression.expr.kind, "await");
  assert.equal(deferred.expression.expr.expr.kind, "method-call");
  assert.equal(deferred.expression.expr.expr.method, "into_result");
  assert.deepEqual(deferred.expression.resultErrorType, deferred.expression.operandErrorType);
  assert.doesNotMatch(JSON.stringify(result), /clone|Box|poll|dyn Future|Any|numeric-cast/u);
});

test("optional unit future planner retains effectful native await and one absence branch", () => {
  const { program, node, fact } = awaitProgram(`
export async function finish(value: Promise<void> | null | undefined): Promise<void> { await value; }
`);
  assert.equal(fact.selection.kind, "optional");
  const selected = contextFor(program, node);
  const operand = { kind: "call", path: "next", args: [] };
  let evaluations = 0;
  const result = planRustAwaitExpression(node, selected, () => { evaluations += 1; return operand; });
  assertNoTargetDiagnostics(selected.diagnostics);
  assert.equal(evaluations, 1);
  assert.equal(result.kind, "if-let");
  assert.equal(result.expression === operand, true, "the original operand is evaluated once");
  assert.equal(result.pattern.path, "Some");
  assert.equal(result.whenTrue.kind, "try");
  assert.equal(result.whenTrue.expr.kind, "await");
  assert.equal(result.whenFalse === undefined, true, "native unit absence performs no work");
  assert.doesNotMatch(JSON.stringify(result), /Undefined|Null|clone|Box|poll/u);
});

test("finite await union rendering rejects a missing exact package error identity", () => {
  const { program, node } = awaitProgram(`
import type { uint64 } from "@tsonic/core/types.js";
export async function read(value: uint64 | Promise<uint64>): Promise<uint64> { return await value; }
`);
  const selected = contextFor(program, node);
  const original = program.records.sourcePackageErrors.get();
  const records = createRustRecordFixture({ sourcePackageErrors: { get: () => undefined } }, program.records);
  let evaluations = 0;
  assert.throws(() => {
    const missing = contextFor(program, node, records);
    planRustAwaitExpression(node, missing, () => { evaluations += 1; return { kind: "path", path: "value" }; });
  }, invariant(/source-package graph requires its exact native error domains/u));
  assert.equal(evaluations, 0, "missing required error-domain publication is refused before operand work");
  assert.equal(program.records.sourcePackageErrors.get() === original, true, "the failed child cannot replace the original publication");
  assertNoTargetDiagnostics(selected.diagnostics);
});

test("await planner rejects missing or mutated branch and effect contracts before operand planning", () => {
  const { program, node, fact } = awaitProgram(`
import type { uint64 } from "@tsonic/core/types.js";
export async function read(value: uint64 | Promise<uint64>): Promise<uint64> { return await value; }
`);
  const integer = rustSourcePrimitiveTargetType("int32");
  const mutations = [ ["missing fact", undefined], ["wrong result", { ...fact, resultCarrier: integer }],
    ["wrong operand", { ...fact, operandCarrier: integer }], ["unexpected field", { ...fact, unexpected: true }],
    ["missing branches", { ...fact, selection: { ...fact.selection, alternatives: [] } }],
    ["reordered branches", { ...fact, selection: { ...fact.selection, alternatives: [...fact.selection.alternatives].reverse() } }],
    ["missing native error channel", { ...fact, selection: { ...fact.selection, alternatives: fact.selection.alternatives.map(alternative =>
      alternative.selection.value.future === undefined ? alternative : { ...alternative,
        selection: { ...alternative.selection, value: { ...alternative.selection.value,
          future: { ...alternative.selection.value.future, errorBoundary: "none" } } } }) } }],
  ];
  const leaves = rustAwaitSelectionLeaves(fact.selection);
  for (const [label, mutation] of mutations) {
    const inherited = { get: subject => subject === node ? mutation : program.records.awaitValue.get(subject) };
    if (mutation === undefined) {
      const records = createRustRecordFixture({ awaitValue: inherited }, program.records);
      const selected = contextFor(program, node, records);
      let evaluations = 0;
      assert.throws(() => planRustAwaitExpression(node, selected, () => {
        evaluations += 1;
        assert.fail("an invalid await contract must not reach operand planning");
      }), invariant(/native operand and completion selection/u), label);
      assert.equal(evaluations, 0, label);
      assert.equal(records.awaitValue.get(node) === undefined, true, label + ": no missing fact is invented");
    } else {
      assert.equal(rustAwaitValueMatchesCarrier(mutation, fact.operandCarrier, fact.resultCarrier,
        program.typeDefinitions), false, label);
      let admissions = 0;
      const producer = createRustAwaitValueProducer(() => {}, () => { admissions += 1; }, program.typeDefinitions, inherited);
      assert.throws(() => producer.finalize(node, fact.operandCarrier, fact.resultCarrier,
        carrier => leaves.find(leaf => rustTargetTypeRefEquals(leaf.carrier, carrier))?.future,
        (source, target) => selectRustSourceValueConversion(source, target, program.typeDefinitions)),
      /Conflicting Rust semantic plan 'tsonic.rust.awaitValue'/u, label);
      assert.equal(admissions, 0, label + ": contradictory inherited evidence is never admitted");
      assert.equal(producer.records.get(node) === mutation, true, label + ": failed admission does not replace inherited evidence");
    }
    assert.equal(program.records.awaitValue.get(node) === fact, true, label + ": original sealed plan remains unchanged");
  }
});

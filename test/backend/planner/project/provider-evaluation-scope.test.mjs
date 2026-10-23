import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { Node_Expression } from "@tsonic/target-api/source";
import { analyzeRust } from "../../../helpers/rust-session.mjs";


import { rustBorrowedStrTargetType, rustSourcePrimitiveTargetType, rustStringTargetType } from "../../../../dist/target-model/types/index.js";
import { planExpression } from "../../../../dist/backend/planner/expressions/entry.js";
import { finalizeRustProviderOperationAbi } from "../../../../dist/policy/operations/members/abi/finalize.js";
import { rustFutureTargetType } from "../../../../dist/target-model/types/index.js";
import { planRustProviderEvaluationScope } from "../../../../dist/backend/planner/project/provider-evaluation-scope.js";
import { selectRustProviderSourceOccurrence } from "../../../../dist/analysis/operations/provider-source-inputs.js";
import { analyzeRustProviderEvaluation } from "../../../../dist/analysis/storage/provider-evaluation.js";
import { createRustProviderEvaluationProducer } from "../../../../dist/analysis/program/records/provider-evaluation.js";
import { analyzeRustProviderMutableEmission } from "../../../../dist/analysis/storage/provider-mutable-emission.js";

test("provider evaluation retains exact existing borrows across readonly representation changes", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
function selected(fail: boolean): string { if (fail) throw new Error("selected"); return "a"; }
export function observed(source: string, fail: boolean): boolean {
  return source.includes(selected(fail)) && source.includes("a");
}
` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind === "provider-operation" && ast.is.IsCallExpression(node) &&
      ast.arguments(node).some(argument => argument !== undefined && ast.is.IsCallExpression(argument))) {
      operations.push({ node, fact });
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile).forEach(visit);
  assert.equal(operations.length, 1);
  const { node, fact } = operations[0];
  const receiver = Node_Expression(ast, Node_Expression(ast, node));
  const selected = program.records.sourceParameterAbi.get(receiver);
  assert.equal(selected.mode, "ref");
  const plan = parameter => {
    const records = createRustRecordFixture({
sourceParameterAbi: { get: (subject) => {
    return subject === receiver ? parameter : program.records.sourceParameterAbi.get(subject);
} }}, program.records);
    return planRustProviderEvaluationScope({ input: { program: { ...program, records } },
      sourceFile: ast.getSourceFile(node), diagnostics: [] }, fact, node, receiver, ast.arguments(node),
    () => ({ kind: "path", path: "snapshot" }), () => undefined);
  };
  assert.equal(plan(selected).kind, "none");
  const other = rustSourcePrimitiveTargetType("bool");
  for (const changed of [
    undefined,
    { ...selected, mode: "mut-ref" },
    { ...selected, valueCarrier: other },
    { ...selected, parameterCarrier: { ...selected.parameterCarrier, referent: other } },
    { ...selected, parameterCarrier: { ...selected.parameterCarrier, mutable: true } },
    { ...selected, entryConversion: { kind: "semantic-conversion", id: "borrowed-str-from-owned-string" } },
  ]) {
    const scope = plan(changed);
    assert.equal(scope.kind, "selected", "unproved current storage still requires its snapshot");
    assert.equal(scope.steps.length, 1);
    assert.equal(scope.overrides.sourceValues.has(receiver), true);
  }
});

test("evaluation-only unit, absence and native-future operands retain canonical immediate effect handling", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
function first(): number { return 1; }
function second(): number { return 2; }
function target(left: number, right: number): number { return left + right; }
export function observed(): number { return target(first(), second()); }
` } });
  const { ast } = program.source;
  let node;
  const visit = current => {
    if (ast.is.IsCallExpression(current) && ast.arguments(current).length === 2) node = current;
    ast.forEachChild(current, child => { if (child !== undefined) visit(child); });
  };
  program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile).forEach(visit);
  assert.equal(node !== undefined, true, "checked call supplies the original occurrence identities");
  const argumentsList = ast.arguments(node);
  const number = { kind: "source-primitive", name: "float64" };
  for (const [label, carrier, expression, expectedDiscard] of [
    ["unit", { kind: "tuple", elements: [] }, { kind: "call", path: "fixture::unit", args: [] }, "unit"],
    ["absence", { kind: "target-named", id: "rust.native.absence" }, { kind: "call", path: "fixture::absence", args: [] }, "unit"],
    ["future", rustFutureTargetType(number), { kind: "call", path: "fixture::future", args: [] }, "unit"],
  ]) {
    const abi = finalizeRustProviderOperationAbi({ operationKind: "method",
      form: { form: "call", path: "fixture::consume", argModes: ["value"], argOrder: [1] },
      sourceArgumentCarriers: [carrier, number], declaredSourceArgumentCarriers: [number],
      evaluationOnlySourceArgumentIndexes: [0], resultCarrier: number, isAsync: false, isFallible: false });
    assert.equal(abi !== undefined, true, `${label}: existing canonical ABI admission`);
    const fact = { kind: "provider-operation", operationId: "fixture::consume", resultCarrier: number, abi };
    const occurrence = selectRustProviderSourceOccurrence(node, fact, undefined, argumentsList);
    assert.equal(occurrence !== undefined, true, `${label}: exact original source slots are admitted before rendering`);
    const producer = createRustProviderEvaluationProducer(() => undefined);
    const admission = { ...program, physicalEmissionContexts: {
      ...program.physicalEmissionContexts, sourceOccurrences: [occurrence],
    } };
    const mutableIssues = analyzeRustProviderMutableEmission(admission, [], producer);
    assert.equal(mutableIssues.length, 0, `${label}: the existing native storage owner proves no mutable target inputs`);
    const issues = analyzeRustProviderEvaluation(admission, producer);
    assert.equal(issues.length, 0, `${label}: the actual pre-seal owner admits this source schedule`);
    const records = createRustRecordFixture({ ...producer.records,
      typeEmission: { get: selected => selected === carrier
        ? { discard: label === "future" ? "drop" : "unit" }
        : program.records.typeEmission.get(selected) },
    }, program.records);
    const context = { input: { program: { ...program, records } }, sourceFile: ast.getSourceFile(node), diagnostics: [],
      expressionOverrides: new Map([[argumentsList[0], { expression, carrier, valueForm: "value" }],
        [argumentsList[1], { expression: { kind: "call", path: "fixture::value", args: [] }, carrier: number, valueForm: "value" }]]) };
    assert.throws(() => planRustProviderEvaluationScope({ ...context, input: { program } }, fact, node, undefined,
      argumentsList, planExpression, () => undefined),
    error => error.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
      error.message === "An admitted provider operation requires its exact source evaluation plan.",
    `${label}: a new operation cannot reuse another fact's sealed evaluation record`);
    const selected = planRustProviderEvaluationScope(context, fact, node, undefined, argumentsList, planExpression, () => undefined);
    assert.equal(selected.kind, "selected", `${label}: exact source scheduling`);
    assert.equal(selected.steps[0].kind, "effect", `${label}: no blind named value binding`);
    assert.equal(selected.steps[0].discard, expectedDiscard, `${label}: canonical discard mode`);
    assert.equal(selected.steps[0].value.kind, "call", `${label}: original effect remains`);
    assert.equal(selected.steps[0].value.path, label === "future" ? "core::mem::drop" : expression.path,
      `${label}: canonical native-future disposal is unchanged`);
    if (label === "future") assert.equal(selected.steps[0].value.args[0] === expression, true,
      "native future is disposed exactly once without awaiting or losing its expression");
    assert.equal(context.diagnostics.length, 0, `${label}: no extra planner diagnostic`);
  }
});

test("one exact identity source shared by native inputs is prepared once without becoming an owned source value", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
function later(): number { return 1; }
function consume(value: string, count: number): number { return count; }
export function observed(source: string): number { return consume(source, later()); }
` } });
  const { ast } = program.source;
  let node;
  const visit = current => {
    if (ast.is.IsCallExpression(current) && ast.arguments(current).length === 2) node = current;
    ast.forEachChild(current, child => { if (child !== undefined) visit(child); });
  };
  program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile).forEach(visit);
  assert.equal(node !== undefined, true, "the fixture has the actual ordered call occurrence");
  const argumentsList = ast.arguments(node);
  const sourceNode = argumentsList[0];
  const string = rustStringTargetType();
  const borrowedString = rustBorrowedStrTargetType();
  const number = rustSourcePrimitiveTargetType("float64");
  const abi = finalizeRustProviderOperationAbi({ operationKind: "method",
    form: { form: "call", path: "fixture::consume", argModes: ["ref", "value"] },
    sourceArgumentCarriers: [string, number], declaredSourceArgumentCarriers: [string, number],
    resultCarrier: number, isAsync: false, isFallible: false });
  assert.equal(abi !== undefined, true, "the ordinary ABI admits an exact shared native input");
  const fact = { kind: "provider-operation", operationId: "fixture::consume", resultCarrier: number, abi };
  const occurrence = selectRustProviderSourceOccurrence(node, fact, undefined, argumentsList);
  assert.equal(occurrence !== undefined, true, "the source occurrence retains its original identities and order");
  const repeated = { ...occurrence.inputs[0], input: Object.freeze({ ...occurrence.inputs[0].input }) };
  const original = { ...occurrence, inputs: [occurrence.inputs[0], repeated, ...occurrence.inputs.slice(1)],
    targetOrder: [occurrence.targetOrder[0], ...occurrence.targetOrder] };
  const selectedRead = Object.freeze({ carrier: string, source: { kind: "borrow", mutable: false },
    value: { kind: "borrow", mutable: false }, snapshot: undefined, stablePlace: true,
    readsStorage: true, pure: true, sharedReference: false, borrowedAcross: new Set([argumentsList[1]]) });
  const prepare = (read = selectedRead, change = input => input) => {
    const source = { ...original, inputs: original.inputs.map(row => row.slot.node === sourceNode
      ? { ...row, input: change(row.input) } : row) };
    const producer = createRustProviderEvaluationProducer(() => undefined);
    producer.mutable(node, fact, []);
    const issues = analyzeRustProviderEvaluation({ ...program,
      ownership: { ...program.ownership, reads: new Map([[sourceNode, read]]) },
      physicalEmissionContexts: { ...program.physicalEmissionContexts, sourceOccurrences: [source] } }, producer);
    assert.equal(issues.length, 0, "the existing ownership proof admits the unchanged source schedule");
    const selected = producer.records.providerEvaluation.get(node, fact);
    assert.equal(selected !== undefined, true, "one provider evaluation record is published by its real producer");
    return { producer, selected };
  };
  const { producer, selected } = prepare();
  assert.equal(selected.slots[0].borrowedEvaluation, true, "all identity/ref inputs share the selected immutable source read");
  const records = createRustRecordFixture({ ...producer.records }, program.records);
  const requested = [];
  const scope = planRustProviderEvaluationScope({ input: { program: { ...program, records } },
    sourceFile: ast.getSourceFile(node), diagnostics: [] }, fact, node, undefined, argumentsList,
  (subject, context, mode, access) => {
    requested.push({ subject, access });
    return { kind: "reference", expr: { kind: "path", path: "source" } };
  }, () => undefined);
  assert.equal(scope.kind, "selected", "the repeated source has one preparation scope");
  assert.equal(scope.steps.length, 1, "one shared native binding prepares both uses");
  assert.equal(requested.length, 1, "the original source is planned once");
  assert.equal(requested[0].subject === sourceNode, true, "only the original shared source is prepared");
  assert.equal(requested[0].access, "shared-reference", "the renderer follows the sealed shared evaluation");
  assert.equal(scope.overrides.sourceValues.has(sourceNode), false, "a native reference never masquerades as an owned source value");
  for (const input of selected.slots[0].inputs) {
    const expression = scope.overrides.inputs.get(input);
    assert.equal(expression?.kind, "path", "each exact finalized native input reuses the prepared binding");
    assert.equal(expression?.path, scope.steps[0].name, "neither use reconverts or reborrows the prepared reference");
  }
  for (const [label, read, change] of [
    ["owned snapshot", { ...selectedRead, value: { kind: "clone" } }, input => input],
    ["fresh owned result", { ...selectedRead, value: { kind: "move" } }, input => input],
    ["mutable selected read", { ...selectedRead, value: { kind: "borrow", mutable: true } }, input => input],
    ["one owned input", selectedRead, input => input === original.inputs[0].input ? { ...input, mode: "value", parameterCarrier: string } : input],
    ["one mutable input", selectedRead, input => input === original.inputs[0].input ? { ...input, mode: "mut-ref",
      parameterCarrier: { kind: "reference", referent: string, mutable: true } } : input],
    ["one contextual conversion", selectedRead, input => input === original.inputs[0].input ? { ...input,
      conversion: { kind: "semantic", conversion: { kind: "borrowed-str-from-owned-string" },
        sourceCarrier: string, targetCarrier: borrowedString, fallible: false },
      parameterCarrier: { kind: "reference", referent: borrowedString, mutable: false } } : input],
  ]) {
    assert.equal(prepare(read, change).selected.slots[0].borrowedEvaluation, false,
      `${label}: one incompatible use prevents borrowing the whole original source`);
  }
  const alreadyBound = { kind: "path", path: "prepared" };
  const reused = planRustProviderEvaluationScope({ input: { program: { ...program, records } },
    sourceFile: ast.getSourceFile(node), diagnostics: [], expressionOverrides: new Map([[sourceNode,
      { expression: alreadyBound, carrier: string, valueForm: "shared-reference" }]]) },
  fact, node, undefined, argumentsList, () => assert.fail("an existing exact shared binding must not be planned again"), () => undefined);
  assert.equal(reused.kind, "selected", "the enclosing binding supplies the same native input scope");
  assert.equal(reused.steps.length, 0, "an enclosing binding is not prepared twice");
  assert.equal(reused.overrides.sourceValues.has(sourceNode), false, "an existing shared binding is not treated as owned");
  for (const input of selected.slots[0].inputs) assert.equal(reused.overrides.inputs.get(input) === alreadyBound, true,
    "each native shared use retains the exact enclosing binding identity");
});

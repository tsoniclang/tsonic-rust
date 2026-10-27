import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { Node_Expression, sourceEnclosingCallable } from "@tsonic/target-api/source";
import { analyzeRust } from "../../../helpers/rust-session.mjs";


import { rustBorrowedStrTargetType, rustSourcePrimitiveTargetType, rustStringTargetType } from "../../../../dist/target-model/types/index.js";
import { planExpression } from "../../../../dist/backend/planner/expressions/entry.js";
import { finalizeRustProviderOperationAbi } from "../../../../dist/policy/operations/members/abi/finalize.js";
import { rustFutureTargetType } from "../../../../dist/target-model/types/index.js";
import { planRustProviderEvaluationScope } from "../../../../dist/backend/planner/project/provider-evaluation-scope.js";
import { selectRustProviderSourceOccurrence } from "../../../../dist/analysis/operations/provider-source-inputs.js";
import { analyzeRustProviderEvaluation } from "../../../../dist/analysis/storage/provider-evaluation.js";
import { createRustProviderEvaluationProducer } from "../../../../dist/analysis/program/records/native/provider-evaluation.js";
import { analyzeRustProviderMutableEmission } from "../../../../dist/analysis/storage/provider-mutable-emission.js";

for (const surfaces of [[], ["js"]]) {
  test(`${surfaces.length === 0 ? "native" : "js"} provider index evaluation preserves a native slice identity without treating its contents as stable`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
function change(values: string[]): number { values[0] = "after"; return 0; }
export function direct(values: string[]): boolean { return values[change(values)]! === "after"; }
function replace(values: string[][]): number { values[0] = ["after"]; return 0; }
export function nested(values: string[][]): boolean { return values[0]![replace(values)]! === "before"; }
` } });
    const { ast } = program.source;
    const select = name => {
      const source = program.physicalEmissionContexts.sourceOccurrences.find(occurrence => {
        const owner = sourceEnclosingCallable(occurrence.node, ast);
        return occurrence.operation.abi.operationKind === "indexer" && owner !== undefined &&
          ast.text(ast.name(owner)) === name && occurrence.slots.some(slot =>
            slot.source.kind === "argument" && ast.is.IsCallExpression(slot.node));
      });
      assert.equal(source !== undefined, true, `${name}: the original effectful native index is selected`);
      const selected = program.records.providerEvaluation.get(source.node, source.operation);
      assert.equal(selected !== undefined, true, `${name}: its evaluation is published before sealing`);
      const receiver = selected.slots.find(row => row.slot.source.kind === "receiver");
      const argument = selected.slots.find(row => row.slot.source.kind === "argument" && ast.is.IsCallExpression(row.slot.node));
      assert.equal(receiver !== undefined && argument !== undefined, true, `${name}: original receiver and index identities are retained`);
      assert.equal(selected.effects.has(argument.slot.key), true, `${name}: the real index mutation remains effectful`);
      return { source, selected, receiver, argument };
    };
    const direct = select("direct");
    const parameter = program.records.sourceParameterAbi.get(direct.receiver.slot.node);
    assert.equal(parameter !== undefined, true, "the actual parameter contract is published on its use");
    assert.equal(program.ownership.reads.get(direct.receiver.slot.node)?.stablePlace, false,
      "mutating slice contents are not mislabeled as immutable value storage");
    const context = { input: { program }, sourceFile: ast.getSourceFile(direct.source.node), diagnostics: [] };
    const planned = [];
    const directScope = planRustProviderEvaluationScope(context, direct.source.operation, direct.source.node,
      direct.receiver.slot.node, [direct.argument.slot.node], subject => {
        planned.push(subject);
        return { kind: "path", path: "prepared_receiver" };
      },
      () => undefined);
    if (surfaces.length === 0) {
      assert.equal(parameter.mode, "mut-ref", "the native formal is an exclusive reference, not an owned array");
      assert.equal(parameter.parameterCarrier.kind, "reference", "the formal carries the actual native reference");
      assert.equal(parameter.parameterCarrier.mutable, true, "the native formal supports its declared content writes");
      assert.equal(parameter.parameterCarrier.referent.kind, "slice", "the native slice cannot replace its allocation through this formal");
      assert.equal(parameter.entryConversion, undefined, "no conversion creates a different source owner");
      assert.equal(direct.receiver.borrowAcross.has(direct.argument.slot.key), false,
        "the existing native slice identity does not require an owned receiver snapshot");
      assert.equal(directScope.kind, "none", "native indexing evaluates its index before the final element reborrow");
      assert.equal(planned.length, 0, "the direct native receiver and index require no owned preparation");
    } else {
      assert.equal(parameter.mode, "value", "the explicit JS provider uses its actual native handle, not an invented slice ABI");
      assert.equal(direct.receiver.borrowAcross.has(direct.argument.slot.key), true,
        "the native slice exception cannot be inferred for a distinct provider representation");
      assert.equal(directScope.kind, "selected", "the actual provider retains its source receiver before index effects");
      assert.equal(planned.length, 1, "the handle is prepared exactly once by its existing source recipe");
      assert.equal(planned[0] === direct.receiver.slot.node, true, "only the original source receiver is prepared");
      assert.equal(directScope.overrides.sourceValues.has(direct.receiver.slot.node), true,
        "the actual provider handle is not silently replaced with a borrowed native slice");
    }
    const nested = select("nested");
    assert.equal(program.records.sourceParameterAbi.get(nested.receiver.slot.node), undefined,
      "a projected inner allocation is not the outer parameter's native slice identity");
    assert.equal(nested.receiver.borrowAcross.has(nested.argument.slot.key), true,
      "replacing the inner allocation still requires its first receiver value");
    const nestedScope = planRustProviderEvaluationScope({ ...context, sourceFile: ast.getSourceFile(nested.source.node) },
      nested.source.operation, nested.source.node, nested.receiver.slot.node, [nested.argument.slot.node],
      () => ({ kind: "path", path: "first_receiver" }), () => undefined);
    assert.equal(nestedScope.kind, "selected", "the actual inner-allocation replacement retains its native snapshot scope");
    assert.equal(nestedScope.steps.length, 1, "the first receiver allocation is preserved exactly once");
    assert.equal(nestedScope.overrides.sourceValues.has(nested.receiver.slot.node), true,
      "later index effects consume the retained inner owner rather than the replacement allocation");
  });
}

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
  const sealed = program.records.providerEvaluation.get(node, fact);
  assert.equal(sealed !== undefined, true, "the actual immutable source schedule is computed before publication");
  const plan = parameter => {
    let reads = 0;
    const records = createRustRecordFixture({
sourceParameterAbi: { get: (subject) => {
    reads++;
    return subject === receiver ? parameter : program.records.sourceParameterAbi.get(subject);
} }}, program.records);
    const result = planRustProviderEvaluationScope({ input: { program: { ...program, records } },
      sourceFile: ast.getSourceFile(node), diagnostics: [] }, fact, node, receiver, ast.arguments(node),
    () => ({ kind: "path", path: "snapshot" }), () => undefined);
    assert.equal(reads, 0, "a sealed evaluation schedule never recomputes ownership from a later source service");
    assert.equal(records.providerEvaluation.get(node, fact) === sealed, true, "the exact pre-seal record is unchanged");
    return result;
  };
  assert.equal(plan(selected).kind, "none");
  const other = rustSourcePrimitiveTargetType("bool");
  for (const [label, changed] of [
    ["missing source service", undefined],
    ["exclusive parameter mode", { ...selected, mode: "mut-ref" }],
    ["conflicting logical value", { ...selected, valueCarrier: other }],
    ["conflicting native referent", { ...selected, parameterCarrier: { ...selected.parameterCarrier, referent: other } }],
    ["mutable native reference", { ...selected, parameterCarrier: { ...selected.parameterCarrier, mutable: true } }],
    ["new entry conversion", { ...selected, entryConversion: { kind: "semantic-conversion", id: "borrowed-str-from-owned-string" } }],
  ]) {
    const scope = plan(changed);
    assert.equal(scope.kind, "none", `${label}: post-seal metadata cannot revoke the actual immutable-place proof or demand a copy`);
  }
});

test("pre-seal provider evaluation snapshots a real captured string before its same-owner RHS mutation", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export function make(seed: string): (next: string) => boolean {
  return (next: string): boolean => seed.includes(seed = next);
}
` } });
  const ast = program.source.ast;
  let node;
  const visit = current => {
    const operation = program.records.targetOperation.get(current);
    if (ast.is.IsCallExpression(current) && operation?.kind === "provider-operation" &&
      ast.arguments(current).some(argument => ast.is.IsBinaryExpression(argument))) node = current;
    ast.forEachChild(current, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(node !== undefined, true, "the complete checked source retains the effectful native string operation");
  const fact = program.records.targetOperation.get(node);
  const receiver = Node_Expression(ast, Node_Expression(ast, node));
  const argument = ast.arguments(node)[0];
  const read = program.ownership.reads.get(receiver);
  assert.equal(read !== undefined, true, "ownership is computed by the actual source-flow producer");
  assert.equal(read.stablePlace, false, "the genuine captured mutable source is not an immutable native parameter");
  assert.equal(read.borrowedAcross.has(argument), false, "the same-owner source write invalidates a live borrow");
  assert.equal(read.value.kind, "clone", "the exact source observation requires an owned snapshot before the write");
  const occurrence = program.physicalEmissionContexts.sourceFor(node, fact);
  assert.equal(occurrence !== undefined, true, "the complete native input correspondence is already prepared");
  const producer = createRustProviderEvaluationProducer(() => undefined);
  const admission = { ...program, physicalEmissionContexts: { ...program.physicalEmissionContexts, sourceOccurrences: [occurrence] } };
  const mutableIssues = analyzeRustProviderMutableEmission(admission, [], producer);
  const issues = analyzeRustProviderEvaluation(admission, producer);
  assert.equal(mutableIssues.length, 0, "the existing native storage owner admits the actual input modes");
  assert.equal(issues.length, 0, "the exact full source program admits the pre-seal snapshot schedule");
  const selected = producer.records.providerEvaluation.get(node, fact);
  assert.equal(selected !== undefined, true, "one complete evaluation record is published by its actual owner");
  const records = createRustRecordFixture({ ...producer.records }, program.records);
  const scope = planRustProviderEvaluationScope({ input: { program: { ...program, records } },
    sourceFile: ast.getSourceFile(node), diagnostics: [] }, fact, node, receiver, ast.arguments(node),
  () => ({ kind: "path", path: "snapshot" }), () => undefined);
  assert.equal(scope.kind, "selected", "the real source mutation still requires its native snapshot scope");
  assert.equal(scope.steps.length, 1, "the receiver snapshot is prepared exactly once before the effectful RHS");
  assert.equal(scope.overrides.sourceValues.has(receiver), true, "the later native call consumes the stable owned observation");
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

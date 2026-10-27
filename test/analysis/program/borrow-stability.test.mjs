import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createRustRecordFixture, rustNativeFixtureNodes } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression } from "@tsonic/target-api/source";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { analyzeRustBorrowEffects, selectRustBorrowRelationship } from "../../../dist/analysis/ownership/effects.js";
import { validateRustFinalizedOperationAbi } from "../../../dist/policy/operations/members/abi/validation.js";

function analyze(input, maximumNodes) {
  const selected = analyzeRustBorrowEffects(input, input.readUses, maximumNodes);
  return selected.kind === "resolved" ? { ...selected, input } : selected;
}
import { fakeAstReader } from "../../helpers/fake-compile-input.mjs";
import { argumentPassingFactKey, pointerOperationFactKey } from "@tsonic/tsts";

import { providerEvaluationOrderSource } from "../../../../tsonic/test/fixtures/provider-evaluation-order.mjs";



import { rustProviderInputBorrowMode } from "../../../dist/policy/operations/members/input-borrows.js";
import { rustCallArgumentIsOwned, rustCallArgumentMode } from "../../../dist/analysis/callables/values/parameter-passing.js";
import { borrowedScalarFieldWritesSource, ordinaryScalarFieldWritesSource, ownedFieldSnapshotSource } from "../../../../tsonic/test/fixtures/borrowed-scalar-field-writes.mjs";
import { receiverFieldCaptureEdges } from "../../../../tsonic/test/fixtures/receiver-field-capture-edges.mjs";

function allNodes(ast, files) {
  const output = [];
  const pending = [...files];
  const visited = new Set();
  while (pending.length !== 0) {
    const node = pending.pop();
    if (visited.has(node)) continue;
    visited.add(node);
    output.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
  }
  return output;
}

test("native binding comparisons borrow observations and distinguish exact replacement targets", () => {
  const { program, source: checkedSource } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    export function observed(left: string[] | undefined, right: string[]): boolean { return left === right; }
    export function replaced(left: string[] | undefined, right: string[]): boolean { return left === (left = right); }
    export function unrelated(left: string[] | undefined, right: string[], other: string[]): boolean {
      return left === (right = other);
    }
    export function opaque(left: string[] | undefined, right: () => string[]): boolean { return left === right(); }
    export function observableOwnedResult(left: string | undefined, right: string): boolean { return left === right.trim(); }
    export function sequenced(left: string[] | undefined, right: string[], other: string[]): boolean {
      let order = 0;
      return (order++, left) === (right = other);
    }
    export function replacedSequence(left: string[] | undefined, right: string[]): boolean {
      let order = 0;
      return (order++, left) === (left = right);
    }
  ` } });
  const sourceFacts = createTargetSourceProgram(checkedSource).sourceFacts;
  const { ast } = program.source;
  const nodes = allNodes(ast, program.sourceFiles);
  for (const [name, expected] of [["observed", true], ["replaced", false], ["unrelated", true], ["opaque", false],
    ["observableOwnedResult", false], ["sequenced", true], ["replacedSequence", false]]) {
    const declaration = nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === name);
    const comparison = allNodes(ast, [declaration]).find(node => ast.is.IsBinaryExpression(node) &&
      program.records.targetOperation.get(node)?.kind === "option-equality");
    assert.equal(comparison !== undefined, true, name);
    const left = BinaryExpression_Left(ast, comparison);
    const right = BinaryExpression_Right(ast, comparison);
    assert.equal(program.ownership.reads.get(left).borrowedAcross.has(right), expected, name);
    let bindingNode = left;
    while (!ast.is.IsIdentifier(bindingNode)) {
      bindingNode = program.records.targetOperation.get(bindingNode)?.kind === "sequence"
        ? BinaryExpression_Right(ast, bindingNode) : Node_Expression(ast, bindingNode);
      assert.equal(bindingNode !== undefined, true, name + " exact binding subject");
    }
    const binding = program.records.sourceBinding.get(bindingNode);
    const records = createRustRecordFixture({
sourceBinding: { get: (node) => {
    return node === bindingNode ? { ...binding, scope: "module" } : program.records.sourceBinding.get(node);
} }}, program.records);
    const rejected = analyze(analysisInput(program, sourceFacts, records));
    assert.equal(rejected.kind, "resolved", name);
    assert.equal(selectRustBorrowRelationship(left, right, rejected.input, rejected.effects), false, name + " foreign storage");
    if (name === "observableOwnedResult") {
      const operation = program.records.targetOperation.get(right);
      assert.equal(operation.kind, "provider-operation");
      assert.equal(operation.abi.effects.evaluation, "observable", "the actual source profile is never overridden in product");
      for (const [effects, accepted] of [
        [{ ...operation.abi.effects, evaluation: "pure" }, true],
        [{ ...operation.abi.effects, evaluation: "pure", safety: "requires-unsafe" }, false],
        [{ ...operation.abi.effects, evaluation: "pure", invocation: "fallible" }, false],
      ]) {
        const records = createRustRecordFixture({
targetOperation: { get: (node) => {
    return node === right
        ? { ...operation, abi: { ...operation.abi, effects } } : program.records.targetOperation.get(node);
} }}, program.records);
        const result = analyze(analysisInput(program, sourceFacts, records));
        assert.equal(result.kind, "resolved");
        assert.equal(selectRustBorrowRelationship(left, right, result.input, result.effects), accepted, "exact native pure-input effect contract");
      }
      const carrier = operation.abi.result.carrier;
      const projection = { sourceCarrier: carrier, targetCarrier: carrier,
        conversion: { kind: "native-representation", source: carrier, target: carrier } };
      const projectedFacts = createRustRecordFixture({
        targetOperation: { get: node => node === right
          ? { ...operation, abi: { ...operation.abi, effects: { ...operation.abi.effects, evaluation: "pure" } } }
          : program.records.targetOperation.get(node) },
        contextualValueConversion: { get: node => node === right
          ? projection : program.records.contextualValueConversion.get(node) },
      }, program.records);
      const projected = analyze(analysisInput(program, sourceFacts, projectedFacts));
      assert.equal(projected.kind, "resolved");
      assert.equal(selectRustBorrowRelationship(left, right, projected.input, projected.effects), false,
        "pure invocation does not certify an independently projected result");
      const lift = program.records.optionProjection.get(right);
      assert.equal(lift.kind, "some", "the real owned output retains native optional construction");
      const distinct = { kind: "source-primitive", name: "int64" };
      for (const replacement of [
        { kind: "none", sourceCarrier: lift.sourceCarrier, resultCarrier: lift.resultCarrier },
        { ...lift, sourceCarrier: distinct }, { ...lift, elementCarrier: distinct }, { ...lift, resultCarrier: carrier },
      ]) {
        const records = createRustRecordFixture({
          targetOperation: { get: node => node === right
            ? { ...operation, abi: { ...operation.abi, effects: { ...operation.abi.effects, evaluation: "pure" } } }
            : program.records.targetOperation.get(node) },
          optionProjection: { get: node => node === right
            ? replacement : program.records.optionProjection.get(node) },
        }, program.records);
        const rejected = analyze(analysisInput(program, sourceFacts, records));
        assert.equal(rejected.kind, "resolved");
        assert.equal(selectRustBorrowRelationship(left, right, rejected.input, rejected.effects), false, "only exact native Some construction is a pure result lift");
      }
    }
  }
});

function analysisInput(program, sourceFacts, records = program.records) {
  const nodes = rustNativeFixtureNodes(program);
  const nativeNodes = new Set(nodes);
  return { ast: program.source.ast, nodes, isNativeNode: node => nativeNodes.has(node), sourceFacts, records, navigation: program.sourceNavigation,
    readUses: program.ownership.uses,
    projectTypes: program.projectTypes, objectRepresentations: program.objectRepresentations,
    structuralShapes: program.structuralShapes, frozenDataWrites: program.frozenDataWrites };
}

test("source method receiver stability consumes the completed native read use and preserves exposure refusals", () => {
  const { program, source } = analyzeRust({ surfaces: [], files: { "index.ts": `
class Counter {
  constructor(public total: number) {}
  read(value: number): number { return this.total + value; }
}
function next(): number { return 1; }
export function observed(owner: Counter): number { return owner.read(next()) + owner.total; }
` } });
  const input = analysisInput(program, createTargetSourceProgram(source).sourceFacts);
  const ast = program.source.ast;
  const call = input.nodes.find(node => ast.is.IsCallExpression(node) &&
    program.records.targetOperation.get(node)?.kind === "source-call" &&
    program.records.targetOperation.get(node)?.target.form === "method");
  assert.equal(call !== undefined, true, "the real checked source method is selected");
  const receiver = Node_Expression(ast, Node_Expression(ast, call));
  const argument = ast.arguments(call)[0];
  const binding = program.records.sourceBinding.get(receiver);
  assert.equal(receiver !== undefined && argument !== undefined && binding !== undefined, true);
  assert.equal(input.readUses.get(receiver)?.mode, "shared", "actual selected native self demand");
  const selected = analyze(input);
  assert.equal(selected.kind, "resolved");
  assert.equal(selected.effects.pureValues.has(argument), false, "the source call argument remains observable");
  assert.equal(selected.effects.stableBindings.has(receiver), true, "the original owner is stable across its argument");
  assert.equal(program.ownership.reads.get(receiver).borrowedAcross.has(argument), true);
  for (const mode of [undefined, "mutable", "move"]) {
    const readUses = new Map(input.readUses);
    if (mode === undefined) readUses.delete(receiver);
    else readUses.set(receiver, { ...readUses.get(receiver), mode });
    const rejected = analyze({ ...input, readUses });
    assert.equal(rejected.kind, "resolved");
    assert.equal(rejected.effects.stableBindings.has(receiver), false, "no shared receiver proof: " + mode);
  }
  for (const flag of ["captured", "exported", "bindingWritten", "memberWritten", "hasUnclassifiedValueUse"]) {
    const rejected = analyze({ ...input, navigation: { ...input.navigation, declarationUseSummary(declaration) {
      const summary = input.navigation.declarationUseSummary(declaration);
      return declaration === binding.sourceDeclaration ? { ...summary, [flag]: true } : summary;
    } } });
    assert.equal(rejected.kind, "resolved");
    assert.equal(rejected.effects.stableBindings.has(receiver), false, "actual exposure refuses stability: " + flag);
  }
});

function functionAssignment(program, name) {
  const ast = program.source.ast;
  const declaration = allNodes(ast, program.sourceFiles).find(node => ast.is.IsFunctionDeclaration(node) &&
    ast.name(node) !== undefined && ast.text(ast.name(node)) === name);
  assert.equal(declaration !== undefined, true, name);
  const assignment = allNodes(ast, [declaration]).find(node => ast.is.IsBinaryExpression(node) &&
    program.records.targetOperation.get(node)?.operator === "=");
  assert.equal(assignment !== undefined, true, name + " assignment");
  return assignment;
}

function indexedBindingFixture({ uses = 1_100, bindingWritten = false, scope = "lexical", passing, pointer } = {}) {
  const declaration = {};
  const receivers = [{ kindName: "KindIdentifier" }, { kindName: "KindIdentifier" }];
  const updates = receivers.map(receiver => ({ kindName: "KindPostfixUnaryExpression",
    operand: { kindName: "KindElementAccessExpression", receiver } }));
  const root = { children: updates };
  const useNodes = Array.from({ length: uses }, () => ({ kindName: "KindIdentifier" }));
  let summaries = 0;
  const reader = fakeAstReader();
  const input = {
    sourceFiles: [root],
    readUses: new Map(),
    ast: { ...reader, is: { ...reader.is,
      IsIdentifier: node => receivers.includes(node) || useNodes.includes(node),
      IsPostfixUnaryExpression: node => updates.includes(node),
      IsElementAccessExpression: node => updates.some(update => update.operand === node),
    }, as: {
      AsPostfixUnaryExpression: node => ({ Operand: node.operand }),
      AsElementAccessExpression: node => ({ Expression: node.receiver }),
    }, parent: node => useNodes.includes(node) ? { kindName: "KindExpressionStatement" } : undefined,
    forEachChild: (node, visit) => (node.children ?? (node.operand === undefined
      ? node.receiver === undefined ? [] : [node.receiver] : [node.operand])).forEach(visit) },
    records: createRustRecordFixture({
      compoundWrite: { get: node => updates.includes(node) ? {
        abi: { targetReceiver: { kind: "input", input: { mode: "ref", conversion: { kind: "identity" } } } },
      } : undefined },
      sourceBinding: { get: node => receivers.includes(node) ? { scope, sourceDeclaration: declaration } : undefined },
    }),
    sourceFacts: { getFact(node, key) {
      if (useNodes.includes(node) && key === argumentPassingFactKey && passing !== undefined) return { mode: passing };
      if (useNodes.includes(node) && key === pointerOperationFactKey && pointer !== undefined) return { operation: pointer };
      return undefined;
    } },
    navigation: { declarationUseSummary(selected) {
      assert.equal(selected === declaration, true, "exact lexical declaration identity");
      summaries += 1;
      return { bindingWritten, exported: false, uses: useNodes.map(reference => ({ reference })) };
    } },
  };
  input.nodes = allNodes(input.ast, [root]);
  const nativeNodes = new Set(input.nodes);
  input.isNativeNode = node => nativeNodes.has(node);
  return { input, receivers, summaries: () => summaries };
}

test("indexed receiver stability has one sealed declaration proof beyond the retired per-use cutoff", () => {
  const fixture = indexedBindingFixture();
  const result = analyze(fixture.input, 10_000);
  assert.equal(result.kind, "resolved", "more than2048harmless exposure visits fit the actual aggregate bound");
  assert.equal(fixture.summaries(), 1, "two demanded receivers share one exact declaration proof");
  fixture.input.navigation.declarationUseSummary = () => { throw new Error("sealed lookup cannot analyze"); };
  fixture.input.ast.parent = () => { throw new Error("sealed lookup cannot walk source syntax"); };
  for (const receiver of fixture.receivers) assert.equal(result.effects.stableBindings.has(receiver), true);
  assert.equal(result.effects.stableBindings.has({}), false, "foreign identity cannot obtain borrowing evidence");
});

test("indexed binding stability rejects exhaustion rather than silently materializing a receiver", () => {
  const fixture = indexedBindingFixture();
  const result = analyze(fixture.input, 2_048);
  assert.equal(result.kind, "rejected");
  assert.equal("effects" in result, false, "an exhausted exposure proof cannot publish a partial plan");
  assert.equal(result.diagnostics[0].code, "RUST_BORROW_STABILITY_BUDGET_INVALID");
});

test("indexed binding stability caches negative decisions and preserves exact passing and pointer exposure rules", () => {
  for (const [name, options, expected] of [
    ["rebinding", { bindingWritten: true }, false],
    ["module", { scope: "module" }, false],
    ["mutable borrow", { passing: "borrow-mut" }, false],
    ["mutable byref", { passing: "byref" }, false],
    ["move", { passing: "move" }, false],
    ["address", { pointer: "address-of" }, false],
    ["shared borrow", { passing: "borrow-shared" }, true],
    ["readonly byref", { passing: "byref-readonly" }, true],
    ["value passing", { passing: "by-value" }, true],
  ]) {
    const fixture = indexedBindingFixture({ uses: 2, ...options });
    const result = analyze(fixture.input, 100);
    assert.equal(result.kind, "resolved", name);
    for (const receiver of fixture.receivers) assert.equal(result.effects.stableBindings.has(receiver), expected, name);
    assert.equal(fixture.summaries(), options.scope === "module" ? 0 : 1, name + " completed decision is reused");
  }
});

test("source-checked indexed updates retain stable member writes but reject captured and direct rebinding", () => {
  const { program, source: checkedSource } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
const moduleValues: number[] = [1];
export function stable(values: number[]): void { values[0]++; values[0] += 2; }
export function readonlyCapture(values: number[]): number { const read = () => values[0]; values[0]++; return read(); }
export function rebound(values: number[]): void { values[0]++; values = [2]; }
export function capturedWrite(values: number[]): void { const change = () => { values = [2]; }; values[0]++; change(); }
export function moduleUpdate(): void { moduleValues[0]++; }
` } });
  const sourceFacts = createTargetSourceProgram(checkedSource).sourceFacts;
  const ast = program.source.ast;
  const nodes = allNodes(ast, program.sourceFiles);
  for (const [name, expected] of [["stable", true], ["readonlyCapture", true], ["rebound", false],
    ["capturedWrite", false], ["moduleUpdate", false]]) {
    const declaration = nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === name);
    assert.equal(declaration !== undefined, true, name);
    const demands = allNodes(ast, [declaration]).filter(node => program.records.compoundWrite.get(node) !== undefined);
    assert.equal(demands.length > 0, true, name + " real finalized update demands");
    for (const demand of demands) {
      const target = ast.is.IsBinaryExpression(demand) ? BinaryExpression_Left(ast, demand) : ast.as.AsPostfixUnaryExpression(demand)?.Operand;
      const receiver = Node_Expression(ast, target);
      assert.equal(program.ownership.reads.get(receiver).stablePlace, expected, name);
    }
  }
});

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`the exact projected-fields positive has sealed borrowed scalar writes in ${profile}`, () => {
    const fixture = receiverFieldCaptureEdges.find(example => example.name === "projected-fields");
    assert.equal(fixture !== undefined, true);
    const { program, source: checkedSource } = analyzeRust({ surfaces, files: { "index.ts": fixture.source } });
    const sourceFacts = createTargetSourceProgram(checkedSource).sourceFacts;
    const assignments = allNodes(program.source.ast, program.sourceFiles).filter(node =>
      program.source.ast.is.IsBinaryExpression(node) &&
      program.records.targetOperation.get(node)?.operator === "=");
    const writes = assignments.flatMap(node => {
      const selected = program.ownership.writes.get(node);
      return selected === undefined ? [] : [[node, selected]];
    });
    assert.equal(writes.length, 2, "parameter and literal projected writes");
    assert.equal(Object.isFrozen(program.ownership), true);
    for (const [node, selected] of writes) {
      assert.equal(Object.isFrozen(selected), true);
      assert.equal(selected.target === BinaryExpression_Left(program.source.ast, node), true);
      assert.equal(selected.value === BinaryExpression_Right(program.source.ast, node), true);
      assert.equal(selected.receiver === Node_Expression(program.source.ast, selected.target), true);
      assert.equal(selected.location, "captured-field");
      assert.equal(program.objectRepresentations.receiverCaptures.isCaptured(selected.field.declaration), true);
      assert.equal(program.ownership.reads.get(selected.value).pure, true);
      assert.equal(selected.fallible, profile === "js");
    }
    assert.equal(program.ownership.writes.get({}) === undefined, true, "foreign source node");
  });

  test(`scalar storage stays pure while reentrant, getter and owned values retain snapshots in ${profile}`, () => {
    const { program, source: checkedSource } = analyzeRust({ surfaces, files: { "index.ts": borrowedScalarFieldWritesSource } });
    const sourceFacts = createTargetSourceProgram(checkedSource).sourceFacts;
    for (const name of ["parameter", "literal", "storage", "arithmetic"]) {
      const assignment = functionAssignment(program, name);
      assert.equal(program.ownership.writes.get(assignment) !== undefined, true, name);
    }
    for (const name of ["reentrant", "accessor"]) {
      const assignment = functionAssignment(program, name);
      assert.equal(program.ownership.writes.get(assignment) === undefined, true, name);
      assert.equal((program.ownership.reads.get(BinaryExpression_Right(program.source.ast, assignment))?.pure === true), false, name);
    }
    const owned = analyzeRust({ surfaces, files: { "index.ts": ownedFieldSnapshotSource } }).program;
    assert.equal(owned.ownership.writes.get(functionAssignment(owned, "ownedWrite")) === undefined, true);
  });

  test(`ordinary class field borrows require independent physical states in ${profile}`, () => {
    const { program, source: checkedSource } = analyzeRust({ surfaces, files: { "index.ts": ordinaryScalarFieldWritesSource } });
    const sourceFacts = createTargetSourceProgram(checkedSource).sourceFacts;
    const distinct = program.ownership.writes.get(functionAssignment(program, "distinct"));
    assert.equal(distinct !== undefined, true, "ordinary class scalar write");
    assert.equal(distinct.location, "stored-field");
    assert.equal(program.ownership.writes.get(functionAssignment(program, "identical")) === undefined,
      true, "same carrier can alias the parent state");
  });

  test(`borrowed writes reject stale captures, unknown projections and non-stored views in ${profile}`, () => {
    const source = borrowedScalarFieldWritesSource.replace("interface Point { x: number; y: number; }",
      "type Point = { x: number; y: number };");
    const { program, source: checkedSource } = analyzeRust({ surfaces, files: { "index.ts": source } });
    const sourceFacts = createTargetSourceProgram(checkedSource).sourceFacts;
    const assignment = functionAssignment(program, "parameter");
    const selected = program.ownership.writes.get(assignment);
    assert.equal(selected !== undefined, true);
    const targetFact = program.records.targetOperation.get(selected.target);
    assert.equal(targetFact.storage, "structural-object", "the structural mutation bank targets its actual owner");
    const storageFact = program.records.capturedFieldStorage.get(selected.field.declaration);
    assert.equal(storageFact !== undefined, true);
    const mutations = [
      [selected.receiver, "targetOperation", { ...selected.field, valueSemantics: { kind: "accessor", writable: true } }],
      [selected.receiver, "targetOperation", { ...selected.field, dispatch: { read: "read", write: "write", ownerCarrier: selected.field.receiverCarrier } }],
      [selected.receiver, "targetOperation", { ...selected.field, storageIndex: -1 }],
      [selected.target, "targetOperation", { ...targetFact, accessMode: "read-write" }],
      [selected.field.declaration, "capturedFieldStorage", undefined],
      [selected.field.declaration, "capturedFieldStorage", { ...storageFact, storage: { ...storageFact.storage, kind: "cell" } }],
      [selected.value, "contextualValueConversion", { sourceCarrier: targetFact.resultCarrier, targetCarrier: targetFact.resultCarrier,
        conversion: { kind: "native-representation", source: targetFact.resultCarrier, target: targetFact.resultCarrier } }],
    ];
    for (const [index, [subject, key, replacement]] of mutations.entries()) {
      const records = { ...program.records, [key]: {
        get: node => node === subject ? replacement : program.records[key].get(node),
      } };
      const result = analyze(analysisInput(program, sourceFacts, records));
      assert.equal(result.kind, "resolved", "mutation " + index);
      assert.equal(result.effects.fieldWrites.get(assignment) === undefined, true, "mutation " + index);
    }
    const binding = program.records.sourceBinding.get(selected.value);
    assert.equal(binding !== undefined, true);
    const locationFacts = createRustRecordFixture({
bindingStorage: { get: (node) => {
    return node === binding.sourceDeclaration
        ? { storage: "location", valueCarrier: targetFact.resultCarrier } : program.records.bindingStorage.get(node);
} }}, program.records);
    assert.equal(analyze(analysisInput(program, sourceFacts, locationFacts)).effects.fieldWrites.get(assignment) === undefined, true);
    const unknownCopy = createRustRecordFixture({
runtimeCarrier: { get: (node) => {
    return node === selected.value ? { carrier: { kind: "target-named", id: "external.CustomClone" } }
        : program.records.runtimeCarrier.get(node);
} }}, program.records);
    assert.equal(analyze(analysisInput(program, sourceFacts, unknownCopy)).effects.fieldWrites.get(assignment) === undefined, true);
    for (const storage of ["bound", "property"]) {
      const input = analysisInput(program, sourceFacts);
      const shapeField = input.structuralShapes.field(targetFact.receiverCarrier, targetFact.storageIndex);
      input.structuralShapes = { ...input.structuralShapes, field(carrier, index) {
        return carrier === targetFact.receiverCarrier && index === targetFact.storageIndex
          ? { ...shapeField, storage } : program.structuralShapes.field(carrier, index);
      } };
      assert.equal(analyze(input).effects.fieldWrites.get(assignment) === undefined, true, storage);
    }
    for (const replacement of [
      { readonly: true }, { method: true }, { nativeLayout: {} },
    ]) {
      const input = analysisInput(program, sourceFacts);
      const shapeField = input.structuralShapes.field(targetFact.receiverCarrier, targetFact.storageIndex);
      input.structuralShapes = { ...input.structuralShapes, field(carrier, index) {
        return carrier === targetFact.receiverCarrier && index === targetFact.storageIndex
          ? { ...shapeField, ...replacement } : program.structuralShapes.field(carrier, index);
      } };
      assert.equal(analyze(input).effects.fieldWrites.get(assignment) === undefined, true, Object.keys(replacement)[0]);
    }
    const dispatched = analysisInput(program, sourceFacts);
    dispatched.structuralShapes = { ...dispatched.structuralShapes, definitionForCarrier(carrier) {
      const shape = program.structuralShapes.definitionForCarrier(carrier);
      return carrier === targetFact.receiverCarrier ? { ...shape, dispatchName: "selected_dispatch" } : shape;
    } };
    assert.equal(analyze(dispatched).effects.fieldWrites.get(assignment) === undefined,
      true, "structural dispatch can conceal a bound state");
  });
}

test("only the exact finalized pure scalar provider ABI can extend a captured-field borrow", () => {
  const { program, source: checkedSource } = analyzeRust({ surfaces: ["js"], files: { "index.ts": borrowedScalarFieldWritesSource + `
export function provider(holder: Value, value: number): void { holder.point.x = Math.abs(value); }
` } });
  const sourceFacts = createTargetSourceProgram(checkedSource).sourceFacts;
  const assignment = functionAssignment(program, "provider");
  const value = BinaryExpression_Right(program.source.ast, assignment);
  const operation = program.records.targetOperation.get(value);
  assert.equal(operation?.kind, "provider-operation");
  assert.equal(program.ownership.writes.get(assignment) !== undefined, true);
  for (const [index, abi] of [
    { ...operation.abi, effects: { ...operation.abi.effects, evaluation: "observable" } },
    { ...operation.abi, effects: { ...operation.abi.effects, safety: "requires-unsafe" } },
    { ...operation.abi, effects: { ...operation.abi.effects, invocation: "fallible" } },
    { ...operation.abi, sourceArguments: [] },
    { ...operation.abi, sourceArguments: operation.abi.sourceArguments.map(argument => ({ ...argument, form: "spread-sequence" })) },
  ].entries()) {
    const records = createRustRecordFixture({
targetOperation: { get: (node) => {
    return node === value ? { ...operation, abi } : program.records.targetOperation.get(node);
} }}, program.records);
    assert.equal(analyze(analysisInput(program, sourceFacts, records)).effects.fieldWrites.get(assignment) === undefined, true, String(index));
  }
});

test("provider property and indexed reads use their own AST input shape without call argument reconstruction", () => {
  const { program, source: checkedSource } = analyzeRust({ surfaces: ["js"], files: { "index.ts": borrowedScalarFieldWritesSource + `
export function constant(holder: Value): void { holder.point.x = Math.PI; }
export function observed(holder: Value, text: string): void { holder.point.x = text.length; }
export function indexed(values: string[]): number { return values[0].length; }
` } });
  const sourceFacts = createTargetSourceProgram(checkedSource).sourceFacts;
  const constant = functionAssignment(program, "constant");
  assert.equal(program.ownership.writes.get(constant) !== undefined, true, "exact pure constant ABI");
  const observed = functionAssignment(program, "observed");
  assert.equal(program.ownership.writes.get(observed) === undefined, true,
    "an owned string observation is not an unprojected primitive Copy input");
});

test("borrow stability budgets are finite, bounded and reject cycles without AST diagnostics", () => {
  const root = { children: [{ children: [] }] };
  const nativeNodes = new Set([root, ...root.children]);
  const input = {
    isNativeNode: node => nativeNodes.has(node),
    readUses: new Map(),
    nodes: [root, ...root.children], ast: { ...fakeAstReader(), is: { ...fakeAstReader().is,
      IsPrefixUnaryExpression: () => false, IsPostfixUnaryExpression: () => false },
      forEachChild: (node, visit) => node.children.forEach(visit) },
    records: createRustRecordFixture({runtimeCarrier: { get: () => undefined }}),
  };
  assert.equal(analyze(input, 1).kind, "rejected");
  assert.equal(analyze(input, 2).kind, "resolved");
  for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 4_194_305, Number.MAX_SAFE_INTEGER]) {
    const result = analyze(input, limit);
    assert.equal(result.kind, "rejected", String(limit));
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].sourceNode === undefined, true);
    assert.equal(result.diagnostics[0].message.length < 160, true);
  }
  root.children.push(root);
  assert.equal(analyze(input, 8).kind, "rejected", "cycle");
});

test("borrow stability uses the canonical erased domain without accepting missing native children", () => {
  const { program, source } = analyzeRust({ surfaces: [], files: { "index.ts": `
export function run(): number {
  function unused(key: string): number { const value = { [key]: 1 }; return 0; }
  return 42;
}` } });
  const input = analysisInput(program, createTargetSourceProgram(source).sourceFacts);
  const checked = allNodes(program.source.ast, program.sourceFiles);
  const erased = checked.find(node => program.records.nativeParticipation.get(node) === "erased");
  const literal = input.nodes.find(node => program.source.ast.is.IsNumericLiteral(node) && program.source.ast.text(node) === "42");
  assert.equal(erased !== undefined && literal !== undefined, true, "actual checked erased and admitted source identities exist");
  assert.equal(input.nodes.includes(erased), false, "the native array is the exact completed canonical projection");
  assert.equal(input.isNativeNode(erased), false, "only an explicitly erased source subtree is excluded");
  const selected = analyze(input);
  assert.equal(selected.kind, "resolved", "an erased raw AST child is not a missing native obligation");
  assert.equal(selected.effects.pureValues.has(erased), false, "erasure is not a fabricated pure record");
  assert.equal(selected.effects.nativeWrites.has(erased), false, "no erased native effect is published");
  for (const [label, nodes] of [
    ["missing native child", input.nodes.filter(node => node !== literal)],
    ["duplicate native child", [...input.nodes, literal]],
    ["foreign child", [...input.nodes, Object.freeze({ foreign: true })]],
    ["erased source child", [...input.nodes, erased]],
  ]) {
    const rejected = analyze({ ...input, nodes });
    assert.equal(rejected.kind, "rejected", label + ": invalid native domains are refused");
    assert.equal(rejected.diagnostics.length, 1, label + ": one owning diagnostic");
    assert.equal(rejected.diagnostics[0].code, "RUST_BORROW_STABILITY_BUDGET_INVALID", label + ": exact owner");
    assert.equal(Object.hasOwn(rejected, "effects"), false, label + ": no partial effect plan");
  }
});

test("native field borrowing consumes exact disjoint scalar writes but rejects opaque calls and stale field facts", () => {
  const { program, source: checkedSource } = analyzeRust({ surfaces: ["js"], files: { "index.ts": providerEvaluationOrderSource } });
  const sourceFacts = createTargetSourceProgram(checkedSource).sourceFacts;
  const ast = program.source.ast;
  const count = allNodes(ast, program.sourceFiles).length;
  assert.equal(analyze(analysisInput(program, sourceFacts), count).kind, "rejected",
    "native write correspondence consumes the same finite aggregate accounting budget");
  assert.equal(analyze(analysisInput(program, sourceFacts), count + 128).kind, "resolved");
  const methods = allNodes(ast, program.sourceFiles).filter(node => ast.is.IsMethodDeclaration(node));
  for (const name of ["next", "combined", "observed", "mutated"]) {
    const method = methods.find(node => ast.text(ast.name(node)) === name);
    const index = allNodes(ast, [method]).find(node => ast.is.IsElementAccessExpression(node));
    const receiver = Node_Expression(ast, index);
    const operand = ast.as.AsElementAccessExpression(index)?.ArgumentExpression;
    assert.equal(program.ownership.reads.get(receiver).borrowedAcross.has(operand), name !== "mutated", name);
    if (name !== "next") continue;
    assert.equal(program.ownership.reads.get(receiver).borrowedAcross.has({}), false, "foreign node");
    assert.equal(program.ownership.reads.get(ast.as.AsPostfixUnaryExpression(operand)?.Operand).borrowedAcross.has(operand), false,
      "the exact same physical field is never treated as disjoint");
    const field = program.records.targetOperation.get(receiver);
    for (const replacement of [undefined, { ...field, storageIndex: -1 },
      { ...field, valueSemantics: { kind: "accessor", writable: true } },
      { ...field, dispatch: { read: "read", write: "write", ownerCarrier: field.receiverCarrier } }]) {
      const records = createRustRecordFixture({
targetOperation: { get: (node) => {
    return node === receiver ? replacement : program.records.targetOperation.get(node);
} }}, program.records);
      const selected = analyze(analysisInput(program, sourceFacts, records));
      assert.equal(selected.kind, "resolved");
      assert.equal(selectRustBorrowRelationship(receiver, operand, selected.input, selected.effects), false);
    }
  }
});

test("identity native shared references retain source borrowing without claiming mutable or owned input borrowing", () => {
  const { program, source: checkedSource } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    export function inspect(value: string): number { return parseInt(value, 10); }
  ` } });
  const sourceFacts = createTargetSourceProgram(checkedSource).sourceFacts;
  const operation = allNodes(program.source.ast, program.sourceFiles)
    .map(node => program.records.targetOperation.get(node))
    .find(fact => fact?.kind === "provider-operation" && fact.abi.targetArguments[0]?.sourceCarrier?.kind === "reference");
  assert.equal(operation !== undefined, true, "actual selected native parsing input");
  const input = operation.abi.targetArguments[0];
  assert.equal(input.mode, "value");
  assert.equal(input.conversion.kind, "identity");
  assert.equal(input.sourceCarrier.mutable, false);
  assert.equal(rustProviderInputBorrowMode(input), "ref", "by-value shared reference does not own its referent");
  const distinct = { kind: "reference", mutable: false, referent: { kind: "source-primitive", name: "int64" } };
  const mutable = { ...input.sourceCarrier, mutable: true };
  const owned = { kind: "target-named", id: "rust.std.String" };
  for (const [label, replacement] of [
    ["parameter mismatch", { ...input, parameterCarrier: distinct }],
    ["source mismatch", { ...input, sourceCarrier: distinct }],
    ["conversion source mismatch", { ...input, conversion: { ...input.conversion, sourceCarrier: distinct } }],
    ["conversion target mismatch", { ...input, conversion: { ...input.conversion, targetCarrier: distinct } }],
    ["fallible conversion", { ...input, conversion: { ...input.conversion, fallible: true } }],
    ["mutable reference move", { ...input, sourceCarrier: mutable, parameterCarrier: mutable,
      conversion: { ...input.conversion, sourceCarrier: mutable, targetCarrier: mutable } }],
    ["owning value", { ...input, sourceCarrier: owned, parameterCarrier: owned,
      conversion: { ...input.conversion, sourceCarrier: owned, targetCarrier: owned } }],
    ["malformed native carrier", { ...input, sourceCarrier: { ...input.sourceCarrier, unknown: true } }],
  ]) assert.equal(rustProviderInputBorrowMode(replacement) === undefined, true, label);
  assert.equal(rustProviderInputBorrowMode({ ...input, sourceCarrier: distinct, parameterCarrier: distinct,
    conversion: { ...input.conversion, sourceCarrier: distinct, targetCarrier: distinct } }), "ref",
  "reference ownership is a native type rule, not a String or wrapper-name rule");
  assert.equal(rustProviderInputBorrowMode({ ...input, mode: "mut-ref" }), "mut-ref",
    "an explicit exclusive borrow retains its distinct mode");
});

test("source argument ownership follows all exact finalized native inputs rather than reference passing by value", () => {
  const { program, source: checkedSource } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    export function inspect(value: string): number { return parseInt(value, 10); }
  ` } });
  const sourceFacts = createTargetSourceProgram(checkedSource).sourceFacts;
  const { ast } = program.source;
  const call = allNodes(ast, program.sourceFiles).find(node => ast.is.IsCallExpression(node) &&
    ast.is.IsIdentifier(Node_Expression(ast, node)) && ast.text(Node_Expression(ast, node)) === "parseInt");
  assert.equal(call !== undefined, true);
  const argument = ast.arguments(call)[0];
  const radix = ast.arguments(call)[1];
  assert.equal(rustCallArgumentMode(argument, ast, program.records), "ref");
  assert.equal(rustCallArgumentIsOwned(argument, ast, program.records), false);
  assert.equal(rustCallArgumentMode(radix, ast, program.records), "value");
  assert.equal(rustCallArgumentMode(Node_Expression(ast, call), ast, program.records), undefined);
  const operation = program.records.targetOperation.get(call);
  const selected = operation.abi.targetArguments[0];
  for (const [label, targetArguments, expected] of [
    ["missing source relationship", [operation.abi.targetArguments[1]], undefined],
    ["repeated shared observation", [selected, selected, operation.abi.targetArguments[1]], "ref"],
    ["mixed shared and exclusive uses", [selected, { ...selected, mode: "mut-ref" }], undefined],
    ["nested native slice inputs", [{ source: { kind: "argument-slice", sourceIndexes: [0] },
      elements: [selected], elementCarrier: selected.sourceCarrier, mode: "ref", parameterCarrier: selected.parameterCarrier }], "ref"],
  ]) {
    const records = createRustRecordFixture({
targetOperation: { get: (node) => {
    return node === call
        ? { ...operation, abi: { ...operation.abi, targetArguments } } : program.records.targetOperation.get(node);
} }}, program.records);
    assert.equal(rustCallArgumentMode(argument, ast, records), expected, label);
    assert.equal(rustCallArgumentIsOwned(argument, ast, records), false, label);
  }
});

test("borrowed conversion effects require exact finalized input and pure native observation contracts", () => {
  const { program, source: checkedSource } = analyzeRust({ surfaces: ["js"], files: { "index.ts": providerEvaluationOrderSource } });
  const sourceFacts = createTargetSourceProgram(checkedSource).sourceFacts;
  const ast = program.source.ast;
  const method = allNodes(ast, program.sourceFiles).find(node => ast.is.IsMethodDeclaration(node) &&
    ast.text(ast.name(node)) === "observed");
  assert.equal(method !== undefined, true);
  const nodes = allNodes(ast, [method]);
  const index = nodes.find(node => ast.is.IsElementAccessExpression(node));
  const receiver = Node_Expression(ast, index);
  const operand = ast.as.AsElementAccessExpression(index).ArgumentExpression;
  const observation = nodes.find(node => program.records.targetOperation.get(node)?.kind === "provider-operation" &&
    ast.is.IsPropertyAccessExpression(node));
  assert.equal(observation !== undefined, true);
  const operation = program.records.targetOperation.get(observation);
  const inputs = operation.abi.targetReceiver.kind === "input"
    ? [operation.abi.targetReceiver.input, ...operation.abi.targetArguments] : operation.abi.targetArguments;
  const input = inputs.find(selected => selected.conversion?.kind === "semantic");
  assert.equal(input !== undefined, true);
  assert.equal(validateRustFinalizedOperationAbi(operation.abi), true, "the real producer publishes a coherent native ABI");
  assert.equal(input.sharedConversion, true, "the canonical finalized input owns its source borrow");
  assert.equal(rustProviderInputBorrowMode(input), "ref");
  assert.equal(program.ownership.reads.get(receiver).borrowedAcross.has(operand), true);
  for (const replacement of [
    { ...input, mode: "mut-ref" },
    { ...input, parameterCarrier: { kind: "source-primitive", name: "float64" } },
    { ...input, sourceCarrier: { kind: "source-primitive", name: "int32" } },
    { ...input, conversion: { ...input.conversion, fallible: true } },
    { ...input, conversion: { ...input.conversion, sourceCarrier: { kind: "source-primitive", name: "int32" } } },
    { ...input, conversion: { ...input.conversion, targetCarrier: { kind: "source-primitive", name: "int32" } } },
  ]) {
    const abi = { ...operation.abi,
      targetReceiver: operation.abi.targetReceiver.kind === "input" && operation.abi.targetReceiver.input === input
        ? { kind: "input", input: replacement } : operation.abi.targetReceiver,
      targetArguments: operation.abi.targetArguments.map(selected => selected === input ? replacement : selected),
    };
    assert.equal(validateRustFinalizedOperationAbi(abi), false, "inexact native input is refused before publication");
  }
  for (const changes of [
    { effects: { ...operation.abi.effects, evaluation: "observable" } },
    { effects: { ...operation.abi.effects, safety: "requires-unsafe" } },
    { effects: { ...operation.abi.effects, invocation: "fallible" } },
    { result: { ...operation.abi.result, kind: "async" } },
    { sourceArguments: [{ form: "value", sourceIndex: 0 }] },
  ]) {
    const records = createRustRecordFixture({
targetOperation: { get: (node) => {
    return node === observation
        ? { ...operation, abi: { ...operation.abi, ...changes } } : program.records.targetOperation.get(node);
} }}, program.records);
    const result = analyze(analysisInput(program, sourceFacts, records));
    assert.equal(result.kind, "resolved");
    assert.equal(selectRustBorrowRelationship(receiver, operand, result.input, result.effects), false, "unknown observation never extends the source borrow");
  }
  const mutableInputs = { ...operation.abi,
    targetReceiver: operation.abi.targetReceiver.kind === "input"
      ? { kind: "input", input: { ...operation.abi.targetReceiver.input, mode: "mut-ref" } }
      : { kind: "none" },
    targetArguments: operation.abi.targetArguments.map(selected => ({ ...selected, mode: "mut-ref" })),
  };
  assert.equal(validateRustFinalizedOperationAbi(mutableInputs), false,
    "a forged mutable observation is refused at its canonical ABI publisher");
});

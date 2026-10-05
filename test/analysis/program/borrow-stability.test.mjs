import assert from "node:assert/strict";
import test from "node:test";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression } from "@tsonic/target-api/source";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { analyzeRustBorrowStability } from "../../../dist/analysis/program/borrow-stability.js";
import { rustBindingStorageFactKey, rustContextualValueConversionFactKey, rustSourceBindingFactKey,
  rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustCapturedFieldStorageFactKey } from "../../../dist/analysis/facts/receiver-captures.js";
import { borrowedScalarFieldWritesSource, ordinaryScalarFieldWritesSource, ownedFieldSnapshotSource } from "../../../../tsonic/test/fixtures/borrowed-scalar-field-writes.mjs";
import { receiverFieldCaptureEdges } from "../../../../tsonic/test/fixtures/receiver-field-capture-edges.mjs";

function allNodes(ast, files) {
  const output = [];
  const pending = [...files];
  while (pending.length !== 0) {
    const node = pending.pop();
    output.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
  }
  return output;
}

function analysisInput(program, facts = program.facts) {
  return { ast: program.source.ast, sourceFiles: program.sourceFiles, facts,
    projectTypes: program.projectTypes, objectRepresentations: program.objectRepresentations,
    structuralShapes: program.structuralShapes, frozenDataWrites: program.frozenDataWrites };
}

function functionAssignment(program, name) {
  const ast = program.source.ast;
  const declaration = allNodes(ast, program.sourceFiles).find(node => ast.is.IsFunctionDeclaration(node) &&
    ast.name(node) !== undefined && ast.text(ast.name(node)) === name);
  assert.equal(declaration !== undefined, true, name);
  const assignment = allNodes(ast, [declaration]).find(node => ast.is.IsBinaryExpression(node) &&
    program.facts.getFact(node, rustTargetOperationFactKey)?.operator === "=");
  assert.equal(assignment !== undefined, true, name + " assignment");
  return assignment;
}

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`the exact projected-fields positive has sealed borrowed scalar writes in ${profile}`, () => {
    const fixture = receiverFieldCaptureEdges.find(example => example.name === "projected-fields");
    assert.equal(fixture !== undefined, true);
    const { program } = analyzeRust({ surfaces, files: { "index.ts": fixture.source } });
    const assignments = allNodes(program.source.ast, program.sourceFiles).filter(node =>
      program.source.ast.is.IsBinaryExpression(node) &&
      program.facts.getFact(node, rustTargetOperationFactKey)?.operator === "=");
    const writes = assignments.flatMap(node => {
      const selected = program.borrowStability.borrowedWriteFor(node);
      return selected === undefined ? [] : [[node, selected]];
    });
    assert.equal(writes.length, 2, "parameter and literal projected writes");
    assert.equal(Object.isFrozen(program.borrowStability), true);
    for (const [node, selected] of writes) {
      assert.equal(Object.isFrozen(selected), true);
      assert.equal(selected.target === BinaryExpression_Left(program.source.ast, node), true);
      assert.equal(selected.value === BinaryExpression_Right(program.source.ast, node), true);
      assert.equal(selected.receiver === Node_Expression(program.source.ast, selected.target), true);
      assert.equal(selected.location, "captured-field");
      assert.equal(program.objectRepresentations.receiverCaptures.isCaptured(selected.field.declaration), true);
      assert.equal(program.borrowStability.isPureCopyValue(selected.value), true);
      assert.equal(selected.fallible, profile === "js");
    }
    assert.equal(program.borrowStability.borrowedWriteFor({}) === undefined, true, "foreign source node");
  });

  test(`scalar storage stays pure while reentrant, getter and owned values retain snapshots in ${profile}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": borrowedScalarFieldWritesSource } });
    for (const name of ["parameter", "literal", "storage", "arithmetic"]) {
      const assignment = functionAssignment(program, name);
      assert.equal(program.borrowStability.borrowedWriteFor(assignment) !== undefined, true, name);
    }
    for (const name of ["reentrant", "accessor"]) {
      const assignment = functionAssignment(program, name);
      assert.equal(program.borrowStability.borrowedWriteFor(assignment) === undefined, true, name);
      assert.equal(program.borrowStability.isPureCopyValue(BinaryExpression_Right(program.source.ast, assignment)), false, name);
    }
    const owned = analyzeRust({ surfaces, files: { "index.ts": ownedFieldSnapshotSource } }).program;
    assert.equal(owned.borrowStability.borrowedWriteFor(functionAssignment(owned, "ownedWrite")) === undefined, true);
  });

  test(`ordinary class field borrows require independent physical states in ${profile}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": ordinaryScalarFieldWritesSource } });
    const distinct = program.borrowStability.borrowedWriteFor(functionAssignment(program, "distinct"));
    assert.equal(distinct !== undefined, true, "ordinary class scalar write");
    assert.equal(distinct.location, "stored-field");
    assert.equal(program.borrowStability.borrowedWriteFor(functionAssignment(program, "identical")) === undefined,
      true, "same carrier can alias the parent state");
  });

  test(`borrowed writes reject stale captures, unknown projections and non-stored views in ${profile}`, () => {
    const source = borrowedScalarFieldWritesSource.replace("interface Point { x: number; y: number; }",
      "type Point = { x: number; y: number };");
    const { program } = analyzeRust({ surfaces, files: { "index.ts": source } });
    const assignment = functionAssignment(program, "parameter");
    const selected = program.borrowStability.borrowedWriteFor(assignment);
    assert.equal(selected !== undefined, true);
    const targetFact = program.facts.getFact(selected.target, rustTargetOperationFactKey);
    assert.equal(targetFact.storage, "structural-object", "the structural mutation bank targets its actual owner");
    const storageFact = program.facts.getFact(selected.field.declaration, rustCapturedFieldStorageFactKey);
    assert.equal(storageFact !== undefined, true);
    const mutations = [
      [selected.receiver, rustTargetOperationFactKey, { ...selected.field, valueSemantics: { kind: "accessor", writable: true } }],
      [selected.receiver, rustTargetOperationFactKey, { ...selected.field, dispatch: { read: "read", write: "write", ownerCarrier: selected.field.receiverCarrier } }],
      [selected.receiver, rustTargetOperationFactKey, { ...selected.field, storageIndex: -1 }],
      [selected.target, rustTargetOperationFactKey, { ...targetFact, accessMode: "read-write" }],
      [selected.field.declaration, rustCapturedFieldStorageFactKey, undefined],
      [selected.field.declaration, rustCapturedFieldStorageFactKey, { ...storageFact, storage: { ...storageFact.storage, kind: "cell" } }],
      [selected.value, rustContextualValueConversionFactKey, { sourceCarrier: targetFact.resultCarrier, targetCarrier: targetFact.resultCarrier,
        conversion: { kind: "native-representation", source: targetFact.resultCarrier, target: targetFact.resultCarrier } }],
    ];
    for (const [index, [subject, key, replacement]] of mutations.entries()) {
      const facts = { ...program.facts, getFact(node, selectedKey) {
        return node === subject && selectedKey === key ? replacement : program.facts.getFact(node, selectedKey);
      } };
      const result = analyzeRustBorrowStability(analysisInput(program, facts));
      assert.equal(result.kind, "resolved", "mutation " + index);
      assert.equal(result.plan.borrowedWriteFor(assignment) === undefined, true, "mutation " + index);
    }
    const binding = program.facts.getFact(selected.value, rustSourceBindingFactKey);
    assert.equal(binding !== undefined, true);
    const locationFacts = { ...program.facts, getFact(node, key) {
      return node === binding.sourceDeclaration && key === rustBindingStorageFactKey
        ? { storage: "location", valueCarrier: targetFact.resultCarrier } : program.facts.getFact(node, key);
    } };
    assert.equal(analyzeRustBorrowStability(analysisInput(program, locationFacts)).plan.borrowedWriteFor(assignment) === undefined, true);
    const unknownCopy = { ...program.facts, getRuntimeCarrierFact(node) {
      return node === selected.value ? { carrier: { kind: "target-named", id: "external.CustomClone" } }
        : program.facts.getRuntimeCarrierFact(node);
    } };
    assert.equal(analyzeRustBorrowStability(analysisInput(program, unknownCopy)).plan.borrowedWriteFor(assignment) === undefined, true);
    for (const storage of ["bound", "property"]) {
      const input = analysisInput(program);
      const shapeField = input.structuralShapes.field(targetFact.receiverCarrier, targetFact.storageIndex);
      input.structuralShapes = { ...input.structuralShapes, field(carrier, index) {
        return carrier === targetFact.receiverCarrier && index === targetFact.storageIndex
          ? { ...shapeField, storage } : program.structuralShapes.field(carrier, index);
      } };
      assert.equal(analyzeRustBorrowStability(input).plan.borrowedWriteFor(assignment) === undefined, true, storage);
    }
    for (const replacement of [
      { readonly: true }, { method: true }, { nativeLayout: {} },
    ]) {
      const input = analysisInput(program);
      const shapeField = input.structuralShapes.field(targetFact.receiverCarrier, targetFact.storageIndex);
      input.structuralShapes = { ...input.structuralShapes, field(carrier, index) {
        return carrier === targetFact.receiverCarrier && index === targetFact.storageIndex
          ? { ...shapeField, ...replacement } : program.structuralShapes.field(carrier, index);
      } };
      assert.equal(analyzeRustBorrowStability(input).plan.borrowedWriteFor(assignment) === undefined, true, Object.keys(replacement)[0]);
    }
    const dispatched = analysisInput(program);
    dispatched.structuralShapes = { ...dispatched.structuralShapes, definitionForCarrier(carrier) {
      const shape = program.structuralShapes.definitionForCarrier(carrier);
      return carrier === targetFact.receiverCarrier ? { ...shape, dispatchName: "selected_dispatch" } : shape;
    } };
    assert.equal(analyzeRustBorrowStability(dispatched).plan.borrowedWriteFor(assignment) === undefined,
      true, "structural dispatch can conceal a bound state");
  });
}

test("only the exact finalized pure scalar provider ABI can extend a captured-field borrow", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": borrowedScalarFieldWritesSource + `
export function provider(holder: Value, value: number): void { holder.point.x = Math.abs(value); }
` } });
  const assignment = functionAssignment(program, "provider");
  const value = BinaryExpression_Right(program.source.ast, assignment);
  const operation = program.facts.getFact(value, rustTargetOperationFactKey);
  assert.equal(operation?.kind, "provider-operation");
  assert.equal(program.borrowStability.borrowedWriteFor(assignment) !== undefined, true);
  for (const [index, abi] of [
    { ...operation.abi, effects: { ...operation.abi.effects, evaluation: "observable" } },
    { ...operation.abi, effects: { ...operation.abi.effects, safety: "requires-unsafe" } },
    { ...operation.abi, effects: { ...operation.abi.effects, invocation: "fallible" } },
    { ...operation.abi, sourceArguments: [] },
    { ...operation.abi, sourceArguments: operation.abi.sourceArguments.map(argument => ({ ...argument, form: "spread-sequence" })) },
  ].entries()) {
    const facts = { ...program.facts, getFact(node, key) {
      return node === value && key === rustTargetOperationFactKey ? { ...operation, abi } : program.facts.getFact(node, key);
    } };
    assert.equal(analyzeRustBorrowStability(analysisInput(program, facts)).plan.borrowedWriteFor(assignment) === undefined, true, String(index));
  }
});

test("provider property and indexed reads use their own AST input shape without call argument reconstruction", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": borrowedScalarFieldWritesSource + `
export function constant(holder: Value): void { holder.point.x = Math.PI; }
export function observed(holder: Value, text: string): void { holder.point.x = text.length; }
export function indexed(values: string[]): number { return values[0].length; }
` } });
  const constant = functionAssignment(program, "constant");
  assert.equal(program.borrowStability.borrowedWriteFor(constant) !== undefined, true, "exact pure constant ABI");
  const observed = functionAssignment(program, "observed");
  assert.equal(program.borrowStability.borrowedWriteFor(observed) === undefined, true,
    "an owned string observation is not an unprojected primitive Copy input");
});

test("borrow stability budgets are finite, bounded and reject cycles without AST diagnostics", () => {
  const root = { children: [{ children: [] }] };
  const input = {
    sourceFiles: [root], ast: { is: { IsBinaryExpression: () => false },
      forEachChild: (node, visit) => node.children.forEach(visit) },
    facts: { getRuntimeCarrierFact: () => undefined, getFact: () => undefined },
  };
  assert.equal(analyzeRustBorrowStability(input, 1).kind, "rejected");
  assert.equal(analyzeRustBorrowStability(input, 2).kind, "resolved");
  for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 4_194_305, Number.MAX_SAFE_INTEGER]) {
    const result = analyzeRustBorrowStability(input, limit);
    assert.equal(result.kind, "rejected", String(limit));
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].sourceNode === undefined, true);
    assert.equal(result.diagnostics[0].message.length < 160, true);
  }
  root.children.push(root);
  assert.equal(analyzeRustBorrowStability(input, 8).kind, "rejected", "cycle");
});

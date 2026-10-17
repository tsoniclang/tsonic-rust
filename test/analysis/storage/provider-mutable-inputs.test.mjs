import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, acmeVectorsPackage } from "../../helpers/rust-session.mjs";
import { selectRustProviderMutableInputs } from "../../../dist/analysis/storage/provider-mutable-inputs.js";
import { analyzeRustNativePlaces } from "../../../dist/analysis/ownership/native-places.js";


function selectMutableInputs(node, operation, contextUse, input) {
  const places = analyzeRustNativePlaces(input);
  return places.kind === "rejected" ? { kind: "rejected", node: places.diagnostics[0].sourceNode,
    reason: places.diagnostics[0].message } : selectRustProviderMutableInputs(node, operation, contextUse,
      { ...input, nativePlaces: places.places });
}

function fixture() {
  const { program } = analyzeRust({ packages: [acmeVectorsPackage()], files: { "index.ts": `
import { Vector, mutateBoth } from "@acme/vectors";
class Pair { constructor(public left: Vector, public right: Vector) {} }
function fresh(): Vector { return new Vector(1, 2); }
export function main(): void {
  let left = new Vector(1, 2); let right = new Vector(3, 4);
  mutateBoth(left, right);
  let pair = new Pair(new Vector(5, 6), new Vector(7, 8));
  mutateBoth(pair.left, pair.right);
  mutateBoth(fresh(), fresh());
}` } });
  const ast = program.source.ast;
  const calls = program.providerMutableInputs.operations.filter(row => row.selection.kind === "proved" &&
    row.selection.inputs.length === 2).map(row => ({ node: row.node, proof: row.selection }));
  assert.equal(calls.length, 3, "independent variables, disjoint fields and independently owned temporary values");
  return { program, input: { ast, records: program.records, navigation: program.sourceNavigation,
    statementCompletions: program.statementCompletions, physicalEmissionContexts: program.physicalEmissionContexts,
    definitions: program.typeDefinitions, genericCallables: program.callableValues.generic,
    genericRequirements: program.declarationGenericRequirements,
    projectTypes: program.projectTypes, objectRepresentations: program.objectRepresentations }, calls };
}

test("native mutable admission is sealed and retains exact operation and source-input ownership", () => {
  const current = fixture();
  for (const { node, proof } of current.calls) {
    assert.equal(Object.isFrozen(proof) && Object.isFrozen(proof.inputs), true);
    assert.equal(proof.operation === current.program.records.targetOperation.get(node), true);
    assert.equal(proof.context.use === proof.contextUse, true, "original physical context retained");
    assert.equal(current.program.providerMutableInputs.forOperation(node, proof.operation, proof.contextUse) === proof,
      true, "one exact three-key lookup");
    assert.equal(selectMutableInputs(node, proof.operation, proof.contextUse, current.input).kind, "proved");
    assert.equal(selectMutableInputs(node, { ...proof.operation }, proof.contextUse, current.input).kind, "rejected",
      "foreign operation evidence cannot carry a valid admission");
    assert.equal(current.program.providerMutableInputs.forOperation(node, proof.operation, { ...proof.contextUse }) === undefined,
      true, "an equal-looking context cannot substitute for the original use object");
    for (const selected of proof.inputs) {
      assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.place) && Object.isFrozen(selected.place.storage), true,
        "place admission is immutable");
      assert.equal(selected.place.operand === selected.operand && selected.operand.context === proof.context, true,
        "a physical place keeps its actual input use and context");
    }
  }
  const first = current.calls[0];
  assert.equal(current.program.providerMutableInputs.forOperation({}, first.proof.operation, first.proof.contextUse) === undefined, true);
});

test("missing direct roots and selected field paths cannot publish mutable admission", () => {
  const current = fixture();
  const missingRoot = { ...current.input, navigation: { ...current.input.navigation,
    sourceReferenceFor: () => undefined } };
  const variable = current.calls[0];
  assert.equal(selectMutableInputs(variable.node, variable.proof.operation, variable.proof.contextUse, missingRoot).kind,
    "rejected", "direct storage cannot lose its exact root");
  const field = current.calls[1];
  const changed = { ...current.input, ast: { ...current.input.ast,
    kindName: node => node === field.proof.inputs[1].node ? "KindElementAccessExpression"
      : current.input.ast.kindName(node) } };
  const selected = selectMutableInputs(field.node, field.proof.operation, field.proof.contextUse, changed);
  assert.equal(selected.kind, "rejected");
  assert.equal(/projection path/.test(selected.reason), true, "a root alone cannot authorize an unproved field path");
});

test("an exact shared source root cannot be fabricated into two disjoint mutable inputs", () => {
  const current = fixture();
  const { node, proof } = current.calls[0];
  const first = current.input.navigation.sourceReferenceFor(proof.inputs[0].node);
  const changed = { ...current.input, navigation: { ...current.input.navigation,
    sourceReferenceFor: reference => reference === proof.inputs[1].node ? first
      : current.input.navigation.sourceReferenceFor(reference) } };
  const selected = selectMutableInputs(node, proof.operation, proof.contextUse, changed);
  assert.equal(selected.kind, "rejected");
  assert.equal(/overlapping/.test(selected.reason), true, "same root, same projection rejected");
});

test("repeated native mutable slots and missing exact argument syntax fail before emission", () => {
  const current = fixture();
  const { node, proof } = current.calls[0];
  const repeated = { ...proof.operation, abi: { ...proof.operation.abi,
    targetArguments: [proof.operation.abi.targetArguments[0], proof.operation.abi.targetArguments[0]] } };
  const repeatedInput = { ...current.input, records: createRustRecordFixture({
targetOperation: { get: (subject) => subject === node ? repeated
    : current.input.records.targetOperation.get(subject) }}, current.input.records) };
  const selected = selectMutableInputs(node, repeated, proof.contextUse, repeatedInput);
  assert.equal(selected.kind, "rejected");
  assert.equal(/multiple mutable inputs/.test(selected.reason), true);
  const occurrence = current.input.physicalEmissionContexts.sourceFor(node, proof.operation);
  const missing = selectMutableInputs(node, proof.operation, proof.contextUse, { ...current.input,
    physicalEmissionContexts: { ...current.input.physicalEmissionContexts,
      sourceFor: (subject, operation) => subject === node && operation === proof.operation
        ? { ...occurrence, inputs: [] } : current.input.physicalEmissionContexts.sourceFor(subject, operation) } });
  assert.equal(missing.kind, "rejected");
  assert.equal(/original source slot/.test(missing.reason), true);
});

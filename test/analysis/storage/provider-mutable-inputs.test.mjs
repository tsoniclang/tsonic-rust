import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, acmeVectorsPackage } from "../../helpers/rust-session.mjs";
import { selectRustProviderMutableInputs } from "../../../dist/analysis/storage/provider-mutable-inputs.js";


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
  const calls = [];
  const visit = node => {
    const proof = program.providerMutableInputs.forOperation(node);
    if (proof?.kind === "proved" && proof.inputs.length === 2) calls.push({ node, proof });
    ast.forEachChild(node, visit);
  };
  for (const file of program.sourceFiles) visit(file);
  assert.equal(calls.length, 3, "independent variables, disjoint fields and independently owned temporary values");
  return { program, input: { ast, records: program.records, navigation: program.sourceNavigation,
    statementCompletions: program.statementCompletions }, calls };
}

test("native mutable admission is sealed and retains exact operation and source-input ownership", () => {
  const current = fixture();
  for (const { node, proof } of current.calls) {
    assert.equal(Object.isFrozen(proof) && Object.isFrozen(proof.inputs), true);
    assert.equal(proof.operation === current.program.records.targetOperation.get(node), true);
    assert.equal(selectRustProviderMutableInputs(node, proof.operation, current.input).kind, "proved");
    assert.equal(selectRustProviderMutableInputs(node, { ...proof.operation }, current.input).kind, "rejected",
      "foreign operation evidence cannot carry a valid admission");
  }
  assert.equal(current.program.providerMutableInputs.forOperation({}) === undefined, true);
});

test("missing direct roots and selected field paths cannot publish mutable admission", () => {
  const current = fixture();
  const missingRoot = { ...current.input, navigation: { ...current.input.navigation,
    sourceReferenceFor: () => undefined } };
  const variable = current.calls[0];
  assert.equal(selectRustProviderMutableInputs(variable.node, variable.proof.operation, missingRoot).kind,
    "rejected", "direct storage cannot lose its exact root");
  const field = current.calls[1];
  const changed = { ...current.input, ast: { ...current.input.ast,
    kindName: node => node === field.proof.inputs[1].node ? "KindElementAccessExpression"
      : current.input.ast.kindName(node) } };
  const selected = selectRustProviderMutableInputs(field.node, field.proof.operation, changed);
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
  const selected = selectRustProviderMutableInputs(node, proof.operation, changed);
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
  const selected = selectRustProviderMutableInputs(node, repeated, repeatedInput);
  assert.equal(selected.kind, "rejected");
  assert.equal(/multiple mutable inputs/.test(selected.reason), true);
  const missing = selectRustProviderMutableInputs(node, proof.operation, { ...current.input,
    ast: { ...current.input.ast, arguments: () => [] } });
  assert.equal(missing.kind, "rejected");
  assert.equal(/source operand/.test(missing.reason), true);
});

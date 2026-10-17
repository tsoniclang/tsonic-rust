import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, acmeVectorsPackage } from "../../helpers/rust-session.mjs";
import { analyzeRustNativePlaces } from "../../../dist/analysis/ownership/native-places.js";

function fixture() {
  const { program } = analyzeRust({ packages: [acmeVectorsPackage()], files: { "index.ts": `
import { Vector, mutateBoth } from "@acme/vectors";
class Pair { constructor(public left: Vector, public right: Vector) {} }
function fresh(): Vector { return new Vector(1, 2); }
export function main(): void {
  const left = new Vector(1, 2); const right = new Vector(3, 4);
  mutateBoth(left, right);
  const pair = new Pair(new Vector(5, 6), new Vector(7, 8));
  mutateBoth(pair.left, pair.right);
  mutateBoth(fresh(), fresh());
}` } });
  const input = { ast: program.source.ast, records: program.records, navigation: program.sourceNavigation,
    definitions: program.typeDefinitions, genericCallables: program.callableValues.generic,
    genericRequirements: program.declarationGenericRequirements, projectTypes: program.projectTypes,
    objectRepresentations: program.objectRepresentations, statementCompletions: program.statementCompletions,
    physicalEmissionContexts: program.physicalEmissionContexts };
  return { program, input };
}

test("native places retain the original actual input, source slot and physical context", () => {
  const { input } = fixture();
  const selected = analyzeRustNativePlaces(input);
  assert.equal(selected.kind, "resolved", "every selected input has physical place evidence");
  const operands = input.physicalEmissionContexts.operands.filter(row => row.origin.kind === "call-input");
  assert.equal(selected.places.size, operands.length, "one place per original input use, no source-node collapse");
  for (const operand of operands) {
    const place = selected.places.get(operand.use);
    assert.equal(place !== undefined, true, "the actual physical input is admitted");
    assert.equal(place.operand === operand && place.place.operand === operand, true, "no copied input-use evidence");
    assert.equal(place.input === operand.origin.input, true, "the finalized ABI input stays canonical");
    assert.equal(place.place.carrier === operand.carrier, true, "no logical or declaration-local carrier substitution");
    const occurrence = input.physicalEmissionContexts.sourceFor(operand.origin.operationNode, operand.origin.operation);
    assert.equal(occurrence.inputs.some(row => row.input === place.input && row.slot === place.slot), true,
      "source and target input correlation is unchanged");
    assert.equal(Object.isFrozen(place) && Object.isFrozen(place.place) && Object.isFrozen(place.place.storage), true,
      "only immutable selected data is published");
  }
  const temporaryInputs = [...selected.places.values()].filter(row => row.input.mode === "mut-ref" &&
    input.ast.is.IsCallExpression(row.node));
  assert.equal(temporaryInputs.length, 2, "both independently owned call results retain their actual uses");
  for (const selectedInput of temporaryInputs) {
    assert.equal(selectedInput.place.storage.kind, "owned", "an owned result is positively classified");
    assert.equal(["copy", "move"].includes(selectedInput.place.storage.read.kind), true,
      "native owned values use their selected Copy or transfer and require no invented Clone");
  }
});

test("native input places refuse forged input-use and source-slot evidence", () => {
  const { input } = fixture();
  const first = input.physicalEmissionContexts.operands.find(row => row.origin.kind === "call-input");
  assert.equal(first !== undefined, true, "a real native input exists");
  const contexts = input.physicalEmissionContexts;
  const variants = [
    { ...contexts, operandFor: use => use === first.use ? { ...first } : contexts.operandFor(use) },
    { ...contexts, contextFor: use => use === first.context.use ? { ...first.context } : contexts.contextFor(use) },
    { ...contexts, sourceFor: (node, operation) => node === first.origin.operationNode && operation === first.origin.operation
      ? { ...contexts.sourceFor(node, operation), inputs: [] } : contexts.sourceFor(node, operation) },
    { ...contexts, carrierFor: (use, carrier) => use === first.use ? { kind: "unit" } : contexts.carrierFor(use, carrier) },
    { ...contexts, operands: [...contexts.operands, first] },
  ];
  for (const [index, physicalEmissionContexts] of variants.entries()) {
    const selected = analyzeRustNativePlaces({ ...input, physicalEmissionContexts });
    assert.equal(selected.kind, "rejected", `corrupt physical premise ${index}`);
    assert.equal(selected.diagnostics.every(row => row.code === "RUST_NATIVE_INPUT_PLACE_NOT_CLOSED"), true,
      `one pre-seal owner diagnoses premise ${index}`);
    assert.equal("places" in selected, false, `no partial proof escapes for premise ${index}`);
  }
});

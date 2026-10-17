import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, acmeVectorsPackage } from "../../helpers/rust-session.mjs";
import { analyzeRustNativeInputs } from "../../../dist/analysis/ownership/native-places.js";

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
    physicalEmissionContexts: program.physicalEmissionContexts, ownership: program.ownership };
  return { program, input };
}

test("native input formation retains the original value read or required place, source slot and physical context", () => {
  const { input } = fixture();
  const selected = analyzeRustNativeInputs(input);
  assert.equal(selected.kind, "resolved", "every selected input consumes its actual native formation");
  const operands = input.physicalEmissionContexts.operands.filter(row => row.origin.kind === "call-input");
  assert.equal(selected.inputs.size, operands.length, "one formation per original input use, no source-node collapse");
  for (const operand of operands) {
    const place = selected.inputs.get(operand.use);
    assert.equal(place !== undefined, true, "the actual physical input is admitted");
    assert.equal(place.operand === operand, true, "no copied input-use evidence");
    assert.equal(place.input === operand.origin.input, true, "the finalized ABI input stays canonical");
    const occurrence = input.physicalEmissionContexts.sourceFor(operand.origin.operationNode, operand.origin.operation);
    assert.equal(occurrence.inputs.some(row => row.input === place.input && row.slot === place.slot), true,
      "source and target input correlation is unchanged");
    assert.equal(Object.isFrozen(place), true, "only immutable selected data is published");
    if (place.kind === "value") {
      assert.equal(place.read === input.ownership.reads.get(place.node), true, "a value consumes the already-admitted read");
      assert.equal("place" in place, false, "passing a native value does not assert an addressable place");
    } else {
      assert.equal(place.place.operand === operand && place.place.carrier === operand.carrier, true,
        "a borrow retains its exact physical place and carrier, not a logical substitution");
      assert.equal(Object.isFrozen(place.place) && Object.isFrozen(place.place.storage), true, "selected storage is immutable");
    }
  }
  const temporaryInputs = [...selected.inputs.values()].filter(row => row.input.mode === "mut-ref" &&
    input.ast.is.IsCallExpression(row.node));
  assert.equal(temporaryInputs.length, 2, "both independently owned call results retain their actual uses");
  for (const selectedInput of temporaryInputs) {
    assert.equal(selectedInput.kind, "place", "a real mutable borrow has place evidence");
    assert.equal(selectedInput.place.storage.kind, "owned", "an owned result is positively classified");
    assert.equal(["copy", "move"].includes(selectedInput.place.storage.read.kind), true,
      "native owned values use their selected Copy or transfer and require no invented Clone");
  }
});

test("all admitted value-read forms remain native values rather than requiring a new addressable storage form", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
class C {
  static value = 1;
  constructor(public field = 2) {}
  get selected(): number { return this.field; }
}
export function read(value: C, structural: { field: number }): number {
  return Math.abs(C.value) + Math.abs(value.selected) + Math.abs(structural.field) + Math.abs(value.field);
}` } });
  const values = [...program.ownership.nativeInputs.values()].filter(row => row.kind === "value" &&
    ["source-static-field", "source-accessor", "source-field"].includes(program.records.targetOperation.get(row.node)?.kind));
  assert.equal(values.length >= 4, true, "the actual static, getter, structural and class stored reads all reach native inputs");
  for (const value of values) {
    assert.equal(value.read === program.ownership.reads.get(value.node), true, "the sole admitted read is reused");
    assert.equal("place" in value, false, "an ordinary value input requires no invented storage projection");
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
    const selected = analyzeRustNativeInputs({ ...input, physicalEmissionContexts });
    assert.equal(selected.kind, "rejected", `corrupt physical premise ${index}`);
    assert.equal(selected.diagnostics.every(row => row.code === "RUST_NATIVE_INPUT_PLACE_NOT_CLOSED"), true,
      `one pre-seal owner diagnoses premise ${index}`);
    assert.equal("inputs" in selected, false, `no partial proof escapes for premise ${index}`);
  }
});

test("native value admission consumes its proven read and never repairs a missing read with a temporary", () => {
  const { input } = fixture();
  const value = input.physicalEmissionContexts.operands.find(row => row.origin.kind === "call-input" &&
    row.origin.input.mode === "value" && row.origin.input.conversion.kind === "identity");
  assert.equal(value !== undefined, true, "a real native by-value input is present");
  const reads = new Map(input.ownership.reads);
  reads.delete(value.node);
  const selected = analyzeRustNativeInputs({ ...input, ownership: { reads } });
  assert.equal(selected.kind, "rejected", "an unavailable native read stays unavailable");
  assert.equal(selected.diagnostics.some(row => row.sourceNode === value.node &&
    row.message === "A native value input requires its already-admitted source read and exact actual physical carrier."), true,
    "the exact source read owner is required, not an AST-form temporary fallback");
  assert.equal("inputs" in selected, false, "no partially repaired ownership product escapes");
});

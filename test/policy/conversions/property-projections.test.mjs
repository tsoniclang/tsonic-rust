import assert from "node:assert/strict";
import test from "node:test";
import { rustValueConversionContract, rustValueConversionIdentity } from "../../../dist/target-model/conversions/contracts.js";
import { substituteRustValueConversion } from "../../../dist/target-model/conversions/substitution.js";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { rustSourcePrimitiveTargetType, rustJsValueTargetType, rustOptionTargetType } from "../../../dist/target-model/types/index.js";
import { rustStructuralObjectTargetType } from "../../../dist/target-model/types/carriers/source-types.js";
import { planRustPropertyValueProjection } from "../../../dist/backend/planner/expressions/property-value-projection.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../helpers/fake-compile-input.mjs";

function fixture() {
  const scalar = rustSourcePrimitiveTargetType("uint64");
  const source = rustStructuralObjectTargetType("/src/options.ts", [
    { sourceName: "count", presence: "required", readonly: true, type: scalar },
  ]);
  const field = { sourceName: "count", sourceCarrier: scalar, presence: "required",
    conversion: selectRustSourceValueConversion(scalar, rustJsValueTargetType()) };
  return { scalar, source, field, conversion: { kind: "js-value-from-properties", source, fields: [field] } };
}

test("exact selected property conversion is borrowed, closed and independently validated", () => {
  const input = fixture();
  const contract = rustValueConversionContract(input.conversion);
  assert.equal(contract?.sourceMode, "ref");
  assert.equal(contract.fallible, false);
  assert.equal(rustTargetTypeRefEquals(contract.fields[0].conversion.source, input.scalar), true, "exact uint64 carrier");
  assert.notEqual(rustValueConversionIdentity(input.conversion), rustValueConversionIdentity({ ...input.conversion, fields: [] }));
  for (const mutate of [
    value => ({ ...value, unexpected: true }),
    value => ({ ...value, source: { kind: "invalid" } }),
    value => ({ ...value, fields: [value.fields[0], value.fields[0]] }),
    value => ({ ...value, fields: [{ ...value.fields[0], sourceName: "" }] }),
    value => ({ ...value, fields: [{ ...value.fields[0], sourceCarrier: rustSourcePrimitiveTargetType("int64") }] }),
    value => ({ ...value, fields: [{ ...value.fields[0], presence: "invalid" }] }),
    value => ({ ...value, fields: [{ ...value.fields[0], storageIndex: 0 }] }),
    value => ({ ...value, fields: Array(1) }),
  ]) assert.equal(rustValueConversionContract(mutate(input.conversion)) === undefined, true,
    "malformed property demand must not become a valid native conversion");
  let reads = 0;
  const accessor = { ...input.field };
  Object.defineProperty(accessor, "sourceCarrier", { enumerable: true, get() { reads += 1; return input.scalar; } });
  assert.equal(rustValueConversionContract({ ...input.conversion, fields: [accessor] }) === undefined, true);
  assert.equal(reads, 0, "metadata validation does not execute accessors");
});

test("optional property projection inherits native borrowing and validates nested carrier substitution", () => {
  const input = fixture();
  const optional = { kind: "closed-value-from-option", source: rustOptionTargetType(input.source),
    element: input.source, elementConversion: input.conversion };
  assert.equal(rustValueConversionContract(optional)?.sourceMode, "ref");
  const parameter = { kind: "type-parameter", identity: "T", name: "T" };
  const generic = { ...input.conversion, source: rustStructuralObjectTargetType("/src/options.ts", [
    { sourceName: "count", presence: "required", readonly: true, type: input.scalar },
    { sourceName: "unselected", presence: "required", readonly: true, type: parameter },
  ]) };
  const mapped = substituteRustValueConversion(generic, new Map([["T", rustSourcePrimitiveTargetType("bool")]]));
  assert.equal(rustValueConversionContract(mapped)?.sourceMode, "ref");
  assert.equal(mapped.source.value.fields[1].type.name, "bool");
  assert.equal(mapped.fields.length, 1, "substitution does not manufacture unrelated reads");
  assert.equal(Object.isFrozen(mapped) && Object.isFrozen(mapped.fields) && Object.isFrozen(mapped.fields[0]), true);
});

test("property planning rejects absent or carrier-conflicting sealed native reads", () => {
  const input = fixture();
  const contract = rustValueConversionContract(input.conversion);
  const node = fakeStatement({ kindName: "KindIdentifier", pos: 0, end: 5 });
  const sourceFile = fakeSourceFile({ text: "input", statements: [node] });
  const read = { kind: "source-field", receiverCarrier: input.source, resultCarrier: input.scalar,
    storage: "structural-object", storageIndex: 0, valueSemantics: { kind: "stored" } };
  const projection = { source: input.source, conversion: input.conversion, reads: [read] };
  const fact = { conversion: input.conversion, cases: [projection] };
  for (const selected of [
    undefined,
    { ...fact, cases: [] },
    { ...fact, cases: [projection, projection] },
    { ...fact, cases: [{ ...projection, reads: [] }] },
    { ...fact, cases: [{ ...projection, reads: [{ ...read, resultCarrier: rustSourcePrimitiveTargetType("int64") }] }] },
    { ...fact, cases: [{ ...projection, reads: [{ ...read, receiverCarrier: input.scalar }] }] },
  ]) {
    const context = { input: { program: { source: { ast: fakeAstReader([sourceFile]) }, facts: { getFact: () => selected } } }, sourceFile,
      syntheticNames: { reserved: new Set(), nextSuffixByBase: new Map() }, diagnostics: [] };
    assert.equal(planRustPropertyValueProjection(contract, { kind: "path", path: "input" }, context, node,
      () => assert.fail("conflicting native reads must reject before conversion planning")) === undefined, true);
    assert.equal(context.diagnostics.length, 1, "conflicting evidence rejects before native construction");
  }
});

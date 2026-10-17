import assert from "node:assert/strict";
import test from "node:test";
import { rustFinalContractSupportsRequirements } from "../../../dist/analysis/declarations/generic-carrier-requirements.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

const parameter = Object.freeze({ kind: "type-parameter", identity: "source:Value", name: "Value" });
const number = Object.freeze({ kind: "source-primitive", name: "float64" });
const families = Object.freeze({ implementation: () => undefined });
const bound = requirements => Object.freeze({ identity: parameter.identity, name: parameter.name, requirements });
const contract = fields => Object.freeze({ declaration: Object.freeze({}), typeParameters: [], capturedTypeParameters: [],
  nativeInputs: [], associatedTypes: [], projectProjections: [], optionalStorage: [], ...fields });
const supports = (selected, carrier, registry = families) =>
  rustFinalContractSupportsRequirements(selected, carrier, ["static"], registry, emptyRustTypeDefinitions, undefined).kind === "supported";

test("final static support reads an existing bound and never infers a missing or unknown one", () => {
  const missing = contract({ typeParameters: [bound([])] });
  const present = contract({ typeParameters: [bound(["clone", "static"])] });
  assert.equal(supports(missing, parameter), false, "known generic without static remains unproven");
  assert.equal(supports(present, parameter), true, "actual final static bound is authoritative");
  assert.equal(supports(contract({}), parameter), false, "unknown free generic is not static");
  assert.equal(supports(contract({}), number), true, "native scalar has no generic retention obligation");
  assert.equal(missing.typeParameters[0].requirements.length, 0, "validation does not mutate the final contract");
});

test("final static support includes captured, native-input and optional-storage contracts", () => {
  for (const family of ["capturedTypeParameters", "nativeInputs"]) {
    assert.equal(supports(contract({ [family]: [bound(["static"])] }), parameter), true, `${family} static evidence`);
    assert.equal(supports(contract({ [family]: [bound(["clone"])] }), parameter), false, `${family} clone is not static`);
  }
  assert.equal(supports(contract({ optionalStorage: [{ carrier: parameter, captured: false, requirements: ["static"] }] }), parameter),
    true, "actual optional-storage carrier static evidence");
});

test("a generic static bound does not turn an actual borrowed reference static", () => {
  const selected = contract({ typeParameters: [bound(["static"])] });
  const borrowed = { kind: "reference", mutable: false, lifetime: { kind: "parameter", name: "input", identity: "source:input" }, referent: parameter };
  assert.equal(supports(selected, borrowed), false, "actual non-static borrow is preserved");
  assert.equal(supports(selected, { ...borrowed, lifetime: { kind: "static" } }), true, "actual static reference plus pointee evidence");
});

test("associated static evidence matches the exact selected projection", () => {
  const trait = { kind: "trait-ref", id: "fixture:Output", path: "Output", genericArguments: [], associatedConstraints: [] };
  const projection = { kind: "associated-type", owner: parameter, trait, name: "Item", genericArguments: [] };
  const selected = contract({ nativeInputs: [bound([])], associatedTypes: [{ carrier: projection, output: number, requirements: ["static"] }] });
  assert.equal(supports(selected, projection), true, "exact associated static bound");
  assert.equal(supports(selected, { ...projection, name: "Other" }), false, "different associated projection has no evidence");
  assert.equal(supports(contract({ associatedTypes: selected.associatedTypes }), projection), false, "unknown native owner is not admitted");
  const exactFamily = { implementation: (selectedTrait, owner) => rustTargetTypeRefEquals(selectedTrait, trait) &&
    rustTargetTypeRefEquals(owner, parameter) ? { output: number } : undefined };
  assert.equal(supports(contract({}), projection, exactFamily), true, "actual normalized family output is closed native storage");
});

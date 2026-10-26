import assert from "node:assert/strict";
import test from "node:test";
import { createRustCallableRequirementVisitor } from "../../../dist/analysis/declarations/generic-callable-requirement-uses.js";
import { classifyCarrierRequirements } from "../../../dist/analysis/declarations/generic-carrier-requirements.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustInfallibleTargetId } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustStringTargetType } from "../../../dist/target-model/types/index.js";

const invocationLifetime = { kind: "parameter", identity: "method:invocation", name: "invoke" };
const signature = rustCallableTargetType([], rustStringTargetType(), invocationLifetime,
  { kind: "target-named", id: rustInfallibleTargetId });
const sourceCarrier = { kind: "tuple", elements: [] };
const receiverCarrier = { kind: "tuple", elements: [signature] };

function requirementUses(selected) {
  const declaration = {};
  const missing = Object.freeze({ get: () => undefined });
  const records = Object.fromEntries([
    "runtimeCarrier", "bindingProjection", "sourceCallableReturn", "sourceParameterAbi", "targetOperation",
    "projectDowncast", "flowReadProjection", "bindingStorage", "typedLocationPlan", "genericNumericOperands",
    "awaitValue", "sourceCallableValue", "closureCapture", "contextualValueConversion", "yield",
  ].map(name => [name, missing]));
  records.objectReferenceView = { get: node => node === declaration ? {
    kind: "structural", sourceCarrier, fields: [{ source: {
      storage: "structural-object", receiverCarrier, storageIndex: 0, resultCarrier: signature,
    } }],
  } : undefined };
  const uses = [];
  const visit = createRustCallableRequirementVisitor({
    declaration, records,
    ast: { kindName: () => "KindSynthetic", forEachChild: () => {} },
    structuralShapes: { field: (carrier, index) => {
      assert.equal(carrier === receiverCarrier && index === 0, true, "the exact receiver and slot select storage");
      return selected;
    } },
  }, {
    declared: new Set(), dependencies: new Set(), definition: undefined,
    addUse: (node, carrier, requirements) => {
      assert.equal(node === declaration, true, "requirements remain attached to their checked view");
      uses.push({ carrier, requirements });
      return undefined;
    },
  });
  return { reason: visit(declaration), uses };
}

test("structural view requirements select the completed field storage and retain both obligations", () => {
  const context = { kind: "tuple", elements: [rustStringTargetType()] };
  const stored = rustCallableTargetType([], rustStringTargetType(), { kind: "static" },
    { kind: "target-named", id: rustInfallibleTargetId });
  const bound = { kind: "tuple", elements: [stored] };
  for (const [label, selected, expected] of [
    ["fixed context", { carrier: signature, methodPlan: { kind: "fixed", carrier: signature, context } }, context],
    ["stored method", { carrier: signature, methodPlan: { kind: "stored", carrier: stored } }, stored],
    ["bound field", { carrier: signature, boundStorage: { carrier: bound } }, bound],
    ["native field", { carrier: context }, context],
  ]) {
    const result = requirementUses(selected);
    assert.equal(result.reason === undefined, true, `${label}: complete storage is admitted`);
    assert.equal(result.uses.length, 2, `${label}: source and field obligations both remain`);
    assert.equal(result.uses[0].carrier === sourceCarrier, true, `${label}: source retention is preserved`);
    assert.equal(result.uses[1].carrier === expected, true, `${label}: invocation metadata is not stored payload`);
    assert.equal(result.uses.every(use => use.requirements.length === 2 &&
      use.requirements[0] === "clone" && use.requirements[1] === "static"), true,
    `${label}: neither Clone nor static is removed`);
  }
});

test("structural view storage never replaces an actual borrow or missing field with owned evidence", () => {
  const borrowed = { kind: "reference", mutable: false, lifetime: invocationLifetime, referent: rustStringTargetType() };
  const context = { kind: "tuple", elements: [borrowed] };
  const result = requirementUses({ carrier: signature, methodPlan: { kind: "fixed", carrier: signature, context } });
  assert.equal(result.reason === undefined, true, "the exact captured payload reaches its requirement owner");
  assert.equal(result.uses[1].carrier === context, true, "the actual captured borrow is not erased");
  assert.equal(classifyCarrierRequirements(result.uses[1].carrier, ["static"], new Set(), new Map(),
    () => false, emptyRustTypeDefinitions).kind, "unsatisfied", "the actual native lifetime still refuses retention");
  const missing = requirementUses(undefined);
  assert.equal(missing.reason, "An object reference view requires its exact completed native field storage.");
  assert.equal(missing.uses.length, 1, "missing physical storage never falls back to the logical signature");
});

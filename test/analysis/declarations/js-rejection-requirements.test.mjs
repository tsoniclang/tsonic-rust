import assert from "node:assert/strict";
import test from "node:test";
import { classifyCarrierRequirements } from "../../../dist/analysis/declarations/generic-carrier-requirements.js";
import { rustRuntimeErrorTargetType } from "../../../dist/target-model/operations/error-boundary.js";
import { rustJsErrorTargetType, rustProgramErrorTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { rustCarrierSatisfiesTraitRef } from "../../../dist/target-model/types/carriers/traits.js";
import { rustMutableJsErrorTargetType, rustRetainedErrorTargetType, rustSourceErrorTargetType, rustWritableRetainedErrorTargetType, rustWritableSourceErrorTargetType } from "../../../dist/target-model/types/carriers/source-error.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";

const retained = rustRetainedErrorTargetType();
const obligation = { path: "core::convert::Into", genericArguments: [{ kind: "type", type: retained }], associatedConstraints: [] };
const accepts = carrier => classifyCarrierRequirements(carrier, ["js-rejection"], new Set(), new Map(), () => false, emptyRustTypeDefinitions);

test("JS rejection obligations use the exact native Into<RetainedError> contract", () => {
  for (const [label, carrier] of [
    ["JsError", rustJsErrorTargetType()],
    ["runtime TsonicError", rustRuntimeErrorTargetType()],
    ["physical runtime error", rustProgramErrorTargetType({ kind: "physical", domain: "runtime" })],
    ["MutableJsError", rustMutableJsErrorTargetType()],
    ["RetainedError", retained],
    ["WritableRetainedError", rustWritableRetainedErrorTargetType()],
    ["SourceError", rustSourceErrorTargetType()],
    ["WritableSourceError", rustWritableSourceErrorTargetType()],
  ]) {
    assert.equal(rustCarrierSatisfiesTraitRef(carrier, obligation), true, label);
    assert.equal(accepts(carrier), true, label);
  }
});

test("a JS rejection requirement never guesses from an error name or package transport", () => {
  for (const carrier of [
    rustSourcePrimitiveTargetType("int32"),
    { kind: "target-named", id: "foreign.TsonicError" },
    { kind: "target-named", id: "foreign.JsError" },
    rustProgramErrorTargetType(),
    rustProgramErrorTargetType({ kind: "physical", domain: "project", componentId: "source" }),
    { ...retained, genericArguments: [{ kind: "type", type: rustJsErrorTargetType() }] },
  ]) {
    assert.equal(rustCarrierSatisfiesTraitRef(carrier, obligation), false);
    assert.equal(accepts(carrier), false);
  }
  for (const trait of [
    { ...obligation, genericArguments: [] },
    { ...obligation, genericArguments: [...obligation.genericArguments, ...obligation.genericArguments] },
    { ...obligation, genericArguments: [{ kind: "type", type: rustSourcePrimitiveTargetType("int32") }] },
  ]) assert.equal(rustCarrierSatisfiesTraitRef(rustJsErrorTargetType(), trait), false);
});

test("generic JS rejection obligations stay on their exact type and associated binders", () => {
  const parameter = { kind: "type-parameter", identity: "source/Error", name: "Error" };
  const requirements = new Map([[parameter.identity, new Set()]]);
  assert.equal(classifyCarrierRequirements(parameter, ["js-rejection"], new Set([parameter.identity]), requirements,
    () => false, emptyRustTypeDefinitions), true);
  assert.deepEqual([...requirements.get(parameter.identity)], ["js-rejection"]);
  assert.equal(classifyCarrierRequirements(parameter, ["js-rejection"], new Set(), new Map(),
    () => false, emptyRustTypeDefinitions), false);
  const associated = { kind: "associated-type", owner: parameter, name: "Error" };
  assert.equal(classifyCarrierRequirements(associated, ["js-rejection"], new Set(), new Map(),
    (carrier, requirement) => carrier === associated && requirement === "js-rejection", emptyRustTypeDefinitions), true);
  assert.equal(classifyCarrierRequirements(associated, ["js-rejection"], new Set(), new Map(),
    () => false, emptyRustTypeDefinitions), false);
});

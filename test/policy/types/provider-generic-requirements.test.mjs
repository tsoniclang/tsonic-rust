import assert from "node:assert/strict";
import test from "node:test";
import { rustProviderGenericRequirementsAreSatisfied, rustProviderOperationGenericRequirementsAreSelectable } from "../../../dist/policy/types/provider-generic-requirements.js";

test("native invocation obligations are not promoted into ownership or layout evidence", () => {
  const bindings = { types: new Map([["T", { kind: "source-primitive", name: "native-uint" }]]),
    lifetimes: new Map(), consts: new Map() };
  const requirements = [{ name: "T", requirements: [{ kind: "trait", path: "example::SelectedTrait",
    genericArguments: [], associatedConstraints: [] }] }];
  assert.equal(rustProviderOperationGenericRequirementsAreSelectable(requirements, bindings), true);
  assert.equal(rustProviderGenericRequirementsAreSatisfied(requirements, bindings), false);
  assert.equal(rustProviderOperationGenericRequirementsAreSelectable(requirements, { ...bindings, types: new Map() }), false);
  const nonCopy = { ...bindings, types: new Map([["T", { kind: "closure", args: [], result: { kind: "tuple", elements: [] } }]]) };
  assert.equal(rustProviderOperationGenericRequirementsAreSelectable([{ name: "T", requirements: ["copy"] }], nonCopy), false);
});

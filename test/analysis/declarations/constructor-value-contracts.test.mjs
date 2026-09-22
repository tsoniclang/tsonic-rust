import assert from "node:assert/strict";
import test from "node:test";
import { rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustTargetGenericReferences } from "../../../dist/target-model/types/carriers/generic-references.js";
import { substituteRustTargetTypeParameters } from "../../../dist/target-model/types/carriers/substitution.js";
import { inferRustTargetTypeParameterBindings } from "../../../dist/target-model/types/carriers/generic-inference.js";
import { createRustSourceTypeRegistry } from "../../../dist/analysis/project-types/source-type-registry.js";
import { createRustStructuralShapePlan } from "../../../dist/analysis/objects/structural-shape-plan.js";

const parameter = { kind: "type-parameter", name: "Value" };
const number = { kind: "source-primitive", name: "float64" };
const construction = rustCallableTargetType([parameter], parameter);
const carrier = rustStructuralObjectTargetType("/source.ts", [], "reference", construction);

test("constructor-only shapes retain parameters through traversal, substitution and native storage", () => {
  assert.deepEqual(rustTargetGenericReferences(carrier).typeNames, ["Value"]);
  const selected = substituteRustTargetTypeParameters(carrier, new Map([["Value", number]]));
  assert.deepEqual(rustStructuralObjectCarrierValue(selected).construction, rustCallableTargetType([number], number));
  assert.deepEqual(inferRustTargetTypeParameterBindings(carrier, selected, new Set(["Value"])), new Map([["Value", number]]));
  const registry = createRustSourceTypeRegistry();
  const declaration = {};
  const signature = {};
  const shape = { sourceType: {}, storage: "structural-object", carrier, fields: [],
    construction: { declaration, signature, carrier: construction } };
  assert.equal(registry.registerStructuralObject(shape), true);
  const plan = createRustStructuralShapePlan(registry.structuralObjects(), [], () => "source", []);
  assert.deepEqual(plan.definitions[0].genericParameters, [{ kind: "type", name: "Value" }]);
  assert.deepEqual(plan.definitions[0].construction.carrier, construction);
  assert.ok(Object.isFrozen(plan.definitions[0].construction));
});

test("constructor carrier validation rejects malformed callables and competing value representations", () => {
  for (const invalid of [undefined, number, { ...construction, genericArguments: [] },
    { ...construction, extra: true }]) {
    const malformed = { ...carrier, value: { ...carrier.value, construction: invalid } };
    assert.equal(rustStructuralObjectCarrierValue(malformed), undefined);
  }
  assert.equal(rustStructuralObjectCarrierValue(rustStructuralObjectTargetType("/source.ts", [], "value", construction)), undefined);
  const without = rustStructuralObjectTargetType("/source.ts", []);
  assert.equal(inferRustTargetTypeParameterBindings(carrier, without, new Set(["Value"])), undefined);
});

test("constructor source registry preserves exact selected declaration and signature identity", () => {
  for (const mutation of [
    shape => ({ ...shape, construction: { ...shape.construction, declaration: {} } }),
    shape => ({ ...shape, construction: { ...shape.construction, signature: {} } }),
    shape => ({ ...shape, construction: { ...shape.construction, carrier: rustCallableTargetType([], parameter) } }),
  ]) {
    const registry = createRustSourceTypeRegistry();
    const shape = { sourceType: {}, storage: "structural-object", carrier, fields: [],
      construction: { declaration: {}, signature: {}, carrier: construction } };
    assert.equal(registry.registerStructuralObject(shape), true);
    assert.equal(registry.registerStructuralObject(shape), true);
    assert.equal(registry.registerStructuralObject(mutation(shape)), false);
    assert.equal(registry.structuralObjects().length, 1);
  }
});

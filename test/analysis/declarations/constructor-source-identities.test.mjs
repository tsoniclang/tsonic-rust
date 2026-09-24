import assert from "node:assert/strict";
import test from "node:test";
import { createRustSourceTypeRegistry } from "../../../dist/analysis/project-types/source-type-registry.js";
import { rustStructuralObjectTargetType } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";

test("equal native constructor carriers do not replace exact source signature identities", () => {
  const integer = { kind: "source-primitive", name: "int32" };
  const callable = rustCallableTargetType([integer], integer);
  const carrier = rustStructuralObjectTargetType("/constructors.ts", [], "reference", callable);
  const shapes = [0, 1].map(() => ({
    sourceType: {}, carrier, storage: "structural-object", fields: [],
    construction: { declaration: {}, signature: {}, carrier: callable },
  }));
  for (const order of [shapes, [...shapes].reverse()]) {
    const registry = createRustSourceTypeRegistry();
    for (const shape of order) assert.equal(registry.registerStructuralObject(shape), true);
    for (const shape of shapes) {
      const retained = registry.structuralObjectForType(shape.sourceType, carrier);
      assert.equal(retained.construction.declaration, shape.construction.declaration);
      assert.equal(retained.construction.signature, shape.construction.signature);
    }
    assert.equal(registry.structuralObjectForType({}, carrier), undefined);
    assert.equal(registry.registerStructuralObject({ ...shapes[0],
      construction: shapes[1].construction }), false);
    assert.equal(registry.structuralObjectForType(shapes[0].sourceType, carrier)
      .construction.declaration, shapes[0].construction.declaration);
  }
});

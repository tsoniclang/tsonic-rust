import assert from "node:assert/strict";
import { test } from "node:test";

import { createRustSourceTypeRegistry } from "../../../dist/analysis/project-types/source-type-registry.js";
import { rustSourceUnionTargetType, rustJsValueTargetType } from "../../../dist/target-model/types/index.js";

const int32Carrier = { kind: "source-primitive", name: "int32" };
const float64Carrier = { kind: "source-primitive", name: "float64" };
const receiverCarrier = {
  kind: "target-specific",
  target: "rust",
  name: "structural-object",
  value: {
    ownerFileName: "/src/index.ts",
    representation: "reference",
    bases: [],
    fields: [{
      sourceName: "value",
      type: int32Carrier,
      presence: "required",
      readonly: false,
    }],
  },
};

function structuralShape(sourceType, declaration, symbol, resultCarrier = int32Carrier) {
  return {
    sourceType,
    carrier: receiverCarrier,
    storage: "structural-object",
    fields: [{
      declarations: [declaration],
      symbols: [symbol],
      sourceName: "value",
      sourceType: {},
      storageIndex: 0,
      resultCarrier,
      presence: "required",
    }],
  };
}

test("equivalent compiler type wrappers share one exact structural field projection", () => {
  const registry = createRustSourceTypeRegistry();
  const declaration = {};
  const firstSymbol = {};
  const secondSymbol = {};
  assert.equal(registry.registerStructuralObject(
    structuralShape({}, declaration, firstSymbol),
  ), true);
  assert.equal(registry.registerStructuralObject(
    structuralShape({}, declaration, secondSymbol),
  ), true);

  const projection = registry.structuralFieldProjectionForDeclaration(
    declaration,
    receiverCarrier,
  );
  assert.equal(projection?.field.storageIndex, 0);
  assert.deepEqual(registry.declarationsForSelectedSymbol(firstSymbol), [declaration]);
  assert.deepEqual(registry.declarationsForSelectedSymbol(secondSymbol), [declaration]);
});

test("conflicting structural projections for one declaration fail closed", () => {
  const registry = createRustSourceTypeRegistry();
  const declaration = {};
  assert.equal(registry.registerStructuralObject(
    structuralShape({}, declaration, {}),
  ), true);
  assert.equal(registry.registerStructuralObject(
    structuralShape({}, declaration, {}, float64Carrier),
  ), false);

  assert.deepEqual(
    registry.structuralFieldProjectionForDeclaration(declaration, receiverCarrier)?.field.resultCarrier,
    int32Carrier,
  );
});

test("collapsed semantic unions index their exact authored arm without losing closed carrier identity", () => {
  for (const collapsed of [false, true]) {
    const registry = createRustSourceTypeRegistry();
    const broad = {};
    const nominal = {};
    const overall = collapsed ? broad : {};
    const broadCarrier = rustJsValueTargetType();
    const carrier = rustSourceUnionTargetType("/src/index.ts", "Union2",
      [broadCarrier, int32Carrier].map(type => ({ kind: "type", type })), "generated");
    const union = { sourceType: overall, carrier, selectedProperties: [], variants: [
      { name: "Variant0", carrier: broadCarrier, sourceTypes: [broad] },
      { name: "Variant1", carrier: int32Carrier, sourceTypes: [nominal] },
    ] };
    assert.equal(registry.registerSourceUnion(union), true);
    assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [overall]), collapsed ? [0] : [0, 1]);
    assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [broad]), [0]);
    assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [nominal]), [1]);
    assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [broad, nominal]), [0, 1]);
    const stored = registry.sourceUnionForCarrier(carrier);
    assert.ok(stored);
    assert.equal(Object.isFrozen(stored), true);
    assert.equal(Object.isFrozen(stored.variants), true);
    assert.equal(registry.registerSourceUnion({ ...union, variants: [
      union.variants[0], { ...union.variants[1], sourceTypes: [broad] },
    ] }), false);
    assert.equal(registry.sourceUnionForCarrier(carrier), stored);
    assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [nominal]), [1]);
  }
  const registry = createRustSourceTypeRegistry();
  const broadCarrier = rustJsValueTargetType();
  const carrier = rustSourceUnionTargetType("/src/index.ts", "Union2",
    [broadCarrier, int32Carrier].map(type => ({ kind: "type", type })), "generated");
  const shared = {};
  assert.equal(registry.registerSourceUnion({ sourceType: shared, carrier, selectedProperties: [], variants: [
    { name: "Variant0", carrier: broadCarrier, sourceTypes: [shared] },
    { name: "Variant1", carrier: int32Carrier, sourceTypes: [shared] },
  ] }), false);
  assert.equal(registry.sourceUnionForCarrier(carrier), undefined);
});

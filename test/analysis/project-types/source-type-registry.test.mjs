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
      [], "generated", { kind: "physical", types: [broadCarrier, int32Carrier] });
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
    [], "generated", { kind: "physical", types: [broadCarrier, int32Carrier] });
  const shared = {};
  const union = { sourceType: shared, carrier, selectedProperties: [], variants: [
    { name: "Variant0", carrier: broadCarrier, sourceTypes: [shared] },
    { name: "Variant1", carrier: int32Carrier, sourceTypes: [shared] },
  ] };
  assert.equal(registry.registerSourceUnion(union), true, "one checked type can witness both physical payloads");
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [shared]), [0, 1]);
  const stored = registry.sourceUnionForCarrier(carrier);
  assert.equal(registry.registerSourceUnion(union), true, "complete correspondence is idempotent");
  assert.equal(registry.sourceUnionForCarrier(carrier), stored, "registration never replaces a published physical contract");
  const missing = {};
  assert.equal(registry.registerSourceUnion({ ...union, variants: [
    union.variants[0], { ...union.variants[1], sourceTypes: [missing] },
  ] }), false, "an existing many-index set cannot silently narrow");
  assert.equal(registry.sourceUnionVariantIndexesForTypes(carrier, [missing]), undefined,
    "a contradictory registration publishes no partial new correspondence");
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [shared]), [0, 1]);
  const foreign = {};
  assert.equal(registry.registerSourceUnion({ ...union, sourceType: foreign, variants: union.variants.map(variant =>
    ({ ...variant, sourceTypes: [foreign] })) }), true, "another checker type receives its own complete relation");
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [foreign]), [0, 1]);
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [shared]), [0, 1]);
  const otherCarrier = rustSourceUnionTargetType("/other.ts", "Union2", [], "generated",
    { kind: "physical", types: [broadCarrier, float64Carrier] });
  assert.equal(registry.sourceUnionVariantIndexesForTypes(otherCarrier, [shared]), undefined,
    "the same primitive source type does not acquire a global native-carrier override");
  const failedType = {};
  assert.equal(registry.registerSourceUnion({ sourceType: failedType, carrier: otherCarrier, selectedProperties: [], variants: [
    { name: "Variant0", carrier: broadCarrier, sourceTypes: [failedType] },
    { name: "Variant1", carrier: int32Carrier, sourceTypes: [failedType] },
  ] }), false, "a payload inconsistent with the closed carrier fails before publication");
  assert.equal(registry.sourceUnionForCarrier(otherCarrier), undefined);
  assert.equal(registry.sourceUnionVariantIndexesForTypes(otherCarrier, [failedType]), undefined);
  assert.equal(registry.registerSourceUnion({ sourceType: failedType, carrier: otherCarrier, selectedProperties: [], variants: [
    { name: "Variant0", carrier: broadCarrier, sourceTypes: [failedType] },
    { name: "Variant1", carrier: float64Carrier, sourceTypes: [foreign] },
  ] }), true, "a separate physical key admits an independent exact index set");
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(otherCarrier, [failedType]), [0]);
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(otherCarrier, [foreign]), [1]);
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [foreign]), [0, 1]);
});

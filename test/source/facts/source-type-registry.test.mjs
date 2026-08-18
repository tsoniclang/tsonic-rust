import assert from "node:assert/strict";
import { test } from "node:test";

import { createRustSourceTypeRegistry } from "../../../dist/analysis/project-types/source-type-registry.js";

const int32Carrier = { kind: "source-primitive", name: "int32" };
const float64Carrier = { kind: "source-primitive", name: "float64" };
const receiverCarrier = {
  kind: "target-specific",
  target: "rust",
  name: "structural-object",
  value: {
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
    storage: "object-handle",
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

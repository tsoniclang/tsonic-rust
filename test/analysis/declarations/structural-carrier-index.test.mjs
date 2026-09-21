import assert from "node:assert/strict";
import test from "node:test";
import { createRustSourceTypeRegistry } from "../../../dist/analysis/project-types/source-type-registry.js";
import { rustStructuralObjectTargetType } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

function shape(index, type = { kind: "source-primitive", name: "float64" }) {
  const field = { sourceName: `field${index}`, presence: "required", readonly: false, type };
  return { sourceType: {}, storage: "structural-object",
    carrier: rustStructuralObjectTargetType("/source.ts", [field]),
    fields: [{ ...field, sourceType: {}, declarations: [{}], symbols: [{}], storageIndex: 0, resultCarrier: type }],
  };
}

test("structural carrier lookup isolates unrelated inventory while retaining exact independently built identities", () => {
  const registry = createRustSourceTypeRegistry();
  const entries = Array.from({ length: 256 }, (unused, index) => shape(index));
  for (const entry of entries) assert.equal(registry.registerStructuralObject(entry), true);
  for (const entry of entries) {
    const selected = registry.structuralObjectForCarrier(structuredClone(entry.carrier));
    assert.equal(selected.sourceType, entry.sourceType);
    assert.equal(selected.fields[0].declarations[0], entry.fields[0].declarations[0]);
    assert.equal(rustTargetTypeRefEquals(selected.carrier, entry.carrier), true);
  }
  assert.equal(registry.structuralObjectForCarrier(shape(1000).carrier), undefined);
  assert.equal(registry.structuralObjectForCarrier(shape(0, { kind: "source-primitive", name: "int64" }).carrier), undefined);
  assert.equal(registry.structuralObjects().length, 256);
});

test("structural registration snapshots carrier metadata without copying source identities", () => {
  const registry = createRustSourceTypeRegistry();
  const input = shape(0);
  input.carrier = structuredClone(input.carrier);
  const original = structuredClone(input.carrier);
  assert.equal(registry.registerStructuralObject(input), true);
  input.carrier.value.fields[0].type.name = "int64";
  input.fields[0].resultCarrier.name = "int64";
  assert.equal(registry.structuralObjectForCarrier(input.carrier), undefined);
  const selected = registry.structuralObjectForCarrier(original);
  assert.equal(selected.fields[0].resultCarrier.name, "float64");
  assert.equal(selected.fields[0].symbols[0], input.fields[0].symbols[0]);
  assert.ok(Object.isFrozen(selected.carrier.value.fields[0].type));
  assert.ok(Object.isFrozen(selected.fields[0].resultCarrier));
});

test("structural carrier indexing preserves conflicting contracts and rejects malformed requests", () => {
  const registry = createRustSourceTypeRegistry();
  const first = shape(0);
  assert.equal(registry.registerStructuralObject(first), true);
  const conflict = { ...first, sourceType: {}, fields: [{ ...first.fields[0], storageIndex: 1 }] };
  assert.equal(registry.registerStructuralObject(conflict), false);
  assert.equal(registry.structuralObjects().length, 1);
  for (const mutate of [
    carrier => { carrier.value.fields[0].type = { kind: "source-primitive", name: "invalid" }; },
    carrier => { delete carrier.value.fields[0]; },
    carrier => { carrier.value.fields[0].type = { kind: "array", element: carrier }; },
  ]) {
    const malformed = structuredClone(first.carrier);
    mutate(malformed);
    assert.equal(registry.structuralObjectForCarrier(malformed), undefined);
  }
  let accessorCalls = 0;
  const accessor = structuredClone(first.carrier);
  Object.defineProperty(accessor.value.fields[0], "type", { enumerable: true,
    get() { accessorCalls++; return first.fields[0].resultCarrier; } });
  assert.equal(registry.structuralObjectForCarrier(accessor), undefined);
  assert.equal(registry.registerStructuralObject({ ...first, carrier: accessor }), false);
  assert.equal(accessorCalls, 0);
});

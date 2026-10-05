import assert from "node:assert/strict";
import test from "node:test";
import { retainRustStructuralInstantiation } from "../../../dist/policy/types/resolution/structural-instantiations.js";
import { rustSourceUnionTargetType, rustSourcePrimitiveTargetType, rustStructuralObjectTargetType,
  rustCallableTargetType, rustVecTargetType, rustOptionTargetType } from "../../../dist/target-model/types/index.js";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";

function unionDefinition(payloads) {
  const definitions = createRustTypeDefinitionRegistry();
  const carrier = rustSourceUnionTargetType("/src/index.ts", `Union${payloads.length}`,
    payloads.map(type => ({ kind: "type", type })), "generated");
  assert.equal(definitions.registerSourceUnion({ carrier, variants: payloads.map((carrier, index) => ({
    name: `Variant${index}`, carrier,
  })) }, false), true);
  return { carrier, sourceTypes: definitions.seal() };
}

test("native-only generated payloads do not invent structural instantiation obligations", () => {
  const number = rustSourcePrimitiveTargetType("float64");
  const truth = rustSourcePrimitiveTargetType("bool");
  const { carrier, sourceTypes } = unionDefinition([number, truth]);
  for (const stored of [carrier, rustVecTargetType(carrier), rustOptionTargetType(carrier),
    rustCallableTargetType([carrier], carrier)]) {
    assert.equal(retainRustStructuralInstantiation({}, stored, stored, {}, { sourceTypes }), true);
  }
});

test("generated structural payloads retain exact selected-source proof obligations", () => {
  const shape = rustStructuralObjectTargetType("/src/index.ts", [
    { sourceName: "value", type: rustSourcePrimitiveTargetType("int64"), readonly: false, presence: "required" },
  ]);
  const { carrier, sourceTypes } = unionDefinition([shape, rustSourcePrimitiveTargetType("bool")]);
  const context = { currentSemantics: { types: { aliasApplication: () => undefined } } };
  assert.equal(retainRustStructuralInstantiation({}, carrier, carrier, context, {
    sourceTypes: { ...sourceTypes, sourceUnionForCarrier: () => undefined },
  }), false);
});

test("storage retention rejects missing or excessive native payload evidence", () => {
  const number = rustSourcePrimitiveTargetType("float64");
  const { carrier } = unionDefinition([number, rustSourcePrimitiveTargetType("bool")]);
  for (const variants of [undefined, [], Array(4097).fill({ carrier: number })]) {
    assert.equal(retainRustStructuralInstantiation({}, carrier, carrier, {}, {
      sourceTypes: { sourceUnionVariants: () => variants },
    }), false);
  }
  let nested = number;
  for (let index = 0; index < 4096; index++) nested = rustVecTargetType(nested);
  assert.equal(retainRustStructuralInstantiation({}, nested, nested, {}, { sourceTypes: {} }), false);
});

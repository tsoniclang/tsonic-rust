import assert from "node:assert/strict";
import test from "node:test";
import { finalizedConversionIsValid, finalizeValueConversion } from "../../../dist/analysis/facts/finalized-operation/conversions.js";
import { isFinalizedConversion } from "../../../dist/analysis/facts/finalized-operation/conversion-shape.js";
import { rustJsPromiseTargetTypeWithLifetime, rustSourcePrimitiveTargetType,
  rustSourceUnionTargetType } from "../../../dist/target-model/types/index.js";
import { rustStaticLifetime } from "../../../dist/target-model/lifetimes/index.js";

const integer = rustSourcePrimitiveTargetType("uint64");
const signed = rustSourcePrimitiveTargetType("int32");
const identity = { kind: "identity", sourceCarrier: integer, targetCarrier: integer, fallible: false };

test("one finalized conversion decoder retains native identity, semantic width and representation contracts", () => {
  assert.equal(finalizedConversionIsValid(identity), true);
  const checked = finalizeValueConversion({ kind: "exact-integer", source: integer, target: signed }, integer, signed);
  assert.ok(checked);
  assert.equal(checked.fallible, true);
  assert.equal(finalizedConversionIsValid(checked), true);
  const source = rustJsPromiseTargetTypeWithLifetime(integer, rustStaticLifetime);
  const target = rustJsPromiseTargetTypeWithLifetime(integer, { kind: "placeholder" });
  const representation = finalizeValueConversion({ kind: "native-representation", source, target }, source, target);
  assert.ok(representation);
  assert.equal(representation.fallible, false);
  assert.equal(isFinalizedConversion(representation), true);
  assert.equal(finalizedConversionIsValid(representation), true);
});

test("finalized conversions fail closed on malformed records, carriers, effects and nested schema", () => {
  const semantic = { kind: "semantic", conversion: { kind: "exact-integer", source: integer, target: signed },
    sourceCarrier: integer, targetCarrier: signed, fallible: true };
  const invalid = [ null, undefined, false, [], {},
    { ...identity, kind: "invented" }, { ...identity, extra: true },
    { ...identity, sourceCarrier: null }, { ...identity, targetCarrier: { kind: "invented" } },
    { ...identity, targetCarrier: signed }, { ...identity, fallible: true },
    { ...semantic, conversion: null }, { ...semantic, conversion: undefined },
    { ...semantic, conversion: { kind: "invented" } },
    { ...semantic, conversion: { ...semantic.conversion, extra: true } },
    { ...semantic, fallible: false }, { ...semantic, targetCarrier: integer },
    { ...semantic, conversion: { kind: "semantic-conversion", id: "invented" } },
    { ...semantic, conversion: { kind: "option-map", elementConversion: null } },
    { ...semantic, conversion: { kind: "rest-sequence", source: integer,
      elementTarget: integer, elementConversions: new Array(1) } },
    Object.assign(Object.create({ inherited: true }), identity),
  ];
  for (const mutation of invalid) assert.equal(finalizedConversionIsValid(mutation), false);
  const cyclic = { ...semantic, conversion: { kind: "option-map" } };
  cyclic.conversion.elementConversion = cyclic.conversion;
  assert.equal(finalizedConversionIsValid(cyclic), false);
});

test("conversion boundary rejects accessors without executing metadata", () => {
  let reads = 0;
  const accessor = () => { reads += 1; throw new Error("metadata must not execute"); };
  for (const property of [ "kind", "sourceCarrier", "targetCarrier", "fallible" ]) {
    const candidate = { ...identity };
    Object.defineProperty(candidate, property, { get: accessor, enumerable: true });
    assert.equal(finalizedConversionIsValid(candidate), false);
  }
  const nested = { kind: "semantic", sourceCarrier: integer, targetCarrier: signed, fallible: true,
    conversion: { kind: "exact-integer", source: integer, target: signed } };
  Object.defineProperty(nested.conversion, "source", { get: accessor, enumerable: true });
  assert.equal(finalizedConversionIsValid(nested), false);
  assert.equal(reads, 0);
});

test("absent semantic evidence rejects while unexpected owner failures remain visible", () => {
  const source = rustSourceUnionTargetType("/src/values.ts", "Values");
  const conversion = { kind: "semantic", sourceCarrier: source, targetCarrier: integer, fallible: false,
    conversion: { kind: "union-project", source, target: integer } };
  assert.equal(finalizedConversionIsValid(conversion, { programErrorOrigin: () => undefined, sourceUnionVariants: () => undefined }), false);
  const failure = new Error("unexpected type-definition owner failure");
  assert.throws(() => finalizedConversionIsValid(conversion, {
    programErrorOrigin: () => undefined, sourceUnionVariants: () => { throw failure; },
  }), error => error === failure);
});

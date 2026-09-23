import assert from "node:assert/strict";
import test from "node:test";
import { rustExactIntegerConversionMatches } from "../../../dist/target-model/conversions/exact-integer.js";
import { rustContextualValueConversionIsFallible } from "../../../dist/target-model/conversions/contextual.js";
import { rustOptionTargetType } from "../../../dist/target-model/types/index.js";

const primitive = name => ({ kind: "source-primitive", name });

test("exact integer conversion seals native widths and rejects incompatible mutations", () => {
  const integers = ["int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "int128", "uint128", "native-int", "native-uint"];
  for (const sourceName of [...integers, "float32", "float64"]) {
    for (const targetName of integers) {
      const source = primitive(sourceName);
      const target = primitive(targetName);
      const conversion = { kind: "exact-integer", source, target };
      assert.equal(rustExactIntegerConversionMatches(source, target, conversion), sourceName !== targetName);
      assert.equal(rustContextualValueConversionIsFallible(conversion), true);
      assert.equal(rustExactIntegerConversionMatches(primitive("bool"), target, conversion), false);
      assert.equal(rustExactIntegerConversionMatches(source, primitive("float64"), conversion), false);
      assert.equal(rustExactIntegerConversionMatches(source, target, { ...conversion, target: primitive("bool") }), false);
    }
  }
});

test("exact integer conversion preserves optional absence without implicit unwrapping", () => {
  const floating = primitive("float64");
  const integer = primitive("uint64");
  const optionalFloat = rustOptionTargetType(floating);
  const optionalInteger = rustOptionTargetType(integer);
  for (const source of [floating, optionalFloat]) {
    assert.equal(rustExactIntegerConversionMatches(source, optionalInteger,
      { kind: "exact-integer", source, target: optionalInteger }), true);
  }
  assert.equal(rustExactIntegerConversionMatches(optionalFloat, integer,
    { kind: "exact-integer", source: optionalFloat, target: integer }), false);
});

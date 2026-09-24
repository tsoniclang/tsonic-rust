import assert from "node:assert/strict";
import test from "node:test";
import { rustExactIntegerConversionMatches } from "../../../dist/target-model/conversions/exact-integer.js";
import { rustContextualValueConversionIsFallible } from "../../../dist/target-model/conversions/contextual.js";
import { rustOptionTargetType } from "../../../dist/target-model/types/index.js";
import { rustValueConversionContract } from "../../../dist/target-model/conversions/contracts.js";
import { selectRustSourceAssertionConversion, selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { rustNumericPromotionKind } from "../../../dist/target-model/conversions/numeric-promotion.js";

const primitive = name => ({ kind: "source-primitive", name });

test("exact integer conversion seals native widths and rejects incompatible mutations", () => {
  const integers = ["int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "int128", "uint128", "native-int", "native-uint"];
  for (const sourceName of [...integers, "float32", "float64"]) {
    for (const targetName of integers) {
      const source = primitive(sourceName);
      const target = primitive(targetName);
      const conversion = { kind: "exact-integer", source, target };
      assert.equal(rustExactIntegerConversionMatches(source, target, conversion), sourceName !== targetName);
      assert.equal(rustContextualValueConversionIsFallible(conversion), sourceName !== targetName);
      assert.equal(rustValueConversionContract(conversion) !== undefined, sourceName !== targetName);
      assert.equal(rustExactIntegerConversionMatches(primitive("bool"), target, conversion), false);
      assert.equal(rustExactIntegerConversionMatches(source, primitive("float64"), conversion), false);
      assert.equal(rustExactIntegerConversionMatches(source, target, { ...conversion, target: primitive("bool") }), false);
    }
  }
});

test("explicit integer assertions select one closed conversion for every native integer pair", () => {
  const integers = ["int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "int128", "uint128", "native-int", "native-uint"];
  for (const source of integers) {
    for (const target of integers) {
      if (source === target) continue;
      const selected = selectRustSourceAssertionConversion(primitive(source), primitive(target));
      assert.notEqual(selected, undefined, `${source} -> ${target}`);
      const contract = rustValueConversionContract(selected);
      assert.deepEqual(contract.source, primitive(source));
      assert.deepEqual(contract.target, primitive(target));
    }
  }
  for (const source of ["bool", "char", "float32", "float64"]) {
    assert.equal(selectRustSourceAssertionConversion(primitive(source), primitive("native-uint")), undefined);
  }
});

test("implicit native-word widening is portable and does not change binary promotion", () => {
  const domains = new Map([
    ["native-int", ["int8", "uint8", "int16"]],
    ["native-uint", ["uint8", "uint16"]],
  ]);
  for (const [target, admitted] of domains) {
    for (const source of ["int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64", "bool"]) {
      const selected = selectRustSourceValueConversion(primitive(source), primitive(target));
      assert.equal(selected !== undefined, admitted.includes(source), `${source} -> ${target}`);
      if (selected !== undefined) {
        const contract = rustValueConversionContract(selected);
        assert.equal(contract.fallible, false);
        assert.equal(contract.lowering, "numeric-cast");
        assert.equal(rustNumericPromotionKind(source, target), undefined);
      }
    }
  }
});

test("general exact-integer contracts reject invalid carriers and implicit absence unwrapping", () => {
  const source = primitive("int32");
  const target = primitive("native-uint");
  const conversion = { kind: "exact-integer", source, target };
  assert.equal(rustValueConversionContract(conversion).fallible, true);
  for (const mutation of [
    { source: primitive("bool") }, { target: primitive("bool") },
    { source: undefined }, { target: {} }, { target: primitive("float64") },
    { source: rustOptionTargetType(source) }, { target: source },
  ]) {
    assert.equal(rustValueConversionContract({ ...conversion, ...mutation }), undefined);
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

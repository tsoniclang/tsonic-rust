import assert from "node:assert/strict";
import test from "node:test";
import { selectRustInferredNumericArrayElement } from "../../../dist/policy/types/collections/array-elements.js";
import { rustSourcePrimitiveTargetType, rustSourceUnionTargetType } from "../../../dist/target-model/types/index.js";

const primitive = rustSourcePrimitiveTargetType;
const fixed = name => ({ carrier: primitive(name), literal: undefined });
const authored = (coefficient, exponent, integer) => ({ carrier: primitive("float64"), literal: {
  form: "numeric", number: Number(coefficient) * 10 ** Number(exponent), integer,
  numeric: { kind: "authored", token: { coefficient, exponent, negative: false, decimalText: `${coefficient}e${exponent}` } },
} });
const selectedCarrier = result => result.kind === "resolved" ? result.carrier : undefined;

test("C102 policy uses exact existing numeric and literal relations, not a synthetic promotion engine", () => {
  const select = (source, contributions, demands = []) => selectedCarrier(selectRustInferredNumericArrayElement(source, contributions, demands));
  const signed = { carrier: primitive("int32"), literal: undefined };
  const unsigned = { carrier: primitive("uint32"), literal: undefined };
  const wide = { carrier: primitive("int64"), literal: undefined };
  const one = { carrier: primitive("float64"), literal: { form: "numeric", number: 1, integer: 1n,
    numeric: { kind: "authored", token: { coefficient: 1n, exponent: 0n, negative: false, decimalText: "1" } } } };
  const fraction = { carrier: primitive("float64"), literal: { form: "numeric", number: 0.5,
    numeric: { kind: "authored", token: { coefficient: 5n, exponent: -1n, negative: false, decimalText: "0.5" } } } };
  const zero = { carrier: primitive("float64"), literal: { form: "prefix-unary", number: -0, integer: 0n,
    numeric: { kind: "authored", token: { coefficient: 0n, exponent: 0n, negative: true, decimalText: "-0" } } } };
  for (const rows of [[signed, unsigned, fraction], [signed, fraction, unsigned], [fraction, signed, unsigned]]) {
    assert.equal(select(primitive("float64"), rows)?.name, "float64", "all actual fractional candidates considered together");
  }
  for (const rows of [[signed, one], [one, signed], [signed, one, one], [one, signed, one], [one, one, signed]]) {
    assert.equal(select(primitive("float64"), rows)?.name, "int32", "integer literal defaults cannot force a float");
  }
  assert.equal(select(primitive("float64"), [signed, unsigned, one]) === undefined, true, "a fitting integer literal cannot rescue incompatible integer peers through float64");
  assert.equal(select(primitive("float64"), [wide, fraction]) === undefined, true, "no lossy int64 to float64 inference");
  assert.equal(select(primitive("float64"), [wide, one])?.name, "int64", "wide peer and exact integer literal stay exact");
  assert.equal(select(primitive("float64"), [signed, zero])?.name, "float64", "negative zero keeps floating semantics");
  const genuine = rustSourceUnionTargetType("/src/index.ts", "NativePair", [], "generated", {
    kind: "physical", types: [signed.carrier, wide.carrier],
  });
  assert.equal(select(genuine, [signed, wide]) === undefined, true, "genuine checked native union stays with its owner");
  assert.equal(select(primitive("float64"), [signed, { carrier: primitive("float64"), literal: undefined }])?.name,
    "float64", "a genuine computed float64 remains a fixed contribution");
  assert.equal(select(primitive("float64"), [signed, { carrier: primitive("float64"), literal: {
    form: "numeric", number: 1, integer: 1n, numeric: { kind: "checked-float64", value: 1 },
  } }])?.name, "float64", "checked float64 metadata cannot become an adaptable authored integer");
  assert.equal(select(primitive("float64"), []) === undefined, true, "missing contributions are not invented");
  const narrow = { carrier: primitive("int8"), literal: undefined };
  const overflow = { ...one, literal: { ...one.literal, number: 200, integer: 200n,
    numeric: { kind: "authored", token: { coefficient: 200n, exponent: 0n, negative: false, decimalText: "200" } } } };
  assert.equal(select(primitive("float64"), [narrow, overflow])?.name, "float64",
    "an unconstrained boundary literal is not forced into the first native peer");
  assert.equal(select(primitive("float64"), [narrow, overflow], [primitive("int8")])?.name,
    "int8", "the actual destination selects canonical literal admission, not a speculative successful fit");
  assert.equal(select(primitive("float64"), [signed, one], [primitive("float64")])?.name,
    "float64", "an actual explicit floating destination remains authoritative");
  assert.equal(select(primitive("float64"), [signed, one],
    [primitive("int32"), primitive("float64")])?.name, "int32", "inconsistent demands cannot choose the first destination");
});

test("C130 numeric array inference uses whole native integer domains for fixed float32 peers", () => {
  for (const name of ["int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64"]) {
    for (const rows of [[fixed("float32"), fixed(name)], [fixed(name), fixed("float32")]]) {
      const result = selectRustInferredNumericArrayElement(primitive("float64"), rows, []);
      if (["int8", "uint8", "int16", "uint16"].includes(name)) {
        assert.equal(result.kind, "resolved", `${name}: the entire native integer domain fits float32`);
        assert.equal(result.carrier.name, "float32", `${name}: retain the fixed float32 carrier`);
      } else {
        assert.equal(result.kind, "rejected", `${name}: no native domain is rounded or rescued through a new physical union`);
        assert.equal(result.reason, "Array literal requires a lossless native element carrier for every fixed floating and numeric contribution.");
      }
    }
  }
});

test("C130 authored float32 retargeting distinguishes exact tokens from double-rounded values", () => {
  for (const [literal, expected] of [
    [authored(5n, -1n), "float32"], [authored(1n, -1n), "float64"],
    [authored(16777216n, 0n, 16777216n), "float32"], [authored(16777217n, 0n, 16777217n), "float64"],
    [authored(10000000000000000000000000000000000000001n, -40n), "float64"],
  ]) {
    for (const rows of [[fixed("float32"), literal], [literal, fixed("float32")]]) {
      const result = selectRustInferredNumericArrayElement(primitive("float64"), rows, []);
      assert.equal(result.kind, "resolved", "an actual literal carrier remains available without a fabricated promotion");
      assert.equal(result.carrier.name, expected, literal.literal.numeric.token.decimalText);
    }
  }
  const explicit = selectRustInferredNumericArrayElement(primitive("float64"),
    [fixed("float32"), authored(1n, -1n)], [primitive("float32")]);
  assert.equal(explicit.kind, "resolved", "explicit native literal rounding remains at the existing admission owner");
  assert.equal(explicit.carrier.name, "float32");
});

test("C130 integer physical unions are unavailable rather than rejected or rescued by a flexible literal", () => {
  for (const rows of [[fixed("int32"), fixed("uint32")],
    [fixed("int32"), fixed("uint32"), authored(1n, 0n, 1n)],
    [fixed("int32"), authored(1n, 0n, 1n), fixed("uint32")],
    [authored(1n, 0n, 1n), fixed("int32"), fixed("uint32")]]) {
    assert.equal(selectRustInferredNumericArrayElement(primitive("float64"), rows, []).kind, "unavailable",
      "the existing physical-union owner, not numeric defaulting, receives the complete contribution set");
  }
});

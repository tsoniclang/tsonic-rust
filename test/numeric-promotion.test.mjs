import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rustNumericPromotionConversion,
  rustNumericPromotionKind,
} from "../dist/source/rust-target-semantics/numeric-promotion.js";
import {
  rustValueConversionContract,
  selectRustSourceValueConversion,
} from "../dist/source/rust-facts/value-conversions.js";
import { compileRust } from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

const kinds = [
  "int8",
  "uint8",
  "int16",
  "uint16",
  "int32",
  "uint32",
  "int64",
  "uint64",
  "float32",
  "float64",
];

const expected = [
  ["int8", "int32", "int32", "int32", "int32", "int64", "int64", undefined, "float32", "float64"],
  ["int32", "uint8", "int32", "int32", "int32", "uint32", "int64", "uint64", "float32", "float64"],
  ["int32", "int32", "int16", "int32", "int32", "int64", "int64", undefined, "float32", "float64"],
  ["int32", "int32", "int32", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"],
  ["int32", "int32", "int32", "int32", "int32", "int64", "int64", undefined, "float32", "float64"],
  ["int64", "uint32", "int64", "uint32", "int64", "uint32", "int64", "uint64", "float32", "float64"],
  ["int64", "int64", "int64", "int64", "int64", "int64", "int64", undefined, "float32", "float64"],
  [undefined, "uint64", undefined, "uint64", undefined, "uint64", undefined, "uint64", "float32", "float64"],
  ["float32", "float32", "float32", "float32", "float32", "float32", "float32", "float32", "float32", "float64"],
  ["float64", "float64", "float64", "float64", "float64", "float64", "float64", "float64", "float64", "float64"],
];

test("numeric promotion is one symmetric closed policy over every Rust primitive pair", () => {
  for (const [leftIndex, left] of kinds.entries()) {
    for (const [rightIndex, right] of kinds.entries()) {
      assert.equal(
        rustNumericPromotionKind(left, right),
        expected[leftIndex][rightIndex],
        `${left} with ${right}`,
      );
      assert.equal(
        rustNumericPromotionKind(left, right),
        rustNumericPromotionKind(right, left),
        `symmetry for ${left} with ${right}`,
      );
    }
  }
});

test("numeric promotion conversions carry exact source and target primitive evidence", () => {
  const conversion = rustNumericPromotionConversion("int32", "float64");
  assert.deepEqual(conversion, {
    kind: "numeric-promotion",
    source: "int32",
    target: "float64",
  });
  assert.deepEqual(rustValueConversionContract(conversion), {
    category: "numeric-promotion",
    lowering: "numeric-cast",
    sourceMode: "value",
    source: { kind: "source-primitive", name: "int32" },
    target: { kind: "source-primitive", name: "float64" },
    targetType: "f64",
    fallible: false,
  });
  assert.equal(rustNumericPromotionConversion("float64", "int32"), undefined);
  assert.equal(rustNumericPromotionConversion("bool", "int32"), undefined);
  assert.deepEqual(
    selectRustSourceValueConversion(
      { kind: "source-primitive", name: "int32" },
      { kind: "source-primitive", name: "int64" },
    ),
    { kind: "numeric-promotion", source: "int32", target: "int64" },
  );
  assert.equal(
    selectRustSourceValueConversion(
      { kind: "source-primitive", name: "float64" },
      { kind: "source-primitive", name: "float64" },
    ),
    undefined,
  );
});

test("generated Rust compiles representative mixed numeric operations", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type {
  float32,
  float64,
  int8,
  int16,
  int32,
  int64,
  uint8,
  uint16,
  uint32,
  uint64,
} from "@tsonic/core/types.js";

export function smallSignedUnsigned(a: int8, b: uint8): int32 { return a + b; }
export function smallWide(a: int16, b: uint16): int32 { return a + b; }
export function signedUnsigned(a: int32, b: uint32): int64 { return a + b; }
export function unsignedWide(a: uint32, b: uint64): uint64 { return a + b; }
export function signedWide(a: uint32, b: int64): int64 { return a + b; }
export function singlePrecision(a: int64, b: float32): float32 { return a + b; }
export function doublePrecision(a: uint64, b: float64): float64 { return a + b; }
export function compare(a: int32, b: float64): boolean { return a < b; }
export function equal(a: uint16, b: int8): boolean { return a === b; }
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("numeric-promotion", result.artifacts);
});

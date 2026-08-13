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

test("numeric promotion preserves the established fixed-width primitive matrix", () => {
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

test("wide and pointer-width primitives extend one symmetric closed promotion policy", () => {
  const allKinds = [
    ...kinds,
    "int128",
    "uint128",
    "native-int",
    "native-uint",
  ];
  const expectedRows = new Map([
    ["int128", [
      "int128", "int128", "int128", "int128", "int128", "int128", "int128",
      "int128", "float32", "float64", "int128", undefined, undefined, undefined,
    ]],
    ["uint128", [
      undefined, "uint128", undefined, "uint128", undefined, "uint128", undefined,
      "uint128", "float32", "float64", undefined, "uint128", undefined, undefined,
    ]],
    ["native-int", [
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, "float32", "float64", undefined, undefined, "native-int", undefined,
    ]],
    ["native-uint", [
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, "float32", "float64", undefined, undefined, undefined, "native-uint",
    ]],
  ]);

  for (const [kind, row] of expectedRows) {
    assert.equal(row.length, allKinds.length);
    for (const [index, other] of allKinds.entries()) {
      assert.equal(rustNumericPromotionKind(kind, other), row[index], `${kind} with ${other}`);
      assert.equal(
        rustNumericPromotionKind(kind, other),
        rustNumericPromotionKind(other, kind),
        `symmetry for ${kind} with ${other}`,
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

test("optional value conversions lift one exact element conversion", () => {
  const source = {
    kind: "target-named",
    id: "rust.std.Option",
    typeArguments: [{ kind: "source-primitive", name: "int32" }],
  };
  const target = {
    kind: "target-named",
    id: "rust.std.Option",
    typeArguments: [{ kind: "source-primitive", name: "float64" }],
  };
  const conversion = selectRustSourceValueConversion(source, target);
  assert.deepEqual(conversion, {
    kind: "option-map",
    elementConversion: { kind: "semantic-conversion", id: "exact-i32-to-f64" },
  });
  assert.deepEqual(rustValueConversionContract(conversion), {
    category: "exact",
    lowering: "option-map",
    sourceMode: "value",
    source,
    target,
    element: {
      category: "exact",
      lowering: "call",
      path: "tsonic_rust_runtime::conversions::i32_to_f64",
      sourceMode: "value",
      source: { kind: "source-primitive", name: "int32" },
      target: { kind: "source-primitive", name: "float64" },
      fallible: false,
    },
    fallible: false,
  });
  assert.equal(
    selectRustSourceValueConversion(
      source,
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
  uint8,
  uint16,
  uint32,
} from "@tsonic/core/types.js";
import type { i128, isize, u128, u64, usize } from "@tsonic/rust/types.js";

export function smallSignedUnsigned(a: int8, b: uint8): int32 { return a + b; }
export function smallWide(a: int16, b: uint16): int32 { return a + b; }
export function singlePrecision(a: int32, b: float32): float32 { return a + b; }
export function doublePrecision(a: uint32, b: float64): float64 { return a + b; }
export function compare(a: int32, b: float64): boolean { return a < b; }
export function equal(a: uint16, b: int8): boolean { return a === b; }
export function wideSigned(a: i128, b: u64): i128 { return a + b; }
export function wideUnsigned(a: u128, b: u64): u128 { return a + b; }
export function nativeSigned(a: isize, b: isize): isize { return a + b; }
export function nativeUnsigned(a: usize, b: usize): usize { return a + b; }
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("numeric-promotion", result.artifacts);
});

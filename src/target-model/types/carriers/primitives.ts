import { isRustNullCarrier, isRustUndefinedCarrier } from "./js.js";
import type { RustPrimitiveTypeName } from "../../syntax/tokens.js";
import type { SourcePrimitiveKind } from "@tsonic/tsts";
import type { TargetTypeRef } from "../model.js";
import {
  rustBuiltinPathTargetType,
  rustInferredLifetime,
  rustPathTypeArguments,
  rustBuiltinPathTypeMatches,
  rustReferenceTargetType,
  rustSourceCarrierTargetType,
} from "../constructors.js";
import { rustBuiltinIdentity } from "../../semantics/index.js";

const rustPrimitiveNames: Readonly<Partial<Record<SourcePrimitiveKind, RustPrimitiveTypeName>>> = {
  char: "u16",
  int8: "i8",
  uint8: "u8",
  int16: "i16",
  uint16: "u16",
  int32: "i32",
  uint32: "u32",
  int64: "i64",
  uint64: "u64",
  int128: "i128",
  uint128: "u128",
  float32: "f32",
  float64: "f64",
  "native-int": "isize",
  "native-uint": "usize",
};

const rustNumericPrimitiveKinds: ReadonlySet<SourcePrimitiveKind> = new Set([
  "int8",
  "uint8",
  "int16",
  "uint16",
  "int32",
  "uint32",
  "int64",
  "uint64",
  "int128",
  "uint128",
  "float32",
  "float64",
  "native-int",
  "native-uint",
]);

const rustSignedPrimitiveKinds: ReadonlySet<SourcePrimitiveKind> = new Set([
  "int8",
  "int16",
  "int32",
  "int64",
  "int128",
  "float32",
  "float64",
  "native-int",
]);

const rustIntegerPrimitiveKinds: ReadonlySet<SourcePrimitiveKind> = new Set([
  "int8",
  "uint8",
  "int16",
  "uint16",
  "int32",
  "uint32",
  "int64",
  "uint64",
  "int128",
  "uint128",
  "native-int",
  "native-uint",
]);

export function rustPrimitiveTypeName(kind: SourcePrimitiveKind): RustPrimitiveTypeName | undefined {
  if (kind === "bool") {
    return "bool";
  }
  return rustPrimitiveNames[kind];
}

export function isRustNumericCarrier(
  carrier: TargetTypeRef | undefined,
): carrier is Extract<TargetTypeRef, { readonly kind: "source-primitive" }> {
  return carrier?.kind === "source-primitive" && rustNumericPrimitiveKinds.has(carrier.name);
}

export function isRustSignedNumericCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && rustSignedPrimitiveKinds.has(carrier.name);
}

export function isRustIntegerCarrier(
  carrier: TargetTypeRef | undefined,
): carrier is Extract<TargetTypeRef, { readonly kind: "source-primitive" }> {
  return carrier?.kind === "source-primitive" && rustIntegerPrimitiveKinds.has(carrier.name);
}

export function sameRustPrimitiveCarrier(left: TargetTypeRef | undefined, right: TargetTypeRef | undefined): boolean {
  return left?.kind === "source-primitive" && right?.kind === "source-primitive" && left.name === right.name;
}

export function rustSliceRefTargetType(element: TargetTypeRef): TargetTypeRef {
  return rustReferenceTargetType(
    { kind: "slice", element },
    false,
    rustInferredLifetime("policy\0shared-slice"),
  );
}

export function isRustSliceRefCarrier(carrier: TargetTypeRef | undefined): carrier is Extract<TargetTypeRef, { kind: "reference" }> {
  return carrier?.kind === "reference" && carrier.mutable === false && carrier.target.kind === "slice";
}

export function rustSliceElementCarrier(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  return carrier?.kind === "reference" && carrier.target.kind === "slice" ? carrier.target.element : undefined;
}

export function rustSliceMutRefTargetType(element: TargetTypeRef): TargetTypeRef {
  return rustReferenceTargetType(
    { kind: "slice", element },
    true,
    rustInferredLifetime("policy\0mutable-slice"),
  );
}

export function isRustSliceMutRefCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "reference" && carrier.mutable && carrier.target.kind === "slice";
}

export const rustFutureTargetId = "rust.core.Future";

export function rustNullishSourceTargetType(): TargetTypeRef {
  return rustSourceCarrierTargetType(
    rustBuiltinIdentity("source-nullish", "tsonic-runtime"),
    Object.freeze({ category: "source-nullish" }),
  );
}

export function isRustNullishSourceCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-carrier" &&
    carrier.identity.kind === "builtin" &&
    carrier.identity.namespace === "tsonic-runtime" &&
    carrier.identity.itemId === "source-nullish";
}

export function isRustDefinitelyNullishCarrier(carrier: TargetTypeRef | undefined): boolean {
  return isRustNullishSourceCarrier(carrier) || isRustNullCarrier(carrier) ||
    isRustUndefinedCarrier(carrier);
}

export function rustFutureTargetType(output: TargetTypeRef): TargetTypeRef {
  return rustBuiltinPathTargetType(rustFutureTargetId, "core::future::Future", [output]);
}

export function rustFutureOutputCarrier(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  return rustBuiltinPathTypeMatches(carrier, rustFutureTargetId, "rust")
    ? rustPathTypeArguments(carrier)?.[0]
    : undefined;
}

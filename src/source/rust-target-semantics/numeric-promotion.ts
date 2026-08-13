import type { SourcePrimitiveKind } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../policy/types.js";
import type { RustValueConversion } from "../rust-facts/keys.js";
import {
  isRustNumericCarrier,
  rustSourcePrimitiveTargetType,
} from "../rust-target-types.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";

export interface RustNumericBinaryPromotion {
  readonly carrier: TargetTypeRef;
  readonly leftConversion?: RustValueConversion;
  readonly rightConversion?: RustValueConversion;
}

export function selectRustNumericBinaryPromotion(
  left: TargetTypeRef,
  right: TargetTypeRef,
): RustNumericBinaryPromotion | undefined {
  if (!isRustNumericCarrier(left) || !isRustNumericCarrier(right)) {
    return undefined;
  }
  const promotedKind = rustNumericPromotionKind(left.name, right.name);
  if (promotedKind === undefined) {
    return undefined;
  }
  const carrier = rustSourcePrimitiveTargetType(promotedKind);
  return {
    carrier,
    leftConversion: rustTargetTypeRefEquals(left, carrier)
      ? undefined
      : rustNumericPromotionConversion(left.name, promotedKind),
    rightConversion: rustTargetTypeRefEquals(right, carrier)
      ? undefined
      : rustNumericPromotionConversion(right.name, promotedKind),
  };
}

export function rustNumericPromotionConversion(
  source: SourcePrimitiveKind,
  target: SourcePrimitiveKind,
): RustValueConversion | undefined {
  return source !== target && rustNumericPromotionKind(source, target) === target
    ? { kind: "numeric-promotion", source, target }
    : undefined;
}

export function rustNumericPromotionKind(
  left: SourcePrimitiveKind,
  right: SourcePrimitiveKind,
): SourcePrimitiveKind | undefined {
  if (left === right && numericKinds.has(left)) {
    return left;
  }
  if (!numericKinds.has(left) || !numericKinds.has(right)) {
    return undefined;
  }
  if (left === "float64" || right === "float64") {
    return "float64";
  }
  if (left === "float32" || right === "float32") {
    return "float32";
  }
  if (left === "native-int" || right === "native-int" ||
    left === "native-uint" || right === "native-uint") {
    return undefined;
  }
  if (left === "uint128" || right === "uint128") {
    const other = left === "uint128" ? right : left;
    return unsignedKinds.has(other) ? "uint128" : undefined;
  }
  if (left === "int128" || right === "int128") {
    return "int128";
  }
  if (left === "uint64" || right === "uint64") {
    const other = left === "uint64" ? right : left;
    return unsignedKinds.has(other) ? "uint64" : undefined;
  }
  if (left === "int64" || right === "int64") {
    return "int64";
  }
  if (left === "uint32" || right === "uint32") {
    const other = left === "uint32" ? right : left;
    return signedKinds.has(other) ? "int64" : "uint32";
  }
  return smallIntegerKinds.has(left) && smallIntegerKinds.has(right)
    ? "int32"
    : undefined;
}

const numericKinds: ReadonlySet<SourcePrimitiveKind> = new Set([
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
  "float32",
  "float64",
]);

const signedKinds: ReadonlySet<SourcePrimitiveKind> = new Set(["int8", "int16", "int32"]);
const unsignedKinds: ReadonlySet<SourcePrimitiveKind> = new Set([
  "uint8",
  "uint16",
  "uint32",
  "uint64",
  "uint128",
]);
const smallIntegerKinds: ReadonlySet<SourcePrimitiveKind> = new Set([
  "int8",
  "uint8",
  "int16",
  "uint16",
  "int32",
  "uint32",
]);

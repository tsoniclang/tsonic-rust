import type { SourcePrimitiveKind } from "@tsonic/tsts";

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

export function rustIntegerKindIsExactlyRepresentableAsFloat64(
  kind: SourcePrimitiveKind,
): boolean {
  return float64ExactIntegerKinds.has(kind);
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
const float64ExactIntegerKinds: ReadonlySet<SourcePrimitiveKind> = new Set([
  "int8",
  "uint8",
  "int16",
  "uint16",
  "int32",
  "uint32",
]);

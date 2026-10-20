import type { TargetTypeRef } from "../model.js";
import type { RustRuntimeUnionVariant } from "./runtime-unions.js";
import { rustTargetTypeRefEquals } from "../equality.js";

import { emptyRustTypeDefinitions } from "../source-union-definitions.js";
import { rustSourcePrimitiveTargetType, rustStringTargetType } from "./native.js";
import { rustJsErrorTargetType, rustJsStringTargetType, rustJsSymbolTargetType } from "./js.js";
import { rustJsArrayValueTargetType } from "./array-values.js";
import { isRustMutableJsErrorCarrier, isRustRetainedErrorCarrier, isRustSourceErrorCarrier } from "./source-error.js";
import type { RustTypeDefinitions } from "../source-union-definitions.js";

export function rustClosedValueRetainsError(
  carrier: TargetTypeRef, definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): boolean {
  const origin = definitions.programErrorOrigin(carrier);
  return rustTargetTypeRefEquals(carrier, rustJsErrorTargetType()) || isRustMutableJsErrorCarrier(carrier) ||
    isRustRetainedErrorCarrier(carrier) || isRustSourceErrorCarrier(carrier) ||
    origin?.kind === "project" && origin.sourceError;
}

export const rustClosedValuePayloads: readonly { readonly carrier: TargetTypeRef; readonly variant: RustRuntimeUnionVariant }[] = Object.freeze([
  { carrier: rustSourcePrimitiveTargetType("bool"), variant: { kind: "payload", name: "Bool" } },
  { carrier: rustSourcePrimitiveTargetType("int8"), variant: { kind: "payload", name: "Int8" } },
  { carrier: rustSourcePrimitiveTargetType("uint8"), variant: { kind: "payload", name: "Uint8" } },
  { carrier: rustSourcePrimitiveTargetType("int16"), variant: { kind: "payload", name: "Int16" } },
  { carrier: rustSourcePrimitiveTargetType("uint16"), variant: { kind: "payload", name: "Uint16" } },
  { carrier: rustSourcePrimitiveTargetType("int32"), variant: { kind: "payload", name: "Int32" } },
  { carrier: rustSourcePrimitiveTargetType("uint32"), variant: { kind: "payload", name: "Uint32" } },
  { carrier: rustSourcePrimitiveTargetType("int64"), variant: { kind: "payload", name: "Integer" } },
  { carrier: rustSourcePrimitiveTargetType("uint64"), variant: { kind: "payload", name: "UnsignedInteger" } },
  { carrier: rustSourcePrimitiveTargetType("native-int"), variant: { kind: "payload", name: "NativeInt" } },
  { carrier: rustSourcePrimitiveTargetType("native-uint"), variant: { kind: "payload", name: "NativeUint" } },
  { carrier: rustSourcePrimitiveTargetType("float32"), variant: { kind: "payload", name: "Float32" } },
  { carrier: rustSourcePrimitiveTargetType("float64"), variant: { kind: "payload", name: "Number" } },
  { carrier: rustStringTargetType(), variant: { kind: "payload", name: "String" } },
  { carrier: rustJsStringTargetType(), variant: { kind: "payload", name: "Utf16String" } },
  { carrier: rustJsSymbolTargetType(), variant: { kind: "payload", name: "Symbol" } },
  { carrier: rustJsArrayValueTargetType(), variant: { kind: "payload", name: "Array" } },
]);

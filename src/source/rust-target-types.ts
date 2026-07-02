import type { SourcePrimitiveKind, TargetTypeRef } from "@tsonic/tsts";

// Rust carrier identities. Carriers are TargetTypeRefs selected by facts; the
// backend renders them to Rust type text only at the printer boundary.

export const rustStringTargetId = "rust.std.String";
export const rustOptionTargetId = "rust.std.Option";
export const rustJsValueTargetId = "rust.js.JsValue";
export const rustJsArrayTargetId = "rust.js.JsArray";
export const rustJsMapTargetId = "rust.js.JsMap";
export const rustJsSetTargetId = "rust.js.JsSet";
export const rustJsDateTargetId = "rust.js.JsDate";

export function rustSourcePrimitiveTargetType(kind: SourcePrimitiveKind): TargetTypeRef {
  return { kind: "source-primitive", name: kind };
}

export function rustStringTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustStringTargetId };
}

export function rustUnitTargetType(): TargetTypeRef {
  return { kind: "tuple", elements: [] };
}

export function rustVecTargetType(element: TargetTypeRef): TargetTypeRef {
  return { kind: "array", element };
}

export function rustOptionTargetType(value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustOptionTargetId, typeArguments: [value] };
}

export function rustJsValueTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsValueTargetId };
}

export function rustJsArrayTargetType(element: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsArrayTargetId, typeArguments: [element] };
}

export function rustJsMapTargetType(key: TargetTypeRef, value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsMapTargetId, typeArguments: [key, value] };
}

export function rustJsSetTargetType(value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsSetTargetId, typeArguments: [value] };
}

export function rustJsDateTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsDateTargetId };
}

export function isRustVecCarrier(carrier: TargetTypeRef | undefined): carrier is Extract<TargetTypeRef, { kind: "array" }> {
  return carrier?.kind === "array";
}

export function isRustOptionCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustOptionTargetId;
}

export function isRustJsArrayCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustJsArrayTargetId;
}

export function isRustJsValueCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustJsValueTargetId;
}

export function isRustStringCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustStringTargetId;
}

export function isRustUnitCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "tuple" && carrier.elements.length === 0;
}

export function isRustBoolCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && carrier.name === "bool";
}

const rustNumericPrimitiveNames: Readonly<Partial<Record<SourcePrimitiveKind, string>>> = {
  int8: "i8",
  uint8: "u8",
  int16: "i16",
  uint16: "u16",
  int32: "i32",
  uint32: "u32",
  int64: "i64",
  uint64: "u64",
  float32: "f32",
  float64: "f64",
};

const rustSignedPrimitiveKinds: ReadonlySet<SourcePrimitiveKind> = new Set([
  "int8",
  "int16",
  "int32",
  "int64",
  "float32",
  "float64",
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
]);

export function rustPrimitiveTypeName(kind: SourcePrimitiveKind): string | undefined {
  if (kind === "bool") {
    return "bool";
  }
  return rustNumericPrimitiveNames[kind];
}

export function isRustNumericCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && rustNumericPrimitiveNames[carrier.name] !== undefined;
}

export function isRustSignedNumericCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && rustSignedPrimitiveKinds.has(carrier.name);
}

export function isRustIntegerCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && rustIntegerPrimitiveKinds.has(carrier.name);
}

export function sameRustPrimitiveCarrier(left: TargetTypeRef | undefined, right: TargetTypeRef | undefined): boolean {
  return left?.kind === "source-primitive" && right?.kind === "source-primitive" && left.name === right.name;
}

export function rustSliceRefTargetType(element: TargetTypeRef): TargetTypeRef {
  return { kind: "pointer", pointee: { kind: "array", element }, mutability: "const" };
}

export function isRustSliceRefCarrier(carrier: TargetTypeRef | undefined): carrier is Extract<TargetTypeRef, { kind: "pointer" }> {
  return carrier?.kind === "pointer" && carrier.mutability === "const" && carrier.pointee.kind === "array";
}

export function rustSliceElementCarrier(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  return carrier?.kind === "pointer" && carrier.pointee.kind === "array" ? carrier.pointee.element : undefined;
}

export function rustSliceMutRefTargetType(element: TargetTypeRef): TargetTypeRef {
  return { kind: "pointer", pointee: { kind: "array", element }, mutability: "mut" };
}

export function isRustSliceMutRefCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "pointer" && carrier.mutability === "mut" && carrier.pointee.kind === "array";
}

export const rustFutureTargetId = "rust.core.Future";

export function rustFutureTargetType(output: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustFutureTargetId, typeArguments: [output] };
}

export function rustFutureOutputCarrier(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  return carrier?.kind === "target-named" && carrier.id === rustFutureTargetId
    ? carrier.typeArguments?.[0]
    : undefined;
}

import { rustBigIntTargetId, rustJsArrayConcatItemTargetId, rustJsArrayTargetId, rustJsDateTargetId, rustJsErrorTargetId, rustJsMapTargetId, rustJsSetTargetId, rustJsValueTargetId, rustNeverCarrierName, rustNullTargetId, rustOptionTargetId, rustProgramErrorTargetId, rustStringTargetId, rustUndefinedTargetId } from "./source-types.js";
import type { TargetTypeRef } from "../model.js";

export function rustJsValueTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsValueTargetId };
}

export function rustJsErrorTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsErrorTargetId };
}

export function rustProgramErrorTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustProgramErrorTargetId };
}

export function isRustProgramErrorCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustProgramErrorTargetId;
}

export function rustJsArrayTargetType(element: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsArrayTargetId, typeArguments: [element] };
}

export function rustJsArrayConcatItemTargetType(element: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsArrayConcatItemTargetId, typeArguments: [element] };
}

export function rustJsMapTargetType(key: TargetTypeRef, value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsMapTargetId, typeArguments: [key, value] };
}

export function rustJsSetTargetType(value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsSetTargetId, typeArguments: [value] };
}

export function getRustJsMapTargetTypes(
  carrier: TargetTypeRef | undefined,
): { readonly key: TargetTypeRef; readonly value: TargetTypeRef } | undefined {
  if (carrier?.kind !== "target-named" || carrier.id !== rustJsMapTargetId ||
    carrier.typeArguments?.length !== 2) {
    return undefined;
  }
  const [key, value] = carrier.typeArguments;
  return key === undefined || value === undefined ? undefined : { key, value };
}

export function getRustJsSetElementTargetType(
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  return carrier?.kind === "target-named" && carrier.id === rustJsSetTargetId &&
    carrier.typeArguments?.length === 1
    ? carrier.typeArguments[0]
    : undefined;
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

export function rustOptionElementCarrier(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  return carrier?.kind === "target-named" && carrier.id === rustOptionTargetId
    ? carrier.typeArguments?.[0]
    : undefined;
}

export function isRustJsArrayCarrier(
  carrier: TargetTypeRef | undefined,
): carrier is TargetTypeRef & {
  readonly kind: "target-named";
  readonly id: typeof rustJsArrayTargetId;
  readonly typeArguments?: readonly TargetTypeRef[];
} {
  return carrier?.kind === "target-named" && carrier.id === rustJsArrayTargetId;
}

export function isRustJsValueCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustJsValueTargetId;
}

export function isRustStringCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustStringTargetId;
}

export function isRustBigIntCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustBigIntTargetId;
}

export function isRustUnitCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "tuple" && carrier.elements.length === 0;
}

export function isRustNeverCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-specific" && carrier.target === "rust" &&
    carrier.name === rustNeverCarrierName && carrier.value === undefined;
}

export function isRustUndefinedCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustUndefinedTargetId;
}

export function isRustNullCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustNullTargetId;
}

export function isRustBoolCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && carrier.name === "bool";
}

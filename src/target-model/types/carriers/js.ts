import { rustBigIntTargetId, rustJsArrayConcatItemTargetId, rustJsArrayTargetId, rustJsDateTargetId, rustJsErrorTargetId, rustJsMapTargetId, rustJsRegExpExecArrayTargetId, rustJsRegExpIndicesTargetId, rustJsRegExpMatchArrayTargetId, rustJsRegExpNamedGroupsTargetId, rustJsRegExpNamedIndicesTargetId, rustJsRegExpStringIteratorTargetId, rustJsRegExpTargetId, rustJsSetTargetId, rustJsStringTargetId, rustJsValueTargetId, rustNeverCarrierName, rustNullTargetId, rustProgramErrorTargetId, rustRegExpExecArrayTargetId, rustRegExpIndicesTargetId, rustRegExpMatchArrayTargetId, rustRegExpNamedGroupsTargetId, rustRegExpNamedIndicesTargetId, rustRegExpStringIteratorTargetId, rustStringTargetId, rustUndefinedTargetId } from "./source-types.js";
import { rustOptionTargetType } from "./optional.js";
import type { TargetTypeRef } from "../model.js";

export function rustJsValueTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsValueTargetId };
}

export function rustJsStringTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsStringTargetId };
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

export function rustJsRegExpTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsRegExpTargetId };
}

export function rustRegExpExecArrayTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustRegExpExecArrayTargetId };
}

export function rustRegExpMatchArrayTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustRegExpMatchArrayTargetId };
}

export function rustRegExpIndicesTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustRegExpIndicesTargetId };
}

export function rustRegExpNamedGroupsTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustRegExpNamedGroupsTargetId };
}

export function rustRegExpNamedIndicesTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustRegExpNamedIndicesTargetId };
}

export function rustRegExpStringIteratorTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustRegExpStringIteratorTargetId };
}

export function rustJsRegExpExecArrayTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsRegExpExecArrayTargetId };
}

export function rustJsRegExpMatchArrayTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsRegExpMatchArrayTargetId };
}

export function rustJsRegExpIndicesTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsRegExpIndicesTargetId };
}

export function rustJsRegExpNamedGroupsTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsRegExpNamedGroupsTargetId };
}

export function rustJsRegExpNamedIndicesTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsRegExpNamedIndicesTargetId };
}

export function rustJsRegExpStringIteratorTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsRegExpStringIteratorTargetId };
}

export function isRustVecCarrier(carrier: TargetTypeRef | undefined): carrier is Extract<TargetTypeRef, { kind: "array" }> {
  return carrier?.kind === "array";
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

export function rustJsArrayLikeElementTargetType(
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  if (carrier?.kind !== "target-named") {
    return undefined;
  }
  if (carrier.id === rustJsArrayTargetId) {
    return carrier.typeArguments?.length === 1 ? carrier.typeArguments[0] : undefined;
  }
  if (carrier.id === rustRegExpExecArrayTargetId || carrier.id === rustRegExpMatchArrayTargetId) {
    return { kind: "target-named", id: rustStringTargetId };
  }
  if (carrier.id === rustJsRegExpExecArrayTargetId || carrier.id === rustJsRegExpMatchArrayTargetId) {
    return rustJsStringTargetType();
  }
  return carrier.id === rustRegExpIndicesTargetId || carrier.id === rustJsRegExpIndicesTargetId
    ? {
        kind: "tuple",
        elements: [
          { kind: "source-primitive", name: "float64" },
          { kind: "source-primitive", name: "float64" },
        ],
      }
    : undefined;
}

export function rustJsArrayLikeIterationElementTargetType(
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const element = rustJsArrayLikeElementTargetType(carrier);
  if (element === undefined || carrier?.kind !== "target-named") {
    return undefined;
  }
  return rustRegExpResultArrayTargetIds.has(carrier.id)
    ? rustOptionTargetType(element)
    : element;
}

const rustRegExpResultArrayTargetIds: ReadonlySet<string> = new Set([
  rustRegExpExecArrayTargetId,
  rustRegExpMatchArrayTargetId,
  rustRegExpIndicesTargetId,
  rustJsRegExpExecArrayTargetId,
  rustJsRegExpMatchArrayTargetId,
  rustJsRegExpIndicesTargetId,
]);

export function isRustJsArrayLikeCarrier(carrier: TargetTypeRef | undefined): boolean {
  return rustJsArrayLikeElementTargetType(carrier) !== undefined;
}

export function isRustJsValueCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustJsValueTargetId;
}

export function isRustStringCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustStringTargetId;
}

export function isRustJsStringCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustJsStringTargetId;
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

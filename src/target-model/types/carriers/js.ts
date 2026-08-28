import { rustBigIntTargetId, rustJsArrayBufferTargetId, rustJsArrayConcatItemTargetId, rustJsArrayTargetId, rustJsDataViewTargetId, rustJsDateTargetId, rustJsErrorTargetId, rustJsFloat32ArrayTargetId, rustJsFloat64ArrayTargetId, rustJsInt16ArrayTargetId, rustJsInt32ArrayTargetId, rustJsInt8ArrayTargetId, rustJsIntlCollatorTargetId, rustJsIntlDateTimeFormatPartTargetId, rustJsIntlDateTimeFormatTargetId, rustJsIntlNumberFormatPartTargetId, rustJsIntlNumberFormatTargetId, rustJsIntlResolvedCollatorOptionsTargetId, rustJsIntlResolvedDateTimeFormatOptionsTargetId, rustJsIntlResolvedNumberFormatOptionsTargetId, rustJsMapTargetId, rustJsPromiseFulfilledResultTargetId, rustJsPromiseRejectedResultTargetId, rustJsPromiseSettledResultTargetId, rustJsPromiseTargetId, rustJsRegExpExecArrayTargetId, rustJsRegExpIndicesTargetId, rustJsRegExpMatchArrayTargetId, rustJsRegExpNamedGroupsTargetId, rustJsRegExpNamedIndicesTargetId, rustJsRegExpStringIteratorTargetId, rustJsRegExpTargetId, rustJsSetTargetId, rustJsStringTargetId, rustJsSymbolTargetId, rustJsUint16ArrayTargetId, rustJsUint32ArrayTargetId, rustJsUint8ArrayTargetId, rustJsUint8ClampedArrayTargetId, rustJsValueTargetId, rustJsWeakMapTargetId, rustJsWeakSetTargetId, rustNeverCarrierName, rustNullTargetId, rustProgramErrorTargetId, rustRegExpExecArrayTargetId, rustRegExpIndicesTargetId, rustRegExpMatchArrayTargetId, rustRegExpNamedGroupsTargetId, rustRegExpNamedIndicesTargetId, rustRegExpStringIteratorTargetId, rustStringTargetId, rustUndefinedTargetId } from "./source-types.js";
import { rustOptionTargetType } from "./optional.js";
import type { TargetTypeRef } from "../model.js";
import {
  rustLifetimeGenericArgument,
  rustOnlyTypeGenericArguments,
  rustTypeGenericArgument,
  rustTypeGenericArguments,
} from "../generic-arguments.js";
import { rustPlaceholderLifetime } from "../../lifetimes/index.js";

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
  return { kind: "target-named", id: rustJsArrayTargetId, genericArguments: rustTypeGenericArguments([element]) };
}

export function rustJsArrayConcatItemTargetType(element: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsArrayConcatItemTargetId, genericArguments: rustTypeGenericArguments([element]) };
}

export function rustJsMapTargetType(key: TargetTypeRef, value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsMapTargetId, genericArguments: rustTypeGenericArguments([key, value]) };
}

export function rustJsSetTargetType(value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsSetTargetId, genericArguments: rustTypeGenericArguments([value]) };
}

export function getRustJsMapTargetTypes(
  carrier: TargetTypeRef | undefined,
): { readonly key: TargetTypeRef; readonly value: TargetTypeRef } | undefined {
  if (carrier?.kind !== "target-named" || carrier.id !== rustJsMapTargetId) {
    return undefined;
  }
  const arguments_ = rustOnlyTypeGenericArguments(carrier.genericArguments);
  if (arguments_?.length !== 2) return undefined;
  const [key, value] = arguments_;
  return key === undefined || value === undefined ? undefined : { key, value };
}

export function getRustJsSetElementTargetType(
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  if (carrier?.kind !== "target-named" || carrier.id !== rustJsSetTargetId) return undefined;
  const arguments_ = rustOnlyTypeGenericArguments(carrier.genericArguments);
  return arguments_?.length === 1 ? arguments_[0] : undefined;
}

export function rustJsDateTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsDateTargetId };
}

export function rustJsSymbolTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsSymbolTargetId };
}

export function rustJsWeakMapTargetType(key: TargetTypeRef, value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsWeakMapTargetId, genericArguments: rustTypeGenericArguments([key, value]) };
}

export function rustJsWeakSetTargetType(value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsWeakSetTargetId, genericArguments: rustTypeGenericArguments([value]) };
}

export function rustJsPromiseTargetType(output: TargetTypeRef): TargetTypeRef {
  return {
    kind: "target-named",
    id: rustJsPromiseTargetId,
    genericArguments: [
      rustLifetimeGenericArgument(rustPlaceholderLifetime),
      rustTypeGenericArgument(output),
    ],
  };
}

export function rustJsPromiseOutputTargetType(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  if (carrier?.kind !== "target-named" || carrier.id !== rustJsPromiseTargetId) return undefined;
  const [lifetime, output] = carrier.genericArguments ?? [];
  return carrier.genericArguments?.length === 2 && lifetime?.kind === "lifetime" && output?.kind === "type"
    ? output.type
    : undefined;
}

export function rustJsPromiseFulfilledResultTargetType(value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsPromiseFulfilledResultTargetId, genericArguments: rustTypeGenericArguments([value]) };
}

export function rustJsPromiseRejectedResultTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsPromiseRejectedResultTargetId };
}

export function rustJsPromiseSettledResultTargetType(value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsPromiseSettledResultTargetId, genericArguments: rustTypeGenericArguments([value]) };
}

export function getRustJsWeakMapTargetTypes(
  carrier: TargetTypeRef | undefined,
): { readonly key: TargetTypeRef; readonly value: TargetTypeRef } | undefined {
  if (carrier?.kind !== "target-named" || carrier.id !== rustJsWeakMapTargetId) return undefined;
  const arguments_ = rustOnlyTypeGenericArguments(carrier.genericArguments);
  const [key, value] = arguments_ ?? [];
  return arguments_?.length === 2 && key !== undefined && value !== undefined ? { key, value } : undefined;
}

export function getRustJsWeakSetElementTargetType(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  if (carrier?.kind !== "target-named" || carrier.id !== rustJsWeakSetTargetId) return undefined;
  const arguments_ = rustOnlyTypeGenericArguments(carrier.genericArguments);
  return arguments_?.length === 1 ? arguments_[0] : undefined;
}

export const rustJsTypedArrayTargetIds = Object.freeze({
  Int8Array: rustJsInt8ArrayTargetId,
  Uint8Array: rustJsUint8ArrayTargetId,
  Uint8ClampedArray: rustJsUint8ClampedArrayTargetId,
  Int16Array: rustJsInt16ArrayTargetId,
  Uint16Array: rustJsUint16ArrayTargetId,
  Int32Array: rustJsInt32ArrayTargetId,
  Uint32Array: rustJsUint32ArrayTargetId,
  Float32Array: rustJsFloat32ArrayTargetId,
  Float64Array: rustJsFloat64ArrayTargetId,
});

export type RustJsTypedArrayName = keyof typeof rustJsTypedArrayTargetIds;

export function rustJsArrayBufferTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsArrayBufferTargetId };
}

export function rustJsDataViewTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsDataViewTargetId };
}

export function rustJsTypedArrayTargetType(name: RustJsTypedArrayName): TargetTypeRef {
  return { kind: "target-named", id: rustJsTypedArrayTargetIds[name] };
}

export function rustJsTypedArrayName(carrier: TargetTypeRef | undefined): RustJsTypedArrayName | undefined {
  if (carrier?.kind !== "target-named") return undefined;
  return (Object.entries(rustJsTypedArrayTargetIds) as readonly (readonly [RustJsTypedArrayName, string])[])
    .find(([, id]) => id === carrier.id)?.[0];
}

export function rustJsIntlDateTimeFormatTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsIntlDateTimeFormatTargetId };
}

export function rustJsIntlNumberFormatTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsIntlNumberFormatTargetId };
}

export function rustJsIntlCollatorTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsIntlCollatorTargetId };
}

export function rustJsIntlDateTimeFormatPartTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsIntlDateTimeFormatPartTargetId };
}

export function rustJsIntlNumberFormatPartTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsIntlNumberFormatPartTargetId };
}

export function rustJsIntlResolvedDateTimeFormatOptionsTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsIntlResolvedDateTimeFormatOptionsTargetId };
}

export function rustJsIntlResolvedNumberFormatOptionsTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsIntlResolvedNumberFormatOptionsTargetId };
}

export function rustJsIntlResolvedCollatorOptionsTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsIntlResolvedCollatorOptionsTargetId };
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
  readonly genericArguments?: readonly import("../model.js").RustTargetGenericArgument[];
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
    const arguments_ = rustOnlyTypeGenericArguments(carrier.genericArguments);
    return arguments_?.length === 1 ? arguments_[0] : undefined;
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

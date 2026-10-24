import type { TargetTypeRef } from "../model.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../equality.js";
import { rustJsIntlGroupingTargetId, rustJsNumericTargetId, rustJsStringNumberTargetId, rustJsPromiseResolutionTargetId } from "./source-types.js";
import { rustBigIntTargetType, rustSourcePrimitiveTargetType, rustStringTargetType } from "./native.js";
import { rustOnlyTypeGenericArguments, rustTypeGenericArguments } from "../generic-arguments.js";
import { rustJsPromiseTargetType } from "./promises.js";
import { isDenseDataArray, snapshotClosedMetadata } from "../../metadata/closed-data.js";

export type RustRuntimeUnionVariant =
  | { readonly kind: "payload"; readonly name: string }
  | { readonly kind: "constant"; readonly name: string; readonly value: boolean };

export interface RustRuntimeUnionContract {
  readonly typeofMethod?: "type_of";
  readonly strictEqualityOnly?: true;
  readonly alternatives: readonly {
    readonly carrier: TargetTypeRef;
    readonly variant: RustRuntimeUnionVariant;
  }[];
}

const contracts: ReadonlyMap<string, RustRuntimeUnionContract> = new Map<string, RustRuntimeUnionContract>([
  [rustJsStringNumberTargetId, Object.freeze({
    typeofMethod: "type_of", strictEqualityOnly: true,
    alternatives: Object.freeze([
      Object.freeze({ carrier: rustSourcePrimitiveTargetType("float64"), variant: Object.freeze({ kind: "payload", name: "Number" }) }),
      Object.freeze({ carrier: rustStringTargetType(), variant: Object.freeze({ kind: "payload", name: "String" }) }),
    ]),
  })],
  [rustJsNumericTargetId, Object.freeze({
    typeofMethod: "type_of",
    alternatives: Object.freeze([
      Object.freeze({ carrier: rustSourcePrimitiveTargetType("float64"), variant: Object.freeze({ kind: "payload", name: "Number" }) }),
      Object.freeze({ carrier: rustBigIntTargetType(), variant: Object.freeze({ kind: "payload", name: "BigInt" }) }),
    ]),
  })],
  [rustJsIntlGroupingTargetId, Object.freeze({
    typeofMethod: "type_of",
    alternatives: Object.freeze([
      Object.freeze({ carrier: rustSourcePrimitiveTargetType("bool"), variant: Object.freeze({ kind: "constant", name: "Disabled", value: false }) }),
      Object.freeze({ carrier: rustStringTargetType(), variant: Object.freeze({ kind: "payload", name: "Strategy" }) }),
    ]),
  })],
]);

export function rustRuntimeUnionContract(carrier: TargetTypeRef | undefined): RustRuntimeUnionContract | undefined {
  if (carrier?.kind === "target-named" && carrier.id === rustJsPromiseResolutionTargetId) {
    const arguments_ = rustOnlyTypeGenericArguments(carrier.genericArguments);
    const output = arguments_?.length === 1 ? arguments_[0] : undefined;
    const promise = output === undefined ? undefined : rustJsPromiseTargetType(output);
    return output === undefined || promise === undefined ? undefined : Object.freeze({ alternatives: Object.freeze([
      Object.freeze({ carrier: output, variant: Object.freeze({ kind: "payload" as const, name: "Value" }) }),
      Object.freeze({ carrier: promise,
        variant: Object.freeze({ kind: "payload" as const, name: "Promise" }) }),
    ]) });
  }
  return carrier?.kind === "target-named" && (carrier.genericArguments?.length ?? 0) === 0
    ? contracts.get(carrier.id)
    : undefined;
}

export function rustRuntimeUnionProjection(source: TargetTypeRef, selected: TargetTypeRef): RustRuntimeUnionVariant | undefined {
  return rustRuntimeUnionContract(source)?.alternatives.find(alternative =>
    rustTargetTypeRefEquals(alternative.carrier, selected))?.variant;
}

export function instantiateRustRuntimeUnionPayloads(
  carrier: TargetTypeRef,
  payloads: readonly TargetTypeRef[],
): TargetTypeRef | undefined {
  const contract = rustRuntimeUnionContract(carrier);
  if (contract === undefined || !isDenseDataArray(payloads) || payloads.length !== contract.alternatives.length ||
    payloads.some(payload => !isRustTargetTypeRef(payload))) return undefined;
  let selected = carrier;
  if (carrier.kind === "target-named" && carrier.id === rustJsPromiseResolutionTargetId) {
    selected = { ...carrier, genericArguments: rustTypeGenericArguments([payloads[0]!]) };
  }
  const result = rustRuntimeUnionContract(selected);
  return result === undefined || result.alternatives.some((alternative, index) =>
    !rustTargetTypeRefEquals(alternative.carrier, payloads[index])) ? undefined : snapshotClosedMetadata(selected);
}

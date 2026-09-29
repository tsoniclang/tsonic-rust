import type { TargetTypeRef } from "../model.js";
import { rustTargetTypeRefEquals } from "../equality.js";
import { rustJsIntlGroupingTargetId, rustJsNumericTargetId, rustJsStringNumberTargetId } from "./source-types.js";
import { rustBigIntTargetType, rustSourcePrimitiveTargetType, rustStringTargetType } from "./native.js";

export type RustRuntimeUnionVariant =
  | { readonly kind: "payload"; readonly name: string }
  | { readonly kind: "constant"; readonly name: string; readonly value: boolean };

export interface RustRuntimeUnionContract {
  readonly typeofMethod: string;
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
  return carrier?.kind === "target-named" && (carrier.genericArguments?.length ?? 0) === 0
    ? contracts.get(carrier.id)
    : undefined;
}

export function rustRuntimeUnionProjection(source: TargetTypeRef, selected: TargetTypeRef): RustRuntimeUnionVariant | undefined {
  return rustRuntimeUnionContract(source)?.alternatives.find(alternative =>
    rustTargetTypeRefEquals(alternative.carrier, selected))?.variant;
}

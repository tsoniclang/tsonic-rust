import type { TargetTypeRef } from "../model.js";
import { rustTargetTypeRefEquals } from "../equality.js";
import { rustJsIntlGroupingTargetId, rustJsNumericTargetId } from "./source-types.js";
import { rustBigIntTargetType, rustSourcePrimitiveTargetType, rustStringTargetType } from "./native.js";

export interface RustRuntimeUnionContract {
  readonly typeofMethod: string;
  readonly alternatives: readonly {
    readonly carrier: TargetTypeRef;
    readonly projectionMethod: string;
  }[];
}

const contracts: ReadonlyMap<string, RustRuntimeUnionContract> = new Map<string, RustRuntimeUnionContract>([
  [rustJsNumericTargetId, Object.freeze({
    typeofMethod: "type_of",
    alternatives: Object.freeze([
      Object.freeze({ carrier: rustSourcePrimitiveTargetType("float64"), projectionMethod: "as_number" }),
      Object.freeze({ carrier: rustBigIntTargetType(), projectionMethod: "as_bigint" }),
    ]),
  })],
  [rustJsIntlGroupingTargetId, Object.freeze({
    typeofMethod: "type_of",
    alternatives: Object.freeze([
      Object.freeze({ carrier: rustSourcePrimitiveTargetType("bool"), projectionMethod: "as_bool" }),
      Object.freeze({ carrier: rustStringTargetType(), projectionMethod: "as_string" }),
    ]),
  })],
]);

export function rustRuntimeUnionContract(carrier: TargetTypeRef | undefined): RustRuntimeUnionContract | undefined {
  return carrier?.kind === "target-named" && (carrier.genericArguments?.length ?? 0) === 0
    ? contracts.get(carrier.id)
    : undefined;
}

export function rustRuntimeUnionProjection(source: TargetTypeRef, selected: TargetTypeRef): string | undefined {
  return rustRuntimeUnionContract(source)?.alternatives.find(alternative =>
    rustTargetTypeRefEquals(alternative.carrier, selected))?.projectionMethod;
}

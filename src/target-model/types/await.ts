import type { TargetTypeRef } from "./model.js";
import { rustFutureOutputCarrier } from "./carriers/primitives.js";
import { rustOptionElementCarrier } from "./carriers/optional.js";
import { isRustUnitCarrier } from "./carriers/js.js";
import { rustSourceOptionalTargetType } from "./projections.js";

export interface RustAwaitCarrier {
  readonly futureCarrier: TargetTypeRef;
  readonly outputCarrier: TargetTypeRef;
  readonly resultCarrier: TargetTypeRef;
  readonly optional: boolean;
}

export function rustAwaitCarrier(carrier: TargetTypeRef | undefined): RustAwaitCarrier | undefined {
  if (carrier === undefined) return undefined;
  const optional = rustOptionElementCarrier(carrier);
  const futureCarrier = optional ?? carrier;
  const outputCarrier = rustFutureOutputCarrier(futureCarrier);
  return outputCarrier === undefined ? undefined : {
    futureCarrier, outputCarrier, optional: optional !== undefined,
    resultCarrier: optional === undefined || isRustUnitCarrier(outputCarrier)
      ? outputCarrier : rustSourceOptionalTargetType(outputCarrier),
  };
}

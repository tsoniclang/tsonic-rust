import type { TargetTypeRef } from "../../types/model.js";
import type { RustUnionArmMapping, RustUnionPathStep } from "../../types/union-relations.js";
import type { RustRuntimeUnionVariant } from "../../types/carriers/runtime-unions.js";

export interface RustUnionProjectionEmission {
  readonly dispatchCarrier: TargetTypeRef;
  readonly carrier: TargetTypeRef;
  readonly variant: RustRuntimeUnionVariant;
  readonly path: readonly RustUnionPathStep[];
  readonly sourceOptional: boolean;
  readonly targetOptional: boolean;
  readonly exhaustive: boolean;
}

export interface RustUnionMappingEmission {
  readonly arms: readonly RustUnionArmMapping[];
  readonly sourceOptional: boolean;
  readonly targetOptional: boolean;
  readonly excluded: boolean;
}

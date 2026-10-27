import type { TargetTypeRef } from "../types/model.js";
import type { RustProjectUpcastFact } from "../records/objects/value-projections.js";

import { type RustUnionArmMapping } from "../types/union-relations.js";

export type RustProjectUpcastRelation = (source: TargetTypeRef, target: TargetTypeRef) =>
  "related" | "unrelated" | "ambiguous";

export interface RustProjectUnionMapArm extends RustUnionArmMapping {
  readonly upcast: Pick<RustProjectUpcastFact, "sourceCarrier" | "targetCarrier"> | null;
}

export interface RustProjectUnionMapConversion {
  readonly kind: "project-union-map";
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
  readonly arms: readonly RustProjectUnionMapArm[];
}

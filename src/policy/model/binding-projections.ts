import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustBindingValueProjectionFact } from "../../target-model/records/objects/value-projections.js";

export interface RustBindingProjectionPolicyInput {
  readonly fact: RustBindingValueProjectionFact;
  readonly traits: ReadonlyMap<TargetTypeRef, { readonly copy: boolean; readonly clone: boolean }>;
}

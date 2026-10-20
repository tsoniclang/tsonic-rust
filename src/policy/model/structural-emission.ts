import type { RustStructuralShapeDefinition } from "../../target-model/records/structural-shapes.js";

export interface RustStructuralEmissionPolicyInput {
  readonly definition: RustStructuralShapeDefinition;
  readonly clone: boolean;
  readonly copy: boolean;
  readonly default: boolean;
}

import type { RustStructuralShapeDefinition } from "../../target-model/records/structural-shapes.js";
import type { RustShapeGenericRequirementContract } from "../../target-model/records/generic-requirements.js";

export interface RustStructuralEmissionPolicyInput {
  readonly definition: RustStructuralShapeDefinition;
  readonly template: RustStructuralShapeDefinition;
  readonly genericRequirements: RustShapeGenericRequirementContract;
  readonly clone: boolean;
  readonly copy: boolean;
  readonly default: boolean;
}

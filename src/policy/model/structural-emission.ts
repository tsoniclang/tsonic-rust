import type { RustStructuralShapeDefinition } from "../../target-model/records/objects/structural-shapes.js";
import type { RustShapeGenericRequirementContract } from "../../target-model/records/types/generic-requirements.js";

export interface RustStructuralEmissionPolicyInput {
  readonly definition: RustStructuralShapeDefinition;
  readonly template: RustStructuralShapeDefinition;
  readonly genericRequirements: RustShapeGenericRequirementContract;
  readonly contextConstructors: readonly ("value" | "identity")[];
  readonly clone: boolean;
  readonly copy: boolean;
  readonly default: boolean;
}

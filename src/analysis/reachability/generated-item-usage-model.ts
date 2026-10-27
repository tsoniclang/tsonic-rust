import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetPlanningSourceNavigation } from "@tsonic/target-api/analysis";
import type { RustSourceCallableSpecializationPlan } from "../callables/generics/specializations.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations/operations.js";
import type { RustDeclarationGenericRequirementIndex } from "../declarations/generic-requirements.js";
import type { RustClassValuePlan } from "../../target-model/records/objects/class-values.js";
import type { RustStructuralShapePlan } from "../objects/shapes/structural-shape-plan.js";
import type { RustProjectFieldDispatchQueries } from "../project-types/field-dispatch.js";
import type { RustProjectMethodPropertyPlan } from "../project-types/method-properties.js";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";
import type { RustProjectTypePolicy } from "../project-types/index.js";
import type { RustAnalysisRecords } from "../../target-model/records/analysis.js";

import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { RustSourceTypeFamilyPlan } from "../../target-model/types/type-families.js";

export type RustGeneratedOperationAbi = Extract<
  RustTargetOperationFact,
  { readonly kind: "provider-operation" | "runtime-set" }
>["abi"];

export interface RustGeneratedItemUsageInput {
  readonly conversionEmission: import("../program/records/operations/conversion-emission.js").RustConversionEmissionProducer;
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly nativeNodes: readonly Node[];
  readonly declarations: readonly Node[];
  readonly records: RustAnalysisRecords;
  readonly projectTypes: RustProjectTypePolicy;
  readonly classValues: RustClassValuePlan;
  readonly sourceCallableSpecializations: RustSourceCallableSpecializationPlan;
  readonly declarationGenericRequirements: RustDeclarationGenericRequirementIndex;
  readonly typeDefinitions: RustTypeDefinitions;
  readonly typeFamilies: RustSourceTypeFamilyPlan;
  readonly objectRepresentations: RustObjectRepresentationPlan;
  readonly projectMethodProperties: RustProjectMethodPropertyPlan;
  readonly projectFieldDispatch: RustProjectFieldDispatchQueries;
  readonly structuralShapes: RustStructuralShapePlan;
  readonly navigation: TargetPlanningSourceNavigation;
}

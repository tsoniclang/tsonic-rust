import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetPlanningSourceNavigation } from "@tsonic/target-api/analysis";
import type { RustSourceCallableSpecializationPlan } from "../callables/specializations.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations.js";
import type { RustDeclarationGenericRequirementIndex } from "../declarations/generic-requirements.js";
import type { RustClassValuePlan } from "../objects/class-values.js";
import type { RustStructuralShapePlan } from "../objects/structural-shape-plan.js";
import type { RustProjectFieldDispatchQueries } from "../project-types/field-dispatch.js";
import type { RustProjectMethodPropertyPlan } from "../project-types/method-properties.js";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";
import type { RustProjectTypePolicy } from "../project-types/type-policy.js";
import type { RustAnalysisRecords } from "../program/records/model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { RustSourceTypeFamilyPlan } from "../../target-model/types/type-families.js";
import type { RustRecordContributionEvidence, RustRecordContributionFact } from "../../target-model/records/record-contributions.js";

export type RustGeneratedOperationAbi = Extract<
  RustTargetOperationFact,
  { readonly kind: "provider-operation" | "runtime-set" }
>["abi"];

export type RustDispatchMemberRole =
  | "read"
  | "write"
  | "capture"
  | "content"
  | "method-virtual"
  | "method-exact";

export type RustGeneratedProjectFieldRole =
  | "wrapper-identity"
  | "wrapper-dispatch"
  | "wrapper-state"
  | "base-state"
  | "index-storage";

export interface RustVariantReachability {
  readonly used: ReadonlySet<string>;
  readonly read: ReadonlySet<string>;
  readonly constructed: ReadonlySet<string>;
}

export interface RustStructuralReachability {
  readonly constructed: boolean;
  readonly used: boolean;
  readonly fieldsRead: ReadonlySet<number>;
  readonly fieldsWritten: ReadonlySet<number>;
  readonly variants: RustVariantReachability;
}

export interface RustGeneratedItemUsage {
  readonly usedProjectTypes: ReadonlySet<Node>;
  readonly constructedProjectTypes: ReadonlySet<Node>;
  readonly reifiedProjectTypes: ReadonlySet<Node>;
  readonly invokedProjectConstructors: ReadonlySet<Node>;
  readonly readAuthoredFields: ReadonlySet<Node>;
  readonly usedProjectFields: ReadonlyMap<Node, ReadonlySet<RustGeneratedProjectFieldRole>>;
  readonly usedDispatchMembers: ReadonlyMap<Node, ReadonlySet<RustDispatchMemberRole>>;
  readonly usedDowncasts: ReadonlyMap<Node, ReadonlySet<Node>>;
  readonly usedCheckedProjections: ReadonlySet<Node>;
  readonly structuralCarriers: ReadonlyMap<TargetTypeRef, RustStructuralReachability>;
  readonly declarationVariants: ReadonlyMap<Node, RustVariantReachability>;
  readonly recordContributions: ReadonlyMap<RustRecordContributionFact, RustRecordContributionEvidence>;
  readonly projectThisReferences: ReadonlyMap<Node, ReadonlyMap<Node, readonly Node[]>>;
}

export interface RustGeneratedItemUsageInput {
  readonly conversionEmission: import("../program/records/conversion-emission.js").RustConversionEmissionProducer;
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

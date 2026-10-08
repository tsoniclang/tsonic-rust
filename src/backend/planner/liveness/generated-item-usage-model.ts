import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetPlanningSourceNavigation } from "@tsonic/target-api/analysis";
import type { RustSourceCallableSpecializationPlan } from "../../../analysis/callables/specializations.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/operations/facts.js";
import type { RustDeclarationGenericRequirementIndex } from "../../../analysis/declarations/generic-requirements.js";
import type { RustClassValuePlan } from "../../../analysis/objects/class-values.js";
import type { RustStructuralShapePlan } from "../../../analysis/objects/structural-shape-plan.js";
import type { RustProjectFieldDispatchQueries } from "../../../analysis/project-types/field-dispatch.js";
import type { RustProjectMethodPropertyPlan } from "../../../analysis/project-types/method-properties.js";
import type { RustObjectRepresentationPlan } from "../../../analysis/project-types/object-representation.js";
import type { RustProjectTypePolicy } from "../../../analysis/project-types/type-policy.js";
import type { RustPlanQueries } from "../../../target-model/facts/selections.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import type { RustSourceTypeFamilyPlan } from "../../../target-model/types/type-families.js";

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

export interface RustGeneratedItemUsage {
  isProjectTypeUsed(declaration: Node): boolean;
  isProjectTypeConstructed(declaration: Node): boolean;
  isProjectTypeReified(declaration: Node): boolean;
  isProjectConstructorInvoked(declaration: Node): boolean;
  isAuthoredFieldRead(declaration: Node): boolean;
  isProjectGeneratedFieldUsed(
    declaration: Node,
    role: RustGeneratedProjectFieldRole,
  ): boolean;
  isDispatchMemberUsed(declaration: Node, role: RustDispatchMemberRole): boolean;
  isDowncastUsed(source: Node, target: Node): boolean;
  isCheckedProjectionUsed(source: Node): boolean;
  isStructuralFieldRead(carrier: TargetTypeRef, storageIndex: number): boolean;
  isStructuralFieldWritten(carrier: TargetTypeRef, storageIndex: number): boolean;
  isStructuralShapeConstructed(carrier: TargetTypeRef): boolean;
  isStructuralShapeUsed(carrier: TargetTypeRef): boolean;
  isVariantUsed(declaration: Node, variantName: string): boolean;
  isUnionVariantUsed(carrier: TargetTypeRef, variantName: string): boolean;
  isUnionVariantConstructed(carrier: TargetTypeRef, variantName: string): boolean;
  isVariantPayloadRead(declaration: Node, variantName: string): boolean;
  isUnionVariantPayloadRead(carrier: TargetTypeRef, variantName: string): boolean;
}

export interface RustGeneratedItemUsageInput {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly declarations: readonly Node[];
  readonly facts: RustPlanQueries;
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

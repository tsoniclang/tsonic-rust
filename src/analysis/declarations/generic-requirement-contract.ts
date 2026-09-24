import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustGenericRequirement, RustDeclarationGenericRequirementContract } from "./generic-requirements.js";

export interface RequirementUse {
  readonly node: Node;
  readonly carrier: TargetTypeRef;
  readonly requirements: readonly RustGenericRequirement[];
}

export interface RequirementContractState extends RustDeclarationGenericRequirementContract {
  readonly uses: readonly RequirementUse[];
}

export function requirementContractsEqual(
  left: RequirementContractState,
  right: RequirementContractState,
): boolean {
  return left.declaration === right.declaration &&
    left.optionalStorage.length === right.optionalStorage.length &&
    left.optionalStorage.every((entry, index) => {
      const other = right.optionalStorage[index];
      return other !== undefined && entry.captured === other.captured &&
        rustTargetTypeRefEquals(entry.carrier, other.carrier) && stringListsEqual(entry.requirements, other.requirements);
    }) &&
    left.projectProjections.length === right.projectProjections.length &&
    left.projectProjections.every((projection, index) => {
      const other = right.projectProjections[index];
      return other !== undefined && projection.requiresBound === other.requiresBound &&
        rustTargetTypeRefEquals(projection.sourceCarrier, other.sourceCarrier) &&
        rustTargetTypeRefEquals(projection.targetCarrier, other.targetCarrier);
    }) &&
    left.associatedTypes.length === right.associatedTypes.length &&
    left.associatedTypes.every((requirement, index) => {
      const other = right.associatedTypes[index];
      return other !== undefined && rustTargetTypeRefEquals(requirement.carrier, other.carrier) &&
        stringListsEqual(requirement.fieldAccess ?? [], other.fieldAccess ?? []) &&
        stringListsEqual(requirement.requirements, other.requirements);
    }) &&
    left.capturedTypeParameters.length === right.capturedTypeParameters.length &&
    left.capturedTypeParameters.every((parameter, index) => {
      const other = right.capturedTypeParameters[index];
      return other !== undefined && parameter.name === other.name &&
        stringListsEqual(parameter.requirements, other.requirements);
    }) &&
    left.typeParameters.length === right.typeParameters.length &&
    left.typeParameters.every((parameter, index) => {
      const other = right.typeParameters[index];
      return other !== undefined && parameter.name === other.name &&
        stringListsEqual(parameter.requirements, other.requirements);
    }) &&
    left.uses.length === right.uses.length &&
    left.uses.every((use, index) => {
      const other = right.uses[index];
      return other !== undefined && use.node === other.node &&
        rustTargetTypeRefEquals(use.carrier, other.carrier) &&
        stringListsEqual(use.requirements, other.requirements);
    });
}

export function stringListsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((entry, index) =>
    entry === right[index]);
}

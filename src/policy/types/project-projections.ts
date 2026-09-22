import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustProjectDowncastRoute, RustProjectTypePolicy } from "./project-types.js";
import { rustTargetTypeParameterNames } from "../../target-model/types/carriers/generic-references.js";
import { inferRustTargetTypeParameterBindings } from "../../target-model/types/carriers/generic-inference.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustProjectProjectionRequirement, RustProjectProjectionSelection } from "../../target-model/types/project-projections.js";

export interface RustProjectProjectionImplementation {
  readonly route: RustProjectDowncastRoute;
  readonly sourceCarrier: TargetTypeRef;
  readonly genericOwner?: import("./project-types.js").RustProjectTypeDefinition;
}

export function selectRustProjectProjectionImplementation(
  requirement: Pick<RustProjectProjectionRequirement, "sourceCarrier" | "targetCarrier">, route: RustProjectDowncastRoute, projectTypes: RustProjectTypePolicy,
): RustProjectProjectionImplementation | undefined {
  if (route.source === route.target) return undefined;
  const relation = projectTypes.relationship(route.targetCarrier, route.source);
  if (relation.kind !== "related") return undefined;
  const pattern: TargetTypeRef = { kind: "tuple", elements: [requirement.sourceCarrier, requirement.targetCarrier] };
  const parameters = new Set(rustTargetTypeParameterNames(pattern));
  const concrete: TargetTypeRef = { kind: "tuple", elements: [relation.targetType, route.targetCarrier] };
  return (parameters.size === 0 ? rustTargetTypeRefEquals(pattern, concrete)
    : inferRustTargetTypeParameterBindings(pattern, concrete, parameters) !== undefined)
    ? Object.freeze({ route, sourceCarrier: relation.targetType }) : undefined;
}

export function hasRustProjectProjection(
  sourceCarrier: TargetTypeRef, targetCarrier: TargetTypeRef, projectTypes: RustProjectTypePolicy,
): boolean {
  return selectRustProjectProjection(sourceCarrier, targetCarrier, projectTypes) !== undefined;
}

export function selectRustProjectProjection(
  sourceCarrier: TargetTypeRef, targetCarrier: TargetTypeRef, projectTypes: RustProjectTypePolicy,
): RustProjectProjectionSelection | undefined {
  const source = projectTypes.definitionForCarrier(sourceCarrier);
  const target = projectTypes.definitionForCarrier(targetCarrier);
  if (source === undefined || target === undefined) return undefined;
  const relationship = projectTypes.relationship(targetCarrier, source);
  if (relationship.kind !== "related" || !rustTargetTypeRefEquals(relationship.targetType, sourceCarrier)) return undefined;
  const route = projectTypes.downcastRoute(source, targetCarrier);
  if (route !== undefined) return Object.freeze({ kind: route.kind, slot: route.slot });
  const parameters = new Set(rustTargetTypeParameterNames(targetCarrier));
  return parameters.size > 0 && projectTypes.downcastRoutesFor(source).some(route => route.target === target &&
    inferRustTargetTypeParameterBindings(targetCarrier, route.targetCarrier, parameters) !== undefined)
    ? Object.freeze({ kind: "generic" }) : undefined;
}

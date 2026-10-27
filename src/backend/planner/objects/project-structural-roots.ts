import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustObjectRepresentation } from "../../../target-model/records/objects/object-representation.js";
import type { RustExpr, RustType } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustClassEnvironmentHandleType } from "./class-environment-types.js";
import { rustProjectRootType, rustProjectStateType } from "./polymorphism/names.js";
import { planRustProjectRepresentationGenerics } from "./polymorphism/names.js";
import type { RustGenerics } from "../../target-ast/syntax/nodes.js";
import { rustProjectImplementationContext, rustProjectImplementationGenerics } from "./polymorphism/implementation-generics.js";
import { rustGenericRequirementBounds, rustGenericsWithAssociatedBounds } from "../types/generic-bounds.js";
import { rustAssociatedPredicates } from "../types/associated-bounds.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import type { RustClassStructuralViewEmission } from "../../../target-model/records/objects/class-implementations.js";
import { rustLifetimeKey } from "../../../target-model/lifetimes/index.js";
import { rustLifetimeToAst } from "../types/lifetime-syntax.js";

export function rustStructuralViewImplementationContext(
  view: RustClassStructuralViewEmission, representation: RustObjectRepresentation, context: RustPlanContext,
): RustPlanContext {
  const selected = rustProjectImplementationContext(representation.definition, view.sourceCarrier, context);
  return { ...selected, lifetimeSubstitutions: new Map([...selected.lifetimeSubstitutions ?? [],
    ...view.nativeLifetimes.map(lifetime => [rustLifetimeKey(lifetime), lifetime] as const)]) };
}

export function rustStructuralViewImplementationGenerics(
  view: RustClassStructuralViewEmission, representation: RustObjectRepresentation, context: RustPlanContext,
): RustGenerics | undefined {
  const selected = planRustProjectRepresentationGenerics(representation, context);
  const generics = rustProjectImplementationGenerics(view.sourceCarrier, selected, context);
  const requirements = context.input.program.records.structuralViewRequirements.get(view);
  const inventory = context.input.program.records.classImplementationGenerics.get(view.sourceCarrier);
  if (generics === undefined || requirements === undefined || inventory === undefined) failRustPlannerInvariant("An admitted structural view requires its exact native generic inventory and requirements.", view.declaration);
  const byIdentity = new Map(requirements.typeParameters.map(parameter => [parameter.identity, parameter.requirements]));
  const parameters = generics.parameters.map((parameter, index) => {
    if (parameter.kind !== "type") return parameter;
    const source = inventory.parameters[index - inventory.lifetimes.length];
    if (source === undefined) failRustPlannerInvariant("An admitted structural view parameter requires its exact source identity.", view.declaration);
    return {
    ...parameter, bounds: [...new Map([...parameter.bounds, ...rustGenericRequirementBounds(byIdentity.get(source.identity) ?? [])]
      .map(bound => [closedMetadataKey(bound), bound])).values()],
  }; });
  const predicates = view.nativeOutlives.map(requirement => {
    const type = rustTypeFromCarrierInContext(requirement.carrier, context);
    if (type === undefined) failRustPlannerInvariant("An admitted structural getter requires its sealed native outlives carrier.", view.declaration);
    const lifetime = context.lifetimeSubstitutions?.get(rustLifetimeKey(requirement.lifetime)) ?? requirement.lifetime;
    return { kind: "type" as const, type, bounds: [{ kind: "lifetime" as const, lifetime: rustLifetimeToAst(lifetime) }] };
  });
  return rustGenericsWithAssociatedBounds([
    ...view.nativeLifetimes.map(lifetime => ({ kind: "lifetime" as const, name: lifetime.name, outlives: [] })),
    ...parameters,
  ], [...new Map([...generics.wherePredicates, ...rustAssociatedPredicates(requirements.associatedTypes, context), ...predicates]
    .map(predicate => [closedMetadataKey(predicate), predicate])).values()]);
}

export function rustStructuralViewRootType(
  carrier: TargetTypeRef, representation: RustObjectRepresentation, context: RustPlanContext,
): RustType | undefined {
  if (representation.kind === "open-hierarchy" || representation.kind === "closed-hierarchy") {
    return rustProjectRootType(carrier, context);
  }
  if (representation.kind === "value") return undefined;
  const state = rustProjectStateType(carrier, context);
  const environment = context.input.program.records.classEnvironment.get(representation.definition.declaration)?.environment;
  const captures = environment?.instancesUseEnvironment ? rustClassEnvironmentHandleType(carrier, context) : undefined;
  if (state === undefined || environment?.instancesUseEnvironment && captures === undefined) return undefined;
  return { kind: "named", path: representation.kind === "shared-immutable" ? "rt::ObjectRefState" : "rt::ObjectHandleState",
    genericArguments: [{ kind: "type", type: state }, ...(captures === undefined ? [] : [{ kind: "type" as const, type: captures }])],
  };
}

export function rustStructuralViewIntoRoot(
  receiver: RustExpr, representation: RustObjectRepresentation,
): RustExpr | undefined {
  if (representation.kind === "open-hierarchy" || representation.kind === "closed-hierarchy") {
    return { kind: "field", receiver, name: "dispatch" };
  }
  return representation.kind === "value" ? undefined : { kind: "method-call",
    receiver: { kind: "field", receiver, name: "state" }, method: "into_shared", args: [],
  };
}

export function rustStructuralViewInstance(
  receiver: RustExpr, carrier: TargetTypeRef, representation: RustObjectRepresentation, context: RustPlanContext,
): RustExpr | undefined {
  const type = rustTypeFromCarrierInContext(carrier, context);
  if (type?.kind !== "named" || representation.kind !== "shared-immutable" && representation.kind !== "shared-mutable") return undefined;
  return { kind: "struct-literal", path: type.path, fields: [{ name: "state", value: {
    kind: "call", path: representation.kind === "shared-immutable" ? "rt::ObjectRef::from_shared" : "rt::ObjectHandle::from_shared",
    args: [receiver],
  } }] };
}

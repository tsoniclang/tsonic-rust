import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustObjectRepresentation } from "../../../analysis/project-types/object-representation.js";
import type { RustExpr, RustType } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustClassEnvironmentHandleType } from "./class-environments.js";
import { rustProjectRootType, rustProjectStateType } from "./polymorphism/names.js";
import { rustProjectRepresentationGenerics } from "./polymorphism/names.js";
import type { RustGenerics, RustWherePredicate } from "../../target-ast/nodes.js";
import { projectTypeSubstitutions, projectLifetimeSubstitutions } from "./polymorphism/model.js";
import { rustTargetGenericReferences } from "../../../target-model/types/index.js";
import { rustLifetimeToAst } from "../types/lifetime-syntax.js";
import { rustLifetimeKey } from "../../../target-model/lifetimes/index.js";

export function rustStructuralViewImplementationContext(
  carrier: TargetTypeRef, representation: RustObjectRepresentation, context: RustPlanContext,
): RustPlanContext {
  return { ...context, typeParameterSubstitutions: projectTypeSubstitutions(representation.definition, carrier),
    lifetimeSubstitutions: projectLifetimeSubstitutions(representation.definition, carrier) };
}

export function rustStructuralViewImplementationGenerics(
  carrier: TargetTypeRef, representation: RustObjectRepresentation, context: RustPlanContext,
): RustGenerics | undefined {
  const selected = rustProjectRepresentationGenerics(representation, context);
  const references = rustTargetGenericReferences(carrier);
  if (references.constIdentities.length !== 0 || references.lifetimes.some(lifetime => lifetime.kind !== "parameter")) return undefined;
  const predicates: RustWherePredicate[] = [...selected.wherePredicates];
  for (const [index, parameter] of selected.parameters.entries()) {
    const declared = representation.definition.genericParameters[index];
    if (declared === undefined) return undefined;
    if (parameter.kind === "type" && declared.kind === "type") {
      const argument = context.typeParameterSubstitutions?.get(declared.sourceName);
      const type = argument === undefined ? undefined : rustTypeFromCarrierInContext(argument, context);
      if (type === undefined) return undefined;
      if (parameter.bounds.length !== 0) predicates.push({ kind: "type", type, bounds: parameter.bounds });
    } else if (parameter.kind === "lifetime" && declared.kind === "lifetime") {
      const selectedLifetime = context.lifetimeSubstitutions?.get(rustLifetimeKey(declared.lifetime));
      if (selectedLifetime === undefined) return undefined;
      if (parameter.outlives.length !== 0) predicates.push({ kind: "lifetime", lifetime: rustLifetimeToAst(selectedLifetime), outlives: parameter.outlives });
    } else return undefined;
  }
  return { parameters: [
    ...references.lifetimes.filter(lifetime => lifetime.kind === "parameter").map(lifetime => ({ kind: "lifetime" as const, name: lifetime.name, outlives: [] })),
    ...references.typeNames.map(name => ({ kind: "type" as const, name, bounds: [] })),
  ], wherePredicates: predicates };
}

export function rustStructuralViewRootType(
  carrier: TargetTypeRef, representation: RustObjectRepresentation, context: RustPlanContext,
): RustType | undefined {
  if (representation.kind === "open-hierarchy" || representation.kind === "closed-hierarchy") {
    return rustProjectRootType(carrier, context);
  }
  if (representation.kind === "value") return undefined;
  const state = rustProjectStateType(carrier, context);
  const environment = context.input.program.classValues.forDeclaration(representation.definition.declaration)?.environment;
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

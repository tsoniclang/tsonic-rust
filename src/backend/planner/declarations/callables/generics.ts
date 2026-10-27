import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustGenericsWithAssociatedBounds, rustTypeParameterBounds } from "../../types/generic-bounds.js";
import { rustLifetimeKey } from "../../../../target-model/lifetimes/index.js";
import { type RustGenerics, type RustGenericParameter, type RustTypeBound } from "../../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { isValidRustIdentifier } from "../../../../target-model/names/identifiers.js";
import { rustLifetimeToAst } from "../../types/lifetime-syntax.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustProjectProjectionPredicates } from "../../types/project-projection-bounds.js";
import { rustOptionalStorageParameters } from "../../types/type-projections.js";
import { planRustNativeCallableGenerics } from "./native-generics.js";
import { planRustRetainedGenerics } from "./retained-generics.js";
import type { RustCallableEntryHeaderSelection, RustCallableEntryHeaderVariant } from "../../../../target-model/records/callables/callable-entry-headers.js";

export interface RustCallableGenericPlan {
  readonly context: RustPlanContext;
  readonly selection: RustCallableEntryHeaderSelection;
  readonly preservesExplicitLifetimes: boolean;
  readonly sourceTypeParameterIdentities: readonly string[];
  readonly parameterSlots: ReadonlyMap<string, number>;
  finalizeGenerics(): RustGenerics;
}

export function rustCallableSpecialization(identities: readonly string[], arguments_: readonly TargetTypeRef[]): ReadonlyMap<string, TargetTypeRef> | undefined {
  return identities.length === arguments_.length ? new Map(identities.map((identity, index) => [identity, arguments_[index]!] as const)) : undefined;
}

export function rustSourceDeclarationGenerics(
  contract: import("../../../../target-model/lifetimes/model.js").RustSourceGenericContract,
): RustGenerics {
  if (contract.lifetimeBinder !== undefined) failRustPlannerInvariant("An admitted item generic contract cannot retain a higher-ranked binder.", contract.declaration);
  const parameters: RustGenericParameter[] = [];
  for (const parameter of contract.parameters) {
    if (parameter.kind === "lifetime") {
      if (parameter.lifetime.kind !== "parameter") failRustPlannerInvariant("An admitted item lifetime requires its named native binder.", contract.declaration);
      parameters.push({ kind: "lifetime", name: parameter.lifetime.name,
        outlives: Object.freeze(parameter.outlives.map(rustLifetimeToAst)) });
      continue;
    }
    if (!isValidRustIdentifier(parameter.targetName)) failRustPlannerInvariant("An admitted item type parameter requires its native identifier.", contract.declaration);
    parameters.push({ kind: "type", name: parameter.targetName, bounds: Object.freeze([
      ...parameter.outlives.map((lifetime): RustTypeBound => ({ kind: "lifetime", lifetime: rustLifetimeToAst(lifetime) })),
      ...(parameter.maybeSized ? [{ kind: "maybe-sized" as const }] : []),
    ]) });
  }
  return Object.freeze({ parameters: Object.freeze(parameters), wherePredicates: Object.freeze([]) });
}

export function planRustCallableGenerics(
  declaration: Node,
  context: RustPlanContext,
  variant: RustCallableEntryHeaderVariant | undefined,
): RustCallableGenericPlan {
  const facets = context.input.program.records.callableLeading.get(declaration)?.headerSelections.get(
    context.nativeHeaderPlacement, variant, context.nativeHeaderParent);
  if (facets === undefined) failRustPlannerInvariant("An emitted callable requires its exact selected placement and enclosing body header.", declaration);
  const selected = context.promiseBody === true ? facets.body : facets.source;
  const native = context.input.program.records.nativeGenerics.get(declaration);
  if (native === undefined) failRustPlannerInvariant("An emitted callable requires its sealed native generic bounds.", declaration);
  const requirements = selected.promiseBody ? native.bodyRequirements : native.sourceRequirements;
  const typeParameterNames = new Map(context.typeParameterNames);
  for (const [identity, name] of selected.typeNames) typeParameterNames.set(identity, name);
  const scoped: RustPlanContext = { ...context, callableDeclaration: declaration, typeParameterNames,
    typeParameterSubstitutions: selected.bindings.types, lifetimeSubstitutions: selected.bindings.lifetimes,
    nativeHeaderPlacement: selected, nativeHeaderParent: selected };
  const requirementsByIdentity = new Map([...(requirements?.typeParameters ?? []), ...(requirements?.capturedTypeParameters ?? [])]
    .map(parameter => [parameter.identity, parameter.requirements] as const));
  const parameterSlots = new Map<string, number>();
  const parameters = selected.parameters.map((parameter, index): RustGenericParameter => {
    parameterSlots.set(parameter.kind === "type" ? parameter.identity : rustLifetimeKey(parameter.lifetime), index);
    if (parameter.kind === "lifetime") {
      if (parameter.lifetime.kind !== "parameter") failRustPlannerInvariant("A selected native item lifetime requires its named binder.", declaration);
      return { kind: "lifetime", name: parameter.lifetime.name, outlives: parameter.outlives.map(rustLifetimeToAst) };
    }
    const required = requirementsByIdentity.get(parameter.identity);
    const name = typeParameterNames.get(parameter.identity);
    if (required === undefined || name === undefined) failRustPlannerInvariant("A selected native type binder requires its exact name and completed bounds.", declaration);
    return { kind: "type", name, bounds: rustTypeParameterBounds(parameter, required) };
  });
  const generics = rustGenericsWithAssociatedBounds([...parameters, ...rustOptionalStorageParameters(selected.optionalStorage, scoped)],
    requirements === undefined || !selected.preservesSourceRequirements ? [] : rustProjectProjectionPredicates(requirements.projectProjections, scoped));
  const source: RustCallableGenericPlan = { context: scoped, selection: selected,
    preservesExplicitLifetimes: selected.preservesExplicitLifetimes,
    sourceTypeParameterIdentities: selected.sourceTypeParameterIdentities, parameterSlots, finalizeGenerics: () => generics };
  return planRustRetainedGenerics(declaration, planRustNativeCallableGenerics(declaration, source));
}

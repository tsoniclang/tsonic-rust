import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSourceGenericIndex } from "./source-generics.js";
import type {
  RustProviderTypeRequirement,
  RustProviderTypeParameterRequirement,
  RustResolvedProviderRequirementSourceInput,
  RustResolvedProviderTypeParameterRequirement,
} from "../../target-model/operations/model.js";
import {
  rustLifetimeSemanticKey,
  rustSemanticIdentitiesEqual,
  rustBoundSemanticKey,
  rustTypeSemanticKey,
} from "../../target-model/semantics/index.js";
import {
  substituteRustBound,
  type RustGenericSubstitutions,
  type RustTraitSupportQueries,
  type RustTypeParameterTraitResolver,
} from "../../target-model/types/index.js";
import {
  rustTargetTypeRefEquals,
  rustTraitReferenceEquals,
} from "../../target-model/types/equality.js";
import type {
  RustCapturedGeneric,
  RustGenericArgument,
  RustLifetimeRef,
  RustTypeRef,
} from "../../target-model/semantics/index.js";

export function resolveRustProviderGenericRequirements(
  requirements: readonly RustProviderTypeParameterRequirement[] | undefined,
  bindings: ReadonlyMap<string, TargetTypeRef>,
  substitutions: RustGenericSubstitutions,
  sourceInputsByName: ReadonlyMap<
    string,
    readonly RustResolvedProviderRequirementSourceInput[]
  > = new Map(),
): readonly RustResolvedProviderTypeParameterRequirement[] | undefined {
  const resolved: RustResolvedProviderTypeParameterRequirement[] = [];
  for (const parameter of requirements ?? []) {
    const carrier = bindings.get(parameter.name);
    if (carrier === undefined) return undefined;
    const resolvedBounds: RustProviderTypeRequirement[] = [];
    for (const requirement of parameter.requirements) {
      const bound = substituteRustBound(requirement, substitutions);
      if (bound.kind === "associated-equality") {
        const associatedType = substitutions.associatedTypes.get(
          rustTypeSemanticKey(bound.projection),
        );
        if (associatedType !== undefined) {
          if (!rustTargetTypeRefEquals(associatedType, bound.value)) return undefined;
          continue;
        }
      }
      resolvedBounds.push(bound);
    }
    resolvedBounds.sort((left, right) => compareText(
      rustBoundSemanticKey(left),
      rustBoundSemanticKey(right),
    ));
    const uniqueBounds = resolvedBounds.filter((bound, index) =>
      index === 0 || rustBoundSemanticKey(bound) !==
        rustBoundSemanticKey(resolvedBounds[index - 1]!));
    if (uniqueBounds.length === 0) continue;
    const sourceInputs = canonicalRequirementSourceInputs(
      sourceInputsByName.get(parameter.name) ?? [],
    );
    resolved.push(Object.freeze({
      sourceName: parameter.name,
      carrier,
      sourceInputs,
      requirements: Object.freeze(uniqueBounds),
    }));
  }
  resolved.sort((left, right) => compareText(left.sourceName, right.sourceName));
  return Object.freeze(resolved);
}

function canonicalRequirementSourceInputs(
  inputs: readonly RustResolvedProviderRequirementSourceInput[],
): readonly RustResolvedProviderRequirementSourceInput[] {
  const receiver = inputs.some((input) => input.kind === "receiver");
  const argumentIndexes = [...new Set(inputs.flatMap((input) =>
    input.kind === "argument" ? [input.sourceIndex] : []))].sort((left, right) => left - right);
  return Object.freeze([
    ...(receiver ? [Object.freeze({ kind: "receiver" as const })] : []),
    ...argumentIndexes.map((sourceIndex) => Object.freeze({
      kind: "argument" as const,
      sourceIndex,
    })),
  ]);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function rustResolvedProviderRequirementKey(
  requirement: Pick<
    RustResolvedProviderTypeParameterRequirement,
    "sourceName" | "carrier" | "sourceInputs"
  >,
  bound: RustProviderTypeRequirement,
): string {
  const sources = requirement.sourceInputs.map((source) => source.kind === "receiver"
    ? "receiver"
    : `argument:${source.sourceIndex}`).join(",");
  return `${requirement.sourceName}\0${rustTypeSemanticKey(requirement.carrier)}\0${sources}\0${rustBoundSemanticKey(bound)}`;
}

export function rustResolvedProviderTypeRequirementsAreSatisfied(
  requirements: readonly RustResolvedProviderTypeParameterRequirement[],
  sourceGenerics: RustSourceGenericIndex,
  traits: RustTraitSupportQueries,
): boolean {
  const typeParameterSupports = sourceTypeParameterTraitResolver(sourceGenerics);
  return requirements.every((requirement) => requirement.requirements.every((bound) => {
    switch (bound.kind) {
      case "trait":
        return bound.polarity === "maybe" || bound.polarity === "required" &&
          traits.supportsTraitBound(requirement.carrier, bound, typeParameterSupports);
      case "lifetime-outlives":
        return sourceLifetimeOutlives(sourceGenerics, bound.longer, bound.shorter);
      case "type-outlives":
        return providerTypeOutlives(
          bound.type,
          bound.lifetime,
          sourceGenerics,
        );
      case "associated-equality":
        return false;
    }
  }));
}

function sourceTypeParameterTraitResolver(
  sourceGenerics: RustSourceGenericIndex,
): RustTypeParameterTraitResolver {
  return (identity, trait) => sourceGenerics.allContracts().some((contract) =>
    contract.parameters.some((parameter) => parameter.parameter.kind === "type" &&
      rustSemanticIdentitiesEqual(parameter.parameter.identity, identity) &&
      parameter.parameter.bounds.some((bound) => bound.kind === "trait" &&
        bound.polarity === "required" && bound.binder === undefined &&
        rustTraitReferenceEquals(bound.trait, trait))));
}

function providerTypeOutlives(
  type: RustTypeRef,
  lifetime: RustLifetimeRef,
  sourceGenerics: RustSourceGenericIndex,
): boolean {
  switch (type.kind) {
    case "source-primitive":
    case "primitive":
    case "never":
    case "unit":
    case "str":
    case "function-pointer":
    case "raw-pointer":
      return true;
    case "reference":
      return sourceLifetimeOutlives(sourceGenerics, type.lifetime, lifetime) &&
        providerTypeOutlives(type.target, lifetime, sourceGenerics);
    case "tuple":
      return type.elements.every((element) =>
        providerTypeOutlives(element, lifetime, sourceGenerics));
    case "array":
    case "sequence":
    case "slice":
      return providerTypeOutlives(type.element, lifetime, sourceGenerics);
    case "path":
      return type.arguments.every((argument) =>
        genericArgumentOutlives(argument, lifetime, sourceGenerics));
    case "type-parameter":
      return sourceGenerics.allContracts().some((contract) =>
        contract.parameters.some((parameter) => parameter.parameter.kind === "type" &&
          rustSemanticIdentitiesEqual(parameter.parameter.identity, type.identity) &&
          parameter.parameter.bounds.some((bound) => bound.kind === "type-outlives" &&
            bound.type.kind === "type-parameter" &&
            rustSemanticIdentitiesEqual(bound.type.identity, type.identity) &&
            sourceLifetimeOutlives(sourceGenerics, bound.lifetime, lifetime))));
    case "trait-object":
      return sourceLifetimeOutlives(sourceGenerics, type.lifetime, lifetime);
    case "opaque":
      return type.captures.every((capture) =>
        capturedGenericOutlives(capture, lifetime, sourceGenerics));
    case "closure":
    case "source-carrier":
    case "associated-type":
    case "self":
    case "inference-variable":
      return false;
  }
}

function capturedGenericOutlives(
  capture: RustCapturedGeneric,
  lifetime: RustLifetimeRef,
  sourceGenerics: RustSourceGenericIndex,
): boolean {
  switch (capture.kind) {
    case "const": return true;
    case "lifetime":
      return sourceLifetimeOutlives(sourceGenerics, capture.value, lifetime);
    case "type":
      return sourceTypeParameterOutlives(
        sourceGenerics,
        capture.identity,
        lifetime,
      );
  }
}

function sourceTypeParameterOutlives(
  sourceGenerics: RustSourceGenericIndex,
  identity: import("../../target-model/semantics/index.js").RustSemanticIdentity,
  lifetime: RustLifetimeRef,
): boolean {
  return sourceGenerics.allContracts().some((contract) => contract.parameters.some((parameter) =>
    parameter.parameter.kind === "type" &&
    rustSemanticIdentitiesEqual(parameter.parameter.identity, identity) &&
    parameter.parameter.bounds.some((bound) => bound.kind === "type-outlives" &&
      bound.type.kind === "type-parameter" &&
      rustSemanticIdentitiesEqual(bound.type.identity, identity) &&
      sourceLifetimeOutlives(sourceGenerics, bound.lifetime, lifetime))));
}

function genericArgumentOutlives(
  argument: RustGenericArgument,
  lifetime: RustLifetimeRef,
  sourceGenerics: RustSourceGenericIndex,
): boolean {
  switch (argument.kind) {
    case "const": return true;
    case "lifetime":
      return sourceLifetimeOutlives(sourceGenerics, argument.value, lifetime);
    case "type":
      return providerTypeOutlives(argument.value, lifetime, sourceGenerics);
  }
}

function sourceLifetimeOutlives(
  sourceGenerics: RustSourceGenericIndex,
  longer: RustLifetimeRef,
  shorter: RustLifetimeRef,
): boolean {
  return longer.kind === "static" ||
    rustLifetimeSemanticKey(longer) === rustLifetimeSemanticKey(shorter) ||
    sourceGenerics.lifetimeOutlives(longer, shorter);
}

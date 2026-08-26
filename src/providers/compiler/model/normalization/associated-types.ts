import {
  compilerTypeSupportsRequirement,
  directImplementationTypeParameterPositions,
  normalizeType,
  sourceVisibleTypeParameterCount,
  substituteRustCompilerTrait,
  substituteRustCompilerType,
  typeParameterGuaranteesRequirement,
  typeRequirementKey,
} from "../rustdoc-types.js";
import { compareText } from "../rustdoc-schema.js";
import type {
  RustCompilerDependency,
  RustCompilerGenericParameter,
  RustCompilerItemIdentity,
  RustCompilerGenericArgument,
  RustCompilerTraitDispatch,
  RustCompilerType,
  RustCompilerTypeParameter,
  RustCompilerTypeRequirement,
} from "../model.js";
import type { RustdocItemResolver } from "../rustdoc-items.js";
import type { RustCompilerSubstitutions } from "../rustdoc-types.js";
import type { RustdocDocument } from "../rustdoc-schema.js";
import type { RustCompilerNormalizationContext } from "../rustdoc-types.js";

export function normalizeMemberType(
  document: RustdocDocument,
  raw: unknown,
  context: RustCompilerNormalizationContext,
  implementationBindings: RustCompilerSubstitutions,
  associatedTypeBindings: ReadonlyMap<string, RustCompilerType>,
  currentTrait: RustCompilerTraitDispatch | undefined,
): RustCompilerType {
  return substituteAssociatedTypes(
    substituteRustCompilerType(normalizeType(document, raw, context), implementationBindings),
    associatedTypeBindings,
    currentTrait,
  );
}

export function substituteTraitDispatch(
  trait: RustCompilerTraitDispatch,
  bindings: RustCompilerSubstitutions,
): RustCompilerTraitDispatch {
  return substituteRustCompilerTrait(trait, bindings);
}

export function associatedTypeKey(
  traitIdentity: string,
  associatedIdentity: string,
): string {
  return `${traitIdentity}\0${associatedIdentity}`;
}

export function sourceImplementationRequirements(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  impl: Readonly<Record<string, unknown>>,
  implementationParameters: readonly RustCompilerTypeParameter[],
  implementationContext: RustCompilerNormalizationContext,
  declaredGenericParameters: readonly RustCompilerGenericParameter[],
  ownerIdentity: RustCompilerItemIdentity,
  resolveItem?: RustdocItemResolver,
): readonly RustCompilerTypeParameter[] | undefined {
  const positions = directImplementationTypeParameterPositions(
    document,
    impl,
    implementationContext,
    declaredGenericParameters,
    ownerIdentity,
  );
  if (positions === undefined) return undefined;
  const declaredTypeParameters = declaredGenericParameters.filter(
    (parameter): parameter is RustCompilerTypeParameter => parameter.kind === "type",
  );
  const sourceTypeArgumentCount = sourceVisibleTypeParameterCount(declaredGenericParameters);
  const requirements = new Map<string, Map<string, RustCompilerTypeRequirement>>();
  for (const parameter of implementationParameters) {
    const typeArgumentIndex = positions.get(parameter.identity.itemId);
    if (typeArgumentIndex === undefined) {
      if (parameter.requirements.length !== 0) return undefined;
      continue;
    }
    const declared = declaredTypeParameters[typeArgumentIndex];
    if (declared === undefined) return undefined;
    for (const requirement of parameter.requirements) {
      if (typeParameterGuaranteesRequirement(declared, requirement)) continue;
      if (typeArgumentIndex < sourceTypeArgumentCount) {
        const selected = requirements.get(declared.identity.itemId) ??
          new Map<string, RustCompilerTypeRequirement>();
        selected.set(typeRequirementKey(requirement), requirement);
        requirements.set(declared.identity.itemId, selected);
        continue;
      }
      if (declared.defaultType === undefined || !compilerTypeSupportsRequirement(
        document,
        dependency,
        declared.defaultType,
        requirement,
        new Set(),
        resolveItem,
      )) {
        return undefined;
      }
    }
  }
  return Object.freeze([...requirements.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([identity, selected]) => {
      const declared = declaredTypeParameters.find((parameter) => parameter.identity.itemId === identity);
      if (declared === undefined) {
        throw new Error(`Rust implementation requirement '${identity}' has no exact declared parameter.`);
      }
      return Object.freeze({
        ...declared,
        requirements: Object.freeze([...selected.entries()]
          .sort(([left], [right]) => compareText(left, right))
          .map(([, requirement]) => requirement)),
      });
    }));
}

function substituteAssociatedTypes(
  type: RustCompilerType,
  bindings: ReadonlyMap<string, RustCompilerType>,
  currentTrait: RustCompilerTraitDispatch | undefined,
): RustCompilerType {
  if (type.kind === "associated-type") {
    const dispatch = type.trait.genericArguments.length === 0 &&
      type.trait.associatedConstraints.length === 0 &&
      currentTrait?.identity.itemId === type.trait.identity.itemId
      ? currentTrait
      : type.trait;
    const selected = type.owner.kind === "self"
      ? bindings.get(associatedTypeKey(dispatch.identity.itemId, type.identity.itemId))
      : undefined;
    if (selected !== undefined) {
      return substituteAssociatedTypes(selected, bindings, currentTrait);
    }
    return Object.freeze({
      ...type,
      owner: substituteAssociatedTypes(type.owner, bindings, currentTrait),
      trait: mapTraitAssociatedTypes(dispatch, bindings, currentTrait),
      genericArguments: Object.freeze(type.genericArguments.map((argument) =>
        mapArgumentAssociatedTypes(argument, bindings, currentTrait))),
    });
  }
  switch (type.kind) {
    case "unit":
    case "primitive":
    case "generic":
    case "self":
      return type;
    case "tuple":
      return Object.freeze({
        ...type,
        elements: Object.freeze(type.elements.map((element) =>
          substituteAssociatedTypes(element, bindings, currentTrait))),
      });
    case "array":
    case "slice":
      return Object.freeze({
        ...type,
        element: substituteAssociatedTypes(type.element, bindings, currentTrait),
      });
    case "reference":
    case "raw-pointer":
      return Object.freeze({
        ...type,
        target: substituteAssociatedTypes(type.target, bindings, currentTrait),
      });
    case "function-pointer":
      return Object.freeze({
        ...type,
        parameters: Object.freeze(type.parameters.map((parameter) =>
          substituteAssociatedTypes(parameter, bindings, currentTrait))),
        result: substituteAssociatedTypes(type.result, bindings, currentTrait),
      });
    case "trait-object":
      return Object.freeze({
        ...type,
        principal: mapTraitAssociatedTypes(type.principal, bindings, currentTrait),
        autoTraits: Object.freeze(type.autoTraits.map((trait) =>
          mapTraitAssociatedTypes(trait, bindings, currentTrait))),
      });
    case "opaque":
      return Object.freeze({
        ...type,
        bounds: Object.freeze(type.bounds.map((trait) =>
          mapTraitAssociatedTypes(trait, bindings, currentTrait))),
        captures: Object.freeze(type.captures.map((argument) =>
          mapArgumentAssociatedTypes(argument, bindings, currentTrait))),
      });
    case "path":
      return Object.freeze({
        ...type,
        genericArguments: Object.freeze(type.genericArguments.map((argument) =>
          mapArgumentAssociatedTypes(argument, bindings, currentTrait))),
      });
  }
}

function mapArgumentAssociatedTypes(
  argument: RustCompilerGenericArgument,
  bindings: ReadonlyMap<string, RustCompilerType>,
  currentTrait: RustCompilerTraitDispatch | undefined,
): RustCompilerGenericArgument {
  return argument.kind === "type"
    ? Object.freeze({
        kind: "type",
        type: substituteAssociatedTypes(argument.type, bindings, currentTrait),
      })
    : argument;
}

function mapTraitAssociatedTypes(
  trait: RustCompilerTraitDispatch,
  bindings: ReadonlyMap<string, RustCompilerType>,
  currentTrait: RustCompilerTraitDispatch | undefined,
): RustCompilerTraitDispatch {
  return Object.freeze({
    ...trait,
    genericArguments: Object.freeze(trait.genericArguments.map((argument) =>
      mapArgumentAssociatedTypes(argument, bindings, currentTrait))),
    associatedConstraints: Object.freeze(trait.associatedConstraints.map((constraint) =>
      constraint.kind === "equality"
        ? Object.freeze({
            ...constraint,
            genericArguments: Object.freeze(constraint.genericArguments.map((argument) =>
              mapArgumentAssociatedTypes(argument, bindings, currentTrait))),
            type: substituteAssociatedTypes(constraint.type, bindings, currentTrait),
          })
        : Object.freeze({
            ...constraint,
            genericArguments: Object.freeze(constraint.genericArguments.map((argument) =>
              mapArgumentAssociatedTypes(argument, bindings, currentTrait))),
            traits: Object.freeze(constraint.traits.map((selected) =>
              mapTraitAssociatedTypes(selected, bindings, currentTrait))),
          }))),
  });
}

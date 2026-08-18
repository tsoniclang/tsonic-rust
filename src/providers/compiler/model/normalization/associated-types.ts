import {
  compilerTypeSupportsRequirement,
  directImplementationTypeParameterPositions,
  normalizeType,
  normalizeTraitDispatch,
  sourceVisibleTypeParameterCount,
  substituteRustCompilerType,
  typeParameterGuaranteesRequirement,
  typeRequirementKey,
} from "../rustdoc-types.js";
import { compareText } from "../rustdoc-schema.js";
import type { RustCompilerType, RustCompilerTypeParameter, RustCompilerTypeRequirement } from "../model.js";
import type { RustdocDocument } from "../rustdoc-schema.js";

export function normalizeMemberType(
  document: RustdocDocument,
  raw: unknown,
  implementationBindings: ReadonlyMap<string, RustCompilerType>,
  associatedTypeBindings: ReadonlyMap<string, RustCompilerType>,
  currentTrait: ReturnType<typeof normalizeTraitDispatch> | undefined,
): RustCompilerType {
  return substituteAssociatedTypes(
    substituteRustCompilerType(normalizeType(document, raw), implementationBindings),
    associatedTypeBindings,
    currentTrait,
  );
}

function substituteAssociatedTypes(
  type: RustCompilerType,
  bindings: ReadonlyMap<string, RustCompilerType>,
  currentTrait: ReturnType<typeof normalizeTraitDispatch> | undefined,
): RustCompilerType {
  if (type.kind === "associated-type") {
    const dispatch = type.trait.typeArguments.length === 0 && currentTrait?.path === type.trait.path
      ? currentTrait
      : type.trait;
    const selected = type.owner.kind === "self"
      ? bindings.get(associatedTypeKey(dispatch.path, type.name))
      : undefined;
    if (selected !== undefined) {
      return substituteAssociatedTypes(selected, bindings, currentTrait);
    }
    return Object.freeze({
      ...type,
      owner: substituteAssociatedTypes(type.owner, bindings, currentTrait),
      trait: Object.freeze({
        ...dispatch,
        typeArguments: Object.freeze(dispatch.typeArguments.map((argument) =>
          substituteAssociatedTypes(argument, bindings, currentTrait))),
      }),
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
    case "path":
      return Object.freeze({
        ...type,
        typeArguments: Object.freeze(type.typeArguments.map((argument) =>
          substituteAssociatedTypes(argument, bindings, currentTrait))),
      });
  }
}

export function substituteTraitDispatch(
  trait: ReturnType<typeof normalizeTraitDispatch>,
  bindings: ReadonlyMap<string, RustCompilerType>,
): ReturnType<typeof normalizeTraitDispatch> {
  return Object.freeze({
    ...trait,
    typeArguments: Object.freeze(trait.typeArguments.map((argument) =>
      substituteRustCompilerType(argument, bindings))),
  });
}

export function associatedTypeKey(traitPath: string, name: string): string {
  return `${traitPath}\0${name}`;
}

export function sourceImplementationRequirements(
  document: RustdocDocument,
  impl: Readonly<Record<string, unknown>>,
  implementationParameters: readonly RustCompilerTypeParameter[],
  declaredTypeParameters: readonly RustCompilerTypeParameter[],
  ownerCanonicalPath: readonly string[],
): readonly RustCompilerTypeParameter[] | undefined {
  const positions = directImplementationTypeParameterPositions(
    document,
    impl,
    declaredTypeParameters,
    ownerCanonicalPath,
  );
  if (positions === undefined) {
    return undefined;
  }
  const sourceTypeArgumentCount = sourceVisibleTypeParameterCount(declaredTypeParameters);
  const requirements = new Map<string, Map<string, RustCompilerTypeRequirement>>();
  for (const parameter of implementationParameters) {
    const typeArgumentIndex = positions.get(parameter.name);
    if (typeArgumentIndex === undefined) {
      if (parameter.requirements.length !== 0) {
        return undefined;
      }
      continue;
    }
    const declared = declaredTypeParameters[typeArgumentIndex];
    if (declared === undefined) {
      return undefined;
    }
    for (const requirement of parameter.requirements) {
      if (typeParameterGuaranteesRequirement(declared, requirement)) {
        continue;
      }
      if (typeArgumentIndex < sourceTypeArgumentCount) {
        const selected = requirements.get(declared.name) ?? new Map<string, RustCompilerTypeRequirement>();
        selected.set(typeRequirementKey(requirement), requirement);
        requirements.set(declared.name, selected);
        continue;
      }
      if (declared.defaultType === undefined || !compilerTypeSupportsRequirement(
        document,
        declared.defaultType,
        requirement,
        new Set(),
      )) {
        return undefined;
      }
    }
  }
  return Object.freeze([...requirements.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([name, selected]) => Object.freeze({
      name,
      requirements: Object.freeze([...selected.entries()]
        .sort(([left], [right]) => compareText(left, right))
        .map(([, requirement]) => requirement)),
    })));
}

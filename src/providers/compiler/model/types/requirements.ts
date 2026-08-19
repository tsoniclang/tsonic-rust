import {
  compareText,
  isRecord,
  itemById,
  requireArray,
  requireInnerRecord,
  requireRecord,
} from "../rustdoc-schema.js";
import { canonicalCompilerTypePathKey, canonicalPathKey, mergeTypeParameterRequirements, normalizeTypeParameters, rustCompilerTraitRequirement, sourceVisibleTypeParameterCount, standardTypePathKind } from "./normalization.js";
import { normalizeType, typeRequirementKey } from "./substitution.js";
import type {
  RustCompilerTraitImplementation,
  RustCompilerTraitRequirement,
  RustCompilerType,
  RustCompilerTypeParameter,
  RustCompilerTypeRequirement,
  RustCompilerTypeTraits,
} from "../model.js";
import type { RustdocDocument } from "../rustdoc-schema.js";

export function normalizeTypeTraits(
  document: RustdocDocument,
  owner: Readonly<Record<string, unknown>>,
  declaredTypeParameters: readonly RustCompilerTypeParameter[],
  ownerCanonicalPath: readonly string[],
): RustCompilerTypeTraits {
  const implementations = new Map<string, RustCompilerTraitImplementation>();
  const sourceTypeArgumentCount = sourceVisibleTypeParameterCount(declaredTypeParameters);
  for (const implId of requireArray(owner.impls, "Rust type impls")) {
    const implItem = itemById(document, implId);
    const impl = requireInnerRecord(implItem, "impl", "Rust type impl");
    if (!isRecord(impl.trait) || impl.is_negative === true || impl.blanket_impl !== null) {
      continue;
    }
    if (impl.trait.args !== null) {
      continue;
    }
    const requirement = rustCompilerTraitRequirement(document, impl.trait.id);
    if (requirement === undefined) {
      continue;
    }
    let implementationParameters: readonly RustCompilerTypeParameter[];
    try {
      implementationParameters = normalizeTypeParameters(
        document,
        requireRecord(impl.generics, `Rust ${requirement} impl generics`),
      );
    } catch {
      continue;
    }
    const implementation = sourceTraitImplementation(
      document,
      impl,
      requirement,
      implementationParameters,
      declaredTypeParameters,
      sourceTypeArgumentCount,
      ownerCanonicalPath,
    );
    if (implementation !== undefined) {
      implementations.set(traitImplementationKey(implementation), implementation);
    }
  }
  return Object.freeze({
    implementations: Object.freeze([...implementations.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([, implementation]) => implementation)),
  });
}


function sourceTraitImplementation(
  document: RustdocDocument,
  impl: Readonly<Record<string, unknown>>,
  trait: RustCompilerTypeRequirement,
  implementationParameters: readonly RustCompilerTypeParameter[],
  declaredTypeParameters: readonly RustCompilerTypeParameter[],
  sourceTypeArgumentCount: number,
  ownerCanonicalPath: readonly string[],
): RustCompilerTraitImplementation | undefined {
  const parameterPositions = directImplementationTypeParameterPositions(
    document,
    impl,
    declaredTypeParameters,
    ownerCanonicalPath,
  );
  if (parameterPositions === undefined) {
    return undefined;
  }
  const requirements = new Map<string, RustCompilerTraitRequirement>();
  for (const parameter of implementationParameters) {
    const typeArgumentIndex = parameterPositions.get(parameter.name);
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
        const condition = Object.freeze({ typeArgumentIndex, requirement });
        requirements.set(traitRequirementKey(condition), condition);
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
  return Object.freeze({
    trait,
    requirements: Object.freeze([...requirements.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([, requirement]) => requirement)),
  });
}


export function directImplementationTypeParameterPositions(
  document: RustdocDocument,
  impl: Readonly<Record<string, unknown>>,
  declaredTypeParameters: readonly RustCompilerTypeParameter[],
  ownerCanonicalPath: readonly string[],
): ReadonlyMap<string, number> | undefined {
  const target = normalizeType(document, impl.for);
  if (target.kind !== "path" ||
    canonicalCompilerTypePathKey(target) !== canonicalPathKey(ownerCanonicalPath) ||
    target.typeArguments.length > declaredTypeParameters.length ||
    declaredTypeParameters.slice(target.typeArguments.length).some((parameter) => parameter.defaultType === undefined)) {
    return undefined;
  }
  const sourceTypeArgumentCount = sourceVisibleTypeParameterCount(declaredTypeParameters);
  const positions = new Map<string, number>();
  for (let index = 0; index < target.typeArguments.length; index += 1) {
    const argument = target.typeArguments[index]!;
    if (argument.kind !== "generic") {
      const declared = declaredTypeParameters[index];
      if (index < sourceTypeArgumentCount || declared?.defaultType === undefined ||
        !compilerTypesEqual(argument, declared.defaultType)) {
        return undefined;
      }
      continue;
    }
    if (positions.has(argument.name)) {
      return undefined;
    }
    positions.set(argument.name, index);
  }
  return positions;
}


export function typeParameterGuaranteesRequirement(
  parameter: RustCompilerTypeParameter,
  requirement: RustCompilerTypeRequirement,
): boolean {
  const selected = new Set(parameter.requirements.map(typeRequirementKey));
  return selected.has(typeRequirementKey(requirement)) ||
    requirement === "clone" && selected.has(typeRequirementKey("copy"));
}


export function compilerTypeSupportsRequirement(
  document: RustdocDocument,
  type: RustCompilerType,
  requirement: RustCompilerTypeRequirement,
  active: Set<string>,
): boolean {
  const traitPath = compilerTraitPath(requirement);
  switch (type.kind) {
    case "primitive":
      return primitiveSupportsTrait(type.name, traitPath);
    case "unit":
      return structuralBuiltinSupportsTrait(traitPath);
    case "tuple":
      return structuralBuiltinSupportsTrait(traitPath) &&
        type.elements.every((element) => compilerTypeSupportsRequirement(document, element, requirement, active));
    case "array":
      return structuralBuiltinSupportsTrait(traitPath) &&
        compilerTypeSupportsRequirement(document, type.element, requirement, active);
    case "reference":
      return type.mutable === false &&
        (traitPath === "core::marker::Copy" || traitPath === "core::clone::Clone");
    case "function-pointer":
    case "raw-pointer":
      return traitPath === "core::marker::Copy" || traitPath === "core::clone::Clone";
    case "path":
      return compilerPathTypeSupportsRequirement(document, type, requirement, active);
    case "associated-type":
    case "slice":
    case "generic":
    case "self":
      return false;
  }
}


export function compilerTypeRequirementConditions(
  document: RustdocDocument,
  type: RustCompilerType,
  requirement: RustCompilerTypeRequirement,
  active: Set<string> = new Set(),
): readonly RustCompilerTypeParameter[] | undefined {
  if (type.kind === "generic") {
    return Object.freeze([Object.freeze({
      name: type.name,
      requirements: Object.freeze([requirement]),
    })]);
  }
  if (type.kind === "tuple") {
    const groups = type.elements.map((element) =>
      compilerTypeRequirementConditions(document, element, requirement, active));
    if (groups.some((group) => group === undefined)) {
      return undefined;
    }
    return mergeTypeParameterRequirements(...groups.filter(
      (group): group is readonly RustCompilerTypeParameter[] => group !== undefined,
    ));
  }
  if (type.kind === "array") {
    return compilerTypeRequirementConditions(document, type.element, requirement, active);
  }
  if (type.kind !== "path") {
    return compilerTypeSupportsRequirement(document, type, requirement, new Set())
      ? Object.freeze([])
      : undefined;
  }
  const activeKey = `${canonicalCompilerTypePathKey(type)}\0${typeRequirementKey(requirement)}\0${JSON.stringify(type.typeArguments)}`;
  if (active.has(activeKey)) {
    return undefined;
  }
  active.add(activeKey);
  try {
    const item = compilerTypeDeclarationItem(document, type);
    const declaration = item === undefined ? undefined : compilerTypeDeclaration(item);
    if (declaration === undefined) {
      return undefined;
    }
    const candidates = new Map<string, readonly RustCompilerTypeParameter[]>();
    for (const implId of requireArray(declaration.impls, "Rust concrete type impls")) {
      const implItem = itemById(document, implId);
      const impl = requireInnerRecord(implItem, "impl", "Rust concrete type impl");
      if (!isRecord(impl.trait) || impl.trait.args !== null || impl.is_negative === true ||
        impl.blanket_impl !== null) {
        continue;
      }
      const implementedTrait = rustCompilerTraitRequirement(document, impl.trait.id);
      if (implementedTrait === undefined ||
        typeRequirementKey(implementedTrait) !== typeRequirementKey(requirement)) {
        continue;
      }
      let parameters: readonly RustCompilerTypeParameter[];
      try {
        parameters = normalizeTypeParameters(
          document,
          requireRecord(impl.generics, "Rust concrete impl generics"),
        );
      } catch {
        continue;
      }
      const bindings = directImplementationTypeBindings(document, impl, type);
      if (bindings === undefined) {
        continue;
      }
      const groups: RustCompilerTypeParameter[][] = [];
      let valid = true;
      for (const parameter of parameters) {
        const argument = bindings.get(parameter.name);
        if (argument === undefined) {
          valid = false;
          break;
        }
        for (const selected of parameter.requirements) {
          const conditions = compilerTypeRequirementConditions(
            document,
            argument,
            selected,
            active,
          );
          if (conditions === undefined) {
            valid = false;
            break;
          }
          groups.push([...conditions]);
        }
        if (!valid) {
          break;
        }
      }
      if (!valid) {
        continue;
      }
      const merged = mergeTypeParameterRequirements(...groups);
      candidates.set(JSON.stringify(merged), merged);
    }
    if (candidates.size !== 1) {
      return undefined;
    }
    const selected = candidates.values().next();
    return selected.done ? undefined : selected.value;
  } finally {
    active.delete(activeKey);
  }
}


function compilerPathTypeSupportsRequirement(
  document: RustdocDocument,
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
  requirement: RustCompilerTypeRequirement,
  active: Set<string>,
): boolean {
  const activeKey = `${canonicalCompilerTypePathKey(type)}\0${typeRequirementKey(requirement)}\0${JSON.stringify(type.typeArguments)}`;
  if (active.has(activeKey)) {
    return false;
  }
  active.add(activeKey);
  try {
    const item = compilerTypeDeclarationItem(document, type);
    if (item === undefined) {
      return false;
    }
    const declaration = compilerTypeDeclaration(item);
    if (declaration === undefined) {
      return false;
    }
    for (const implId of requireArray(declaration.impls, "Rust concrete type impls")) {
      const implItem = itemById(document, implId);
      const impl = requireInnerRecord(implItem, "impl", "Rust concrete type impl");
      if (!isRecord(impl.trait) || impl.trait.args !== null || impl.is_negative === true || impl.blanket_impl !== null) {
        continue;
      }
      const implementedTrait = rustCompilerTraitRequirement(document, impl.trait.id);
      if (implementedTrait === undefined ||
        typeRequirementKey(implementedTrait) !== typeRequirementKey(requirement)) {
        continue;
      }
      let parameters: readonly RustCompilerTypeParameter[];
      try {
        parameters = normalizeTypeParameters(document, requireRecord(impl.generics, "Rust concrete impl generics"));
      } catch {
        continue;
      }
      const bindings = directImplementationTypeBindings(document, impl, type);
      if (bindings === undefined) {
        continue;
      }
      if (parameters.every((parameter) => {
        const argument = bindings.get(parameter.name);
        return argument !== undefined && parameter.requirements.every((selected) =>
          compilerTypeSupportsRequirement(document, argument, selected, active));
      })) {
        return true;
      }
    }
    return false;
  } finally {
    active.delete(activeKey);
  }
}


function directImplementationTypeBindings(
  document: RustdocDocument,
  impl: Readonly<Record<string, unknown>>,
  actual: Extract<RustCompilerType, { readonly kind: "path" }>,
): ReadonlyMap<string, RustCompilerType> | undefined {
  const target = normalizeType(document, impl.for);
  if (target.kind !== "path" || canonicalCompilerTypePathKey(target) !== canonicalCompilerTypePathKey(actual) ||
    target.typeArguments.length !== actual.typeArguments.length) {
    return undefined;
  }
  const bindings = new Map<string, RustCompilerType>();
  for (let index = 0; index < target.typeArguments.length; index += 1) {
    const pattern = target.typeArguments[index]!;
    const selected = actual.typeArguments[index]!;
    if (pattern.kind !== "generic") {
      if (!compilerTypesEqual(pattern, selected)) {
        return undefined;
      }
      continue;
    }
    const existing = bindings.get(pattern.name);
    if (existing !== undefined && !compilerTypesEqual(existing, selected)) {
      return undefined;
    }
    bindings.set(pattern.name, selected);
  }
  return bindings;
}


function compilerTypesEqual(left: RustCompilerType, right: RustCompilerType): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case "unit":
    case "self":
      return true;
    case "primitive":
    case "generic": {
      const selected = right as typeof left;
      return left.name === selected.name;
    }
    case "tuple": {
      const selected = right as typeof left;
      return left.elements.length === selected.elements.length &&
        left.elements.every((element, index) => compilerTypesEqual(element, selected.elements[index]!));
    }
    case "array": {
      const selected = right as typeof left;
      return left.length === selected.length && compilerTypesEqual(left.element, selected.element);
    }
    case "slice": {
      const selected = right as typeof left;
      return compilerTypesEqual(left.element, selected.element);
    }
    case "reference":
    case "raw-pointer": {
      const selected = right as typeof left;
      return left.mutable === selected.mutable && compilerTypesEqual(left.target, selected.target);
    }
    case "function-pointer": {
      const selected = right as typeof left;
      return left.abi === selected.abi && left.unsafe === selected.unsafe &&
        left.parameters.length === selected.parameters.length &&
        left.parameters.every((parameter, index) => compilerTypesEqual(parameter, selected.parameters[index]!)) &&
        compilerTypesEqual(left.result, selected.result);
    }
    case "path": {
      const selected = right as typeof left;
      return left.crateName === selected.crateName && left.name === selected.name &&
        textArraysEqual(left.modulePath, selected.modulePath) &&
        left.typeArguments.length === selected.typeArguments.length &&
        left.typeArguments.every((argument, index) => compilerTypesEqual(argument, selected.typeArguments[index]!));
    }
    case "associated-type": {
      const selected = right as typeof left;
      return left.name === selected.name && compilerTypesEqual(left.owner, selected.owner) &&
        left.trait.path === selected.trait.path &&
        left.trait.typeArguments.length === selected.trait.typeArguments.length &&
        left.trait.typeArguments.every((argument, index) =>
          compilerTypesEqual(argument, selected.trait.typeArguments[index]!));
    }
  }
}


function textArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}


function compilerTypeDeclarationItem(
  document: RustdocDocument,
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
): Readonly<Record<string, unknown>> | undefined {
  const key = canonicalCompilerTypePathKey(type);
  const ids = Object.entries(document.paths)
    .filter(([, path]) => isRecord(path) && Array.isArray(path.path) &&
      canonicalPathKey(path.path as string[]) === key && standardTypePathKind(path.kind))
    .map(([id]) => id);
  return ids.length === 1 && isRecord(document.index[ids[0]!])
    ? document.index[ids[0]!] as Readonly<Record<string, unknown>>
    : undefined;
}


function compilerTypeDeclaration(
  item: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
  const inner = isRecord(item.inner) ? item.inner : undefined;
  return inner === undefined
    ? undefined
    : isRecord(inner.struct)
      ? inner.struct
      : isRecord(inner.enum)
        ? inner.enum
        : isRecord(inner.union)
          ? inner.union
          : undefined;
}


function primitiveSupportsTrait(name: string, traitPath: string): boolean {
  if (traitPath === "core::marker::Copy" || traitPath === "core::clone::Clone" ||
    traitPath === "core::fmt::Debug" || traitPath === "core::default::Default" ||
    traitPath === "core::cmp::PartialEq" || traitPath === "core::marker::Send" ||
    traitPath === "core::marker::Sync" || traitPath === "core::marker::Unpin") {
    return true;
  }
  const integral = name === "bool" || name === "char" || /^(?:[iu](?:8|16|32|64|128)|isize|usize)$/u.test(name);
  return integral && (traitPath === "core::cmp::Eq" || traitPath === "core::hash::Hash" ||
    traitPath === "core::cmp::Ord" || traitPath === "core::cmp::PartialOrd");
}


function structuralBuiltinSupportsTrait(traitPath: string): boolean {
  return traitPath === "core::marker::Copy" || traitPath === "core::clone::Clone" ||
    traitPath === "core::fmt::Debug" || traitPath === "core::default::Default" ||
    traitPath === "core::cmp::PartialEq" || traitPath === "core::cmp::Eq" ||
    traitPath === "core::hash::Hash" || traitPath === "core::cmp::PartialOrd" ||
    traitPath === "core::cmp::Ord" || traitPath === "core::marker::Send" ||
    traitPath === "core::marker::Sync" || traitPath === "core::marker::Unpin";
}


function compilerTraitPath(requirement: RustCompilerTypeRequirement): string {
  return requirement === "clone"
    ? "core::clone::Clone"
    : requirement === "copy"
      ? "core::marker::Copy"
      : requirement.path;
}


function traitRequirementKey(requirement: RustCompilerTraitRequirement): string {
  return `${String(requirement.typeArgumentIndex).padStart(12, "0")}\0${typeRequirementKey(requirement.requirement)}`;
}


function traitImplementationKey(implementation: RustCompilerTraitImplementation): string {
  return `${typeRequirementKey(implementation.trait)}\0${implementation.requirements.map(traitRequirementKey).join("\0")}`;
}

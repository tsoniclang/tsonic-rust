import {
  compareText,
  isRecord,
  itemById,
  requireArray,
  requireInnerRecord,
  requireRecord,
} from "../rustdoc-schema.js";
import {
  canonicalCompilerTypePathKey,
  canonicalPathKey,
  mergeTypeParameterRequirements,
  normalizeGenericParameters,
  normalizeTraitDispatch,
  rustCompilerTraitRequirement,
  sourceVisibleTypeParameterCount,
  standardTypePathKind,
} from "./normalization.js";
import {
  normalizeType,
} from "./rustdoc-type-normalization.js";
import {
  rustCompilerTypeSemanticKey,
  typeRequirementKey,
} from "./substitution.js";
import {
  derivedNormalizationContext,
} from "./normalization-context.js";
import type {
  RustCompilerDependency,
  RustCompilerGenericArgument,
  RustCompilerGenericParameter,
  RustCompilerItemIdentity,
  RustCompilerTraitImplementation,
  RustCompilerTraitRequirement,
  RustCompilerType,
  RustCompilerTypeParameter,
  RustCompilerTypeRequirement,
  RustCompilerTypeTraits,
} from "../model.js";
import type { RustdocItemResolver } from "../rustdoc-items.js";
import type { RustdocDocument } from "../rustdoc-schema.js";
import type {
  RustCompilerNormalizationContext,
  RustCompilerSubstitutions,
} from "../rustdoc-types.js";

export function compilerTypeRequirementCanonicalPath(
  requirement: RustCompilerTypeRequirement,
): readonly string[] {
  if (requirement === "clone") return Object.freeze(["core", "clone", "Clone"]);
  if (requirement === "copy") return Object.freeze(["core", "marker", "Copy"]);
  return requirement.trait.identity.canonicalPath;
}

export function normalizeTypeTraits(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  owner: Readonly<Record<string, unknown>>,
  declaredGenericParameters: readonly RustCompilerGenericParameter[],
  ownerIdentity: RustCompilerItemIdentity,
  resolveItem?: RustdocItemResolver,
): RustCompilerTypeTraits {
  const implementations = new Map<string, RustCompilerTraitImplementation>();
  const declaredTypeParameters = declaredGenericParameters.filter(
    (parameter): parameter is RustCompilerTypeParameter => parameter.kind === "type",
  );
  const sourceTypeArgumentCount = sourceVisibleTypeParameterCount(declaredGenericParameters);
  for (const implId of requireArray(owner.impls, "Rust type impls")) {
    const implItem = itemById(document, implId);
    const impl = requireInnerRecord(implItem, "impl", "Rust type impl");
    if (!isRecord(impl.trait) || impl.is_negative === true || impl.is_synthetic === true ||
      impl.blanket_impl !== null) continue;
    try {
      const context = implementationContext(
        document,
        dependency,
        implItem,
        impl,
        ownerIdentity,
        resolveItem,
      );
      const requirement = rustCompilerTraitRequirement(
        normalizeTraitDispatch(document, impl.trait, context.context),
      );
      const implementationParameters = context.generics.parameters.filter(
        (parameter): parameter is RustCompilerTypeParameter => parameter.kind === "type",
      );
      const implementation = sourceTraitImplementation(
        document,
        dependency,
        impl,
        requirement,
        implementationParameters,
        context.context,
        declaredGenericParameters,
        declaredTypeParameters,
        sourceTypeArgumentCount,
        ownerIdentity,
        resolveItem,
      );
      if (implementation !== undefined) {
        implementations.set(traitImplementationKey(implementation), implementation);
      }
    } catch {
      continue;
    }
  }
  return Object.freeze({
    implementations: Object.freeze([...implementations.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([, implementation]) => implementation)),
  });
}

export function directImplementationTypeParameterPositions(
  document: RustdocDocument,
  impl: Readonly<Record<string, unknown>>,
  implementationContext: RustCompilerNormalizationContext,
  declaredGenericParameters: readonly RustCompilerGenericParameter[],
  ownerIdentity: RustCompilerItemIdentity,
): ReadonlyMap<string, number> | undefined {
  const genericPositions = directImplementationGenericParameterPositions(
    document,
    impl,
    implementationContext,
    declaredGenericParameters,
    ownerIdentity,
  );
  if (genericPositions === undefined) return undefined;
  const declaredTypeParameters = declaredGenericParameters.filter(
    (parameter): parameter is RustCompilerTypeParameter => parameter.kind === "type",
  );
  const sourceTypeArgumentCount = sourceVisibleTypeParameterCount(declaredGenericParameters);
  const positions = new Map<string, number>();
  for (const [parameterIdentity, genericIndex] of genericPositions) {
    const declared = declaredGenericParameters[genericIndex];
    if (declared?.kind !== "type") continue;
    const declaredTypeIndex = declaredTypeParameters.findIndex((parameter) =>
      parameter.identity.itemId === declared.identity.itemId);
    if (declaredTypeIndex < 0 || declaredTypeIndex >= sourceTypeArgumentCount &&
      declared.defaultType === undefined) return undefined;
    positions.set(parameterIdentity, declaredTypeIndex);
  }
  return positions;
}

export function directImplementationGenericParameterPositions(
  document: RustdocDocument,
  impl: Readonly<Record<string, unknown>>,
  implementationContext: RustCompilerNormalizationContext,
  declaredGenericParameters: readonly RustCompilerGenericParameter[],
  ownerIdentity: RustCompilerItemIdentity,
): ReadonlyMap<string, number> | undefined {
  const target = normalizeType(document, impl.for, implementationContext);
  if (target.kind !== "path" || target.identity.itemId !== ownerIdentity.itemId ||
    target.genericArguments.length > declaredGenericParameters.length ||
    !omittedParametersHaveDefaults(declaredGenericParameters.slice(target.genericArguments.length))) {
    return undefined;
  }
  const positions = new Map<string, number>();
  for (let index = 0; index < target.genericArguments.length; index += 1) {
    const argument = target.genericArguments[index]!;
    const declared = declaredGenericParameters[index]!;
    if (argument.kind !== declared.kind) return undefined;
    const parameterIdentity = genericArgumentParameterIdentity(argument);
    if (parameterIdentity === undefined) {
      if (!argumentMatchesDefault(argument, declared)) return undefined;
      continue;
    }
    if (positions.has(parameterIdentity)) return undefined;
    positions.set(parameterIdentity, index);
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
  dependency: RustCompilerDependency,
  type: RustCompilerType,
  requirement: RustCompilerTypeRequirement,
  active: Set<string>,
  resolveItem?: RustdocItemResolver,
): boolean {
  const traitPath = compilerTraitPath(requirement);
  switch (type.kind) {
    case "primitive":
      return exactUnparameterizedRequirement(requirement) && primitiveSupportsTrait(type.name, traitPath);
    case "unit":
      return exactUnparameterizedRequirement(requirement) && structuralBuiltinSupportsTrait(traitPath);
    case "tuple":
      return exactUnparameterizedRequirement(requirement) && structuralBuiltinSupportsTrait(traitPath) &&
        type.elements.every((element) => compilerTypeSupportsRequirement(
          document,
          dependency,
          element,
          requirement,
          active,
          resolveItem,
        ));
    case "array":
      return exactUnparameterizedRequirement(requirement) && structuralBuiltinSupportsTrait(traitPath) &&
        compilerTypeSupportsRequirement(document, dependency, type.element, requirement, active, resolveItem);
    case "reference":
      return type.mutable === false && exactUnparameterizedRequirement(requirement) &&
        (traitPath === "core::marker::Copy" || traitPath === "core::clone::Clone");
    case "function-pointer":
    case "raw-pointer":
      return exactUnparameterizedRequirement(requirement) &&
        (traitPath === "core::marker::Copy" || traitPath === "core::clone::Clone");
    case "path":
      return compilerPathTypeSupportsRequirement(
        document,
        dependency,
        type,
        requirement,
        active,
        resolveItem,
      );
    case "associated-type":
    case "trait-object":
    case "opaque":
    case "slice":
    case "generic":
    case "self":
      return false;
  }
}

export function compilerTypeRequirementConditions(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  type: RustCompilerType,
  requirement: RustCompilerTypeRequirement,
  active: Set<string> = new Set(),
  resolveItem?: RustdocItemResolver,
): readonly RustCompilerTypeParameter[] | undefined {
  if (type.kind === "generic") {
    return Object.freeze([Object.freeze({
      kind: "type",
      identity: type.identity,
      name: type.name,
      requirements: Object.freeze([requirement]),
      outlives: Object.freeze([]),
      maybeSized: false,
    })]);
  }
  if (type.kind === "tuple") {
    const groups = type.elements.map((element) => compilerTypeRequirementConditions(
      document,
      dependency,
      element,
      requirement,
      active,
      resolveItem,
    ));
    if (groups.some((group) => group === undefined)) return undefined;
    return mergeTypeParameterRequirements(...groups.filter(
      (group): group is readonly RustCompilerTypeParameter[] => group !== undefined,
    ));
  }
  if (type.kind === "array") {
    return compilerTypeRequirementConditions(
      document,
      dependency,
      type.element,
      requirement,
      active,
      resolveItem,
    );
  }
  if (type.kind !== "path") {
    return compilerTypeSupportsRequirement(
      document,
      dependency,
      type,
      requirement,
      new Set(),
      resolveItem,
    ) ? Object.freeze([]) : undefined;
  }
  const activeKey = requirementActiveKey(type, requirement);
  if (active.has(activeKey)) return undefined;
  active.add(activeKey);
  try {
    const item = compilerTypeDeclarationItem(document, type);
    const declaration = item === undefined ? undefined : compilerTypeDeclaration(item);
    if (item === undefined || declaration === undefined) return undefined;
    const candidates = new Map<string, readonly RustCompilerTypeParameter[]>();
    for (const implId of requireArray(declaration.impls, "Rust concrete type impls")) {
      const implItem = itemById(document, implId);
      const impl = requireInnerRecord(implItem, "impl", "Rust concrete type impl");
      if (!isRecord(impl.trait) || impl.is_negative === true || impl.blanket_impl !== null) continue;
      const ownerIdentity = type.identity;
      const normalized = implementationContext(
        document,
        dependency,
        implItem,
        impl,
        ownerIdentity,
        resolveItem,
      );
      let implementedTrait: RustCompilerTypeRequirement;
      try {
        implementedTrait = rustCompilerTraitRequirement(
          normalizeTraitDispatch(document, impl.trait, normalized.context),
        );
      } catch {
        continue;
      }
      if (typeRequirementKey(implementedTrait) !== typeRequirementKey(requirement)) continue;
      const bindings = directImplementationBindings(document, impl, normalized.context, type);
      if (bindings === undefined) continue;
      const groups: RustCompilerTypeParameter[][] = [];
      let valid = true;
      for (const parameter of normalized.generics.parameters) {
        if (parameter.kind !== "type") continue;
        const argument = bindings.types.get(parameter.identity.itemId);
        if (argument === undefined) {
          valid = false;
          break;
        }
        for (const selected of parameter.requirements) {
          const conditions = compilerTypeRequirementConditions(
            document,
            dependency,
            argument,
            selected,
            active,
            resolveItem,
          );
          if (conditions === undefined) {
            valid = false;
            break;
          }
          groups.push([...conditions]);
        }
        if (!valid) break;
      }
      if (!valid) continue;
      const merged = mergeTypeParameterRequirements(...groups);
      candidates.set(merged.map((parameter) =>
        `${parameter.identity.itemId}:${parameter.requirements.map(typeRequirementKey).join(",")}`).join(";"), merged);
    }
    return candidates.size === 1 ? candidates.values().next().value : undefined;
  } finally {
    active.delete(activeKey);
  }
}

function sourceTraitImplementation(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  impl: Readonly<Record<string, unknown>>,
  trait: RustCompilerTypeRequirement,
  implementationParameters: readonly RustCompilerTypeParameter[],
  implementationContext: RustCompilerNormalizationContext,
  declaredGenericParameters: readonly RustCompilerGenericParameter[],
  declaredTypeParameters: readonly RustCompilerTypeParameter[],
  sourceTypeArgumentCount: number,
  ownerIdentity: RustCompilerItemIdentity,
  resolveItem?: RustdocItemResolver,
): RustCompilerTraitImplementation | undefined {
  const positions = directImplementationTypeParameterPositions(
    document,
    impl,
    implementationContext,
    declaredGenericParameters,
    ownerIdentity,
  );
  if (positions === undefined) return undefined;
  const requirements = new Map<string, RustCompilerTraitRequirement>();
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
        const condition = Object.freeze({ typeArgumentIndex, requirement });
        requirements.set(traitRequirementKey(condition), condition);
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
  return Object.freeze({
    trait,
    requirements: Object.freeze([...requirements.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([, requirement]) => requirement)),
  });
}

function compilerPathTypeSupportsRequirement(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
  requirement: RustCompilerTypeRequirement,
  active: Set<string>,
  resolveItem?: RustdocItemResolver,
): boolean {
  const activeKey = requirementActiveKey(type, requirement);
  if (active.has(activeKey)) return false;
  active.add(activeKey);
  try {
    const item = compilerTypeDeclarationItem(document, type);
    const declaration = item === undefined ? undefined : compilerTypeDeclaration(item);
    if (item === undefined || declaration === undefined) return false;
    for (const implId of requireArray(declaration.impls, "Rust concrete type impls")) {
      const implItem = itemById(document, implId);
      const impl = requireInnerRecord(implItem, "impl", "Rust concrete type impl");
      if (!isRecord(impl.trait) || impl.is_negative === true || impl.blanket_impl !== null) continue;
      const normalized = implementationContext(
        document,
        dependency,
        implItem,
        impl,
        type.identity,
        resolveItem,
      );
      let implementedTrait: RustCompilerTypeRequirement;
      try {
        implementedTrait = rustCompilerTraitRequirement(
          normalizeTraitDispatch(document, impl.trait, normalized.context),
        );
      } catch {
        continue;
      }
      if (typeRequirementKey(implementedTrait) !== typeRequirementKey(requirement)) continue;
      const bindings = directImplementationBindings(document, impl, normalized.context, type);
      if (bindings === undefined) continue;
      if (normalized.generics.parameters.every((parameter) => {
        if (parameter.kind !== "type") return true;
        const argument = bindings.types.get(parameter.identity.itemId);
        return argument !== undefined && parameter.requirements.every((selected) =>
          compilerTypeSupportsRequirement(
            document,
            dependency,
            argument,
            selected,
            active,
            resolveItem,
          ));
      })) {
        return true;
      }
    }
    return false;
  } finally {
    active.delete(activeKey);
  }
}

function directImplementationBindings(
  document: RustdocDocument,
  impl: Readonly<Record<string, unknown>>,
  context: RustCompilerNormalizationContext,
  actual: Extract<RustCompilerType, { readonly kind: "path" }>,
): RustCompilerSubstitutions | undefined {
  const target = normalizeType(document, impl.for, context);
  if (target.kind !== "path" || target.identity.itemId !== actual.identity.itemId ||
    target.genericArguments.length !== actual.genericArguments.length) {
    return undefined;
  }
  const types = new Map<string, RustCompilerType>();
  const lifetimes = new Map<string, import("../model.js").RustCompilerLifetime>();
  const consts = new Map<string, import("../model.js").RustCompilerConstArgument>();
  for (let index = 0; index < target.genericArguments.length; index += 1) {
    const pattern = target.genericArguments[index]!;
    const selected = actual.genericArguments[index]!;
    if (pattern.kind !== selected.kind) return undefined;
    if (pattern.kind === "type" && selected.kind === "type" && pattern.type.kind === "generic") {
      const existing = types.get(pattern.type.identity.itemId);
      if (existing !== undefined && rustCompilerTypeSemanticKey(existing) !== rustCompilerTypeSemanticKey(selected.type)) {
        return undefined;
      }
      types.set(pattern.type.identity.itemId, selected.type);
      continue;
    }
    if (pattern.kind === "lifetime" && selected.kind === "lifetime" && pattern.lifetime.kind === "parameter") {
      lifetimes.set(pattern.lifetime.identity.itemId, selected.lifetime);
      continue;
    }
    if (pattern.kind === "const" && selected.kind === "const" && pattern.value.kind === "parameter") {
      consts.set(pattern.value.identity.itemId, selected.value);
      continue;
    }
    if (genericArgumentKey(pattern) !== genericArgumentKey(selected)) return undefined;
  }
  return Object.freeze({ types, lifetimes, consts });
}

function implementationContext(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  implItem: Readonly<Record<string, unknown>>,
  impl: Readonly<Record<string, unknown>>,
  ownerIdentity: RustCompilerItemIdentity,
  resolveItem?: RustdocItemResolver,
): {
  readonly generics: ReturnType<typeof normalizeGenericParameters>;
  readonly context: RustCompilerNormalizationContext;
} {
  const role = `impl:${String(implItem.id)}`;
  const root = derivedNormalizationContext(dependency, ownerIdentity, role, {
    selfOwner: ownerIdentity,
    ...(resolveItem === undefined ? {} : { resolveItem }),
  });
  const generics = normalizeGenericParameters(
    document,
    requireRecord(impl.generics, `Rust ${role} generics`),
    root,
  );
  return Object.freeze({ generics, context: generics.context });
}

function genericArgumentParameterIdentity(argument: RustCompilerGenericArgument): string | undefined {
  if (argument.kind === "type" && argument.type.kind === "generic") return argument.type.identity.itemId;
  if (argument.kind === "lifetime" && argument.lifetime.kind === "parameter") {
    return argument.lifetime.identity.itemId;
  }
  if (argument.kind === "const" && argument.value.kind === "parameter") {
    return argument.value.identity.itemId;
  }
  return undefined;
}

function omittedParametersHaveDefaults(parameters: readonly RustCompilerGenericParameter[]): boolean {
  return parameters.every((parameter) => parameter.kind === "type"
    ? parameter.defaultType !== undefined
    : parameter.kind === "const" && parameter.defaultValue !== undefined);
}

function argumentMatchesDefault(
  argument: RustCompilerGenericArgument,
  parameter: RustCompilerGenericParameter,
): boolean {
  if (argument.kind === "type" && parameter.kind === "type") {
    return parameter.defaultType !== undefined &&
      rustCompilerTypeSemanticKey(argument.type) === rustCompilerTypeSemanticKey(parameter.defaultType);
  }
  if (argument.kind === "const" && parameter.kind === "const") {
    return parameter.defaultValue !== undefined && genericArgumentKey(argument) === genericArgumentKey({
      kind: "const",
      value: parameter.defaultValue,
    });
  }
  return false;
}

function genericArgumentKey(argument: RustCompilerGenericArgument): string {
  if (argument.kind === "type") return `type:${rustCompilerTypeSemanticKey(argument.type)}`;
  if (argument.kind === "lifetime") return `lifetime:${JSON.stringify(argument.lifetime)}`;
  return `const:${JSON.stringify(argument.value)}`;
}

function requirementActiveKey(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
  requirement: RustCompilerTypeRequirement,
): string {
  return `${canonicalCompilerTypePathKey(type)}\0${typeRequirementKey(requirement)}\0${rustCompilerTypeSemanticKey(type)}`;
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

function exactUnparameterizedRequirement(requirement: RustCompilerTypeRequirement): boolean {
  return typeof requirement === "string" ||
    requirement.trait.genericArguments.length === 0 &&
    requirement.trait.associatedConstraints.length === 0 &&
    requirement.trait.lifetimeBinder === undefined;
}

function compilerTraitPath(requirement: RustCompilerTypeRequirement): string {
  return requirement === "clone"
    ? "core::clone::Clone"
    : requirement === "copy"
      ? "core::marker::Copy"
      : requirement.trait.identity.canonicalPath.join("::");
}

function primitiveSupportsTrait(name: string, traitPath: string): boolean {
  if (traitPath === "core::marker::Copy" || traitPath === "core::clone::Clone" ||
    traitPath === "core::fmt::Debug" || traitPath === "core::default::Default" ||
    traitPath === "core::cmp::PartialEq" || traitPath === "core::marker::Send" ||
    traitPath === "core::marker::Sync" || traitPath === "core::marker::Unpin") {
    return true;
  }
  const integral = name === "bool" || name === "char" ||
    /^(?:[iu](?:8|16|32|64|128)|isize|usize)$/u.test(name);
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

function traitRequirementKey(requirement: RustCompilerTraitRequirement): string {
  return `${String(requirement.typeArgumentIndex).padStart(12, "0")}\0${typeRequirementKey(requirement.requirement)}`;
}

function traitImplementationKey(implementation: RustCompilerTraitImplementation): string {
  return `${typeRequirementKey(implementation.trait)}\0${implementation.requirements.map(traitRequirementKey).join("\0")}`;
}

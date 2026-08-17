import type {
  RustCompilerTraitImplementation,
  RustCompilerTraitRequirement,
  RustCompilerType,
  RustCompilerTypeParameter,
  RustCompilerTypeRequirement,
  RustCompilerTypeTraits,
} from "./model.js";
import {
  compareText,
  hasInnerKind,
  isRecord,
  itemById,
  normalizeAbi,
  requireArray,
  requireBoolean,
  requireInnerRecord,
  requireRecord,
  requireString,
  type RustdocDocument,
} from "./rustdoc-schema.js";

export function standardTypePathKind(value: unknown): boolean {
  return value === "struct" || value === "enum" || value === "union" || value === "type_alias";
}


export function canonicalCompilerTypePathKey(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
): string {
  return canonicalPathKey([type.crateName, ...type.modulePath, type.name]);
}


export function canonicalPathKey(path: readonly string[]): string {
  return path.join("\0");
}


export function normalizeTypeParameters(
  document: RustdocDocument,
  generics: Readonly<Record<string, unknown>>,
): readonly RustCompilerTypeParameter[] {
  const requirements = new Map<string, Map<string, RustCompilerTypeRequirement>>();
  const defaults = new Map<string, RustCompilerType>();
  const names: string[] = [];
  for (const raw of requireArray(generics.params, "Rust generic parameters")) {
    const parameter = requireRecord(raw, "Rust generic parameter");
    const kind = requireRecord(parameter.kind, "Rust generic parameter kind");
    if (!isRecord(kind.type)) {
      throw new Error(`Rust lifetime and const generic parameters are not representable by the current source contract.`);
    }
    const name = requireString(parameter.name, "Rust type parameter name");
    if (names.includes(name) || kind.type.is_synthetic !== false) {
      throw new Error(`Rust type parameter '${name}' has an unsupported duplicate or synthetic contract.`);
    }
    names.push(name);
    if (kind.type.default !== null && kind.type.default !== undefined) {
      defaults.set(name, normalizeType(document, kind.type.default));
    }
    addNormalizedBounds(
      document,
      requireArray(kind.type.bounds, `Rust type parameter '${name}' bounds`),
      name,
      requirements,
    );
  }
  for (const rawPredicate of requireArray(generics.where_predicates, "Rust generic where predicates")) {
    const predicate = requireRecord(rawPredicate, "Rust generic where predicate");
    const bounded = isRecord(predicate.bound_predicate)
      ? predicate.bound_predicate
      : undefined;
    if (bounded === undefined || requireArray(
      bounded.generic_params,
      "Rust generic where predicate parameters",
    ).length !== 0) {
      throw new Error("Rust lifetime, equality, and higher-ranked where predicates are not representable by the current provider contract.");
    }
    const type = requireRecord(bounded.type, "Rust generic where predicate type");
    const name = typeof type.generic === "string" ? type.generic : undefined;
    if (name === undefined || !names.includes(name)) {
      throw new Error("Rust where predicates must constrain one declared type parameter directly.");
    }
    addNormalizedBounds(
      document,
      requireArray(bounded.bounds, `Rust where predicate '${name}' bounds`),
      name,
      requirements,
    );
  }
  return Object.freeze(names.map((name) => Object.freeze({
    name,
    requirements: Object.freeze([...requirements.get(name)?.entries() ?? []]
      .sort(([left], [right]) => compareText(left, right))
      .map(([, requirement]) => requirement)),
    ...(defaults.has(name) ? { defaultType: defaults.get(name)! } : {}),
  })));
}


export function normalizeTypeParameterShape(
  document: RustdocDocument,
  generics: Readonly<Record<string, unknown>>,
): readonly RustCompilerTypeParameter[] {
  const names = new Set<string>();
  return Object.freeze(requireArray(generics.params, "Rust generic parameters").map((raw) => {
    const parameter = requireRecord(raw, "Rust generic parameter");
    const kind = requireRecord(parameter.kind, "Rust generic parameter kind");
    if (!isRecord(kind.type)) {
      throw new Error("Rust lifetime and const generic parameters are not representable by the current source contract.");
    }
    const name = requireString(parameter.name, "Rust type parameter name");
    if (names.has(name) || kind.type.is_synthetic !== false) {
      throw new Error(`Rust type parameter '${name}' has an unsupported duplicate or synthetic contract.`);
    }
    names.add(name);
    return Object.freeze({
      name,
      requirements: Object.freeze([]),
      ...(kind.type.default === null || kind.type.default === undefined
        ? {}
        : { defaultType: normalizeType(document, kind.type.default) }),
    });
  }));
}


export function sourceVisibleTypeParameterCount(
  parameters: readonly RustCompilerTypeParameter[],
): number {
  const firstDefault = parameters.findIndex((parameter) => parameter.defaultType !== undefined);
  if (firstDefault < 0) {
    return parameters.length;
  }
  if (parameters.slice(firstDefault).some((parameter) => parameter.defaultType === undefined)) {
    throw new Error("Rust default type parameters must form one trailing source-omittable suffix.");
  }
  return firstDefault;
}


function addNormalizedBounds(
  document: RustdocDocument,
  bounds: readonly unknown[],
  parameterName: string,
  requirements: Map<string, Map<string, RustCompilerTypeRequirement>>,
): void {
  const selected = requirements.get(parameterName) ?? new Map<string, RustCompilerTypeRequirement>();
  requirements.set(parameterName, selected);
  for (const rawBound of bounds) {
    const bound = requireRecord(rawBound, `Rust type parameter '${parameterName}' bound`);
    const traitBound = isRecord(bound.trait_bound) ? bound.trait_bound : undefined;
    if (traitBound === undefined ||
      requireArray(traitBound.generic_params, `Rust type parameter '${parameterName}' higher-ranked bounds`).length !== 0) {
      throw new Error(`Rust type parameter '${parameterName}' has a non-trait, lifetime, or higher-ranked bound that is not representable.`);
    }
    const trait = requireRecord(traitBound.trait, `Rust type parameter '${parameterName}' trait bound`);
    if (trait.args !== null) {
      throw new Error(`Rust type parameter '${parameterName}' has a parameterized trait bound that is not representable.`);
    }
    const requirement = rustCompilerTraitRequirement(document, trait.id);
    if (requirement === undefined) {
      throw new Error(`Rust type parameter '${parameterName}' requires unsupported trait '${String(trait.path)}'.`);
    }
    if (traitBound.modifier === "maybe") {
      if (typeRequirementKey(requirement) !== "trait:core::marker::Sized") {
        throw new Error(`Rust type parameter '${parameterName}' has unsupported optional trait bound '${String(trait.path)}'.`);
      }
      continue;
    }
    if (traitBound.modifier !== "none" && traitBound.modifier !== "maybe_const") {
      throw new Error(`Rust type parameter '${parameterName}' has unsupported trait-bound modifier '${String(traitBound.modifier)}'.`);
    }
    selected.set(typeRequirementKey(requirement), requirement);
  }
}


function rustCompilerTraitRequirement(
  document: RustdocDocument,
  traitId: unknown,
): RustCompilerTypeRequirement | undefined {
  const candidate = document.paths[String(traitId)];
  const path = isRecord(candidate) ? candidate : undefined;
  if (path?.kind !== "trait" || !Array.isArray(path.path) ||
    path.path.length === 0 || path.path.some((segment) => typeof segment !== "string")) {
    return undefined;
  }
  const segments = path.path;
  if (segments.length === 3 && segments[0] === "core" && segments[1] === "clone" && segments[2] === "Clone") {
    return "clone";
  }
  if (segments.length === 3 && segments[0] === "core" && segments[1] === "marker" && segments[2] === "Copy") {
    return "copy";
  }
  return { kind: "trait", path: (segments as string[]).join("::") };
}


export function mergeTypeParameterRequirements(
  ...groups: readonly (readonly RustCompilerTypeParameter[])[]
): readonly RustCompilerTypeParameter[] {
  const requirements = new Map<string, Map<string, RustCompilerTypeRequirement>>();
  for (const group of groups) {
    for (const parameter of group) {
      const selected = requirements.get(parameter.name) ?? new Map<string, RustCompilerTypeRequirement>();
      requirements.set(parameter.name, selected);
      for (const requirement of parameter.requirements) {
        selected.set(typeRequirementKey(requirement), requirement);
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


export function normalizeTypeTraits(
  document: RustdocDocument,
  owner: Readonly<Record<string, unknown>>,
  declaredTypeParameters: readonly RustCompilerTypeParameter[],
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
): RustCompilerTraitImplementation | undefined {
  const parameterPositions = directImplementationTypeParameterPositions(
    document,
    impl,
    declaredTypeParameters,
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
): ReadonlyMap<string, number> | undefined {
  const target = normalizeType(document, impl.for);
  if (target.kind !== "path" || target.typeArguments.length > declaredTypeParameters.length ||
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
      return traitPath === "core::marker::Copy" || traitPath === "core::clone::Clone";
    case "function-pointer":
    case "raw-pointer":
      return traitPath === "core::marker::Copy" || traitPath === "core::clone::Clone";
    case "path":
      return compilerPathTypeSupportsRequirement(document, type, requirement, active);
    case "slice":
    case "generic":
    case "self":
      return false;
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


export function normalizeType(
  document: RustdocDocument,
  raw: unknown,
  resolvingAliases: ReadonlySet<string> = new Set(),
): RustCompilerType {
  const type = requireRecord(raw, "Rust type");
  if (typeof type.primitive === "string") {
    return Object.freeze({ kind: "primitive", name: type.primitive });
  }
  if (typeof type.generic === "string") {
    return Object.freeze(type.generic === "Self"
      ? { kind: "self" as const }
      : { kind: "generic" as const, name: type.generic });
  }
  if (Array.isArray(type.tuple)) {
    return Object.freeze({ kind: "tuple", elements: Object.freeze(type.tuple.map((element) => normalizeType(document, element, resolvingAliases))) });
  }
  if (type.slice !== undefined) {
    return Object.freeze({ kind: "slice", element: normalizeType(document, type.slice, resolvingAliases) });
  }
  if (isRecord(type.array)) {
    const length = Number(type.array.len);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new Error(`Rust array length '${String(type.array.len)}' is not a non-negative integer.`);
    }
    return Object.freeze({ kind: "array", element: normalizeType(document, type.array.type, resolvingAliases), length });
  }
  if (isRecord(type.borrowed_ref)) {
    return Object.freeze({
      kind: "reference",
      mutable: type.borrowed_ref.is_mutable === true,
      target: normalizeType(document, type.borrowed_ref.type, resolvingAliases),
    });
  }
  if (isRecord(type.raw_pointer)) {
    return Object.freeze({
      kind: "raw-pointer",
      mutable: type.raw_pointer.is_mutable === true,
      target: normalizeType(document, type.raw_pointer.type, resolvingAliases),
    });
  }
  if (isRecord(type.function_pointer)) {
    const signature = requireRecord(type.function_pointer.sig, "Rust function pointer signature");
    if (signature.is_c_variadic !== false) {
      throw new Error("Variadic Rust function-pointer types have no closed source signature.");
    }
    const genericParameters = requireArray(
      type.function_pointer.generic_params,
      "Rust function pointer generic parameters",
    );
    if (genericParameters.length !== 0) {
      throw new Error("Generic Rust function-pointer types have no closed source signature.");
    }
    const header = requireRecord(
      type.function_pointer.header,
      "Rust function pointer header",
    );
    const inputs = requireArray(signature.inputs, "Rust function pointer inputs").map(
      (input, index) => {
        if (!Array.isArray(input) || input.length !== 2) {
          throw new Error(`Rust function pointer input ${index} has an invalid rustdoc shape.`);
        }
        return normalizeType(document, input[1], resolvingAliases);
      },
    );
    return Object.freeze({
      kind: "function-pointer",
      parameters: Object.freeze(inputs),
      result: signature.output === null
        ? Object.freeze({ kind: "unit" as const })
        : normalizeType(document, signature.output, resolvingAliases),
      abi: normalizeAbi(header.abi, "Rust function pointer ABI"),
      unsafe: requireBoolean(
        header.is_unsafe,
        "Rust function pointer safety",
      ),
    });
  }
  if (isRecord(type.resolved_path)) {
    const id = String(type.resolved_path.id);
    const pathRecord = requireRecord(document.paths[id], `Rust resolved path '${id}'`);
    const path = requireArray(pathRecord.path, `Rust resolved path '${id}' segments`);
    if (path.some((segment) => typeof segment !== "string") || path.length < 2) {
      throw new Error(`Rust resolved path '${id}' has no canonical crate-qualified path.`);
    }
    const args = normalizePathArguments(document, type.resolved_path.args, resolvingAliases);
    const resolvedItem = document.index[id];
    if (isRecord(resolvedItem) && hasInnerKind(resolvedItem, "type_alias")) {
      if (resolvingAliases.has(id)) {
        throw new Error(`Rust type alias '${id}' is recursively referenced while computing its canonical target type.`);
      }
      const alias = requireInnerRecord(resolvedItem, "type_alias", `Rust type alias '${id}'`);
      const generics = requireRecord(alias.generics, `Rust type alias '${id}' generics`);
      const parameters = normalizeTypeParameters(document, generics);
      if (parameters.length !== args.length) {
        throw new Error(`Rust type alias '${id}' received ${args.length} type arguments for ${parameters.length} parameters.`);
      }
      const nextResolving = new Set(resolvingAliases);
      nextResolving.add(id);
      const target = normalizeType(document, alias.type, nextResolving);
      return substituteRustCompilerType(
        target,
        new Map(parameters.map((parameter, index) => [parameter.name, args[index]!])),
      );
    }
    return Object.freeze({
      kind: "path",
      crateName: path[0] as string,
      modulePath: Object.freeze((path.slice(1, -1) as string[])),
      name: path[path.length - 1] as string,
      typeArguments: args,
    });
  }
  throw new Error(`Rust type has no supported closed representation.`);
}


function normalizePathArguments(
  document: RustdocDocument,
  raw: unknown,
  resolvingAliases: ReadonlySet<string>,
): readonly RustCompilerType[] {
  if (raw === null || raw === undefined) {
    return Object.freeze([]);
  }
  const args = requireRecord(raw, "Rust path arguments");
  const angle = isRecord(args.angle_bracketed) ? args.angle_bracketed : undefined;
  if (angle === undefined) {
    throw new Error(`Rust parenthesized path arguments are not supported.`);
  }
  const result: RustCompilerType[] = [];
  for (const rawArgument of requireArray(angle.args, "Rust path type arguments")) {
    const argument = requireRecord(rawArgument, "Rust path type argument");
    if (argument.type === undefined) {
      throw new Error(`Rust lifetime and const path arguments are not supported.`);
    }
    result.push(normalizeType(document, argument.type, resolvingAliases));
  }
  if (requireArray(angle.constraints, "Rust path associated constraints").length > 0) {
    throw new Error(`Rust associated type constraints are not supported.`);
  }
  return Object.freeze(result);
}


function substituteRustCompilerType(
  type: RustCompilerType,
  bindings: ReadonlyMap<string, RustCompilerType>,
): RustCompilerType {
  switch (type.kind) {
    case "unit":
    case "primitive":
    case "self":
      return type;
    case "generic":
      return bindings.get(type.name) ?? type;
    case "tuple":
      return Object.freeze({
        kind: "tuple",
        elements: Object.freeze(type.elements.map((element) => substituteRustCompilerType(element, bindings))),
      });
    case "array":
      return Object.freeze({
        kind: "array",
        element: substituteRustCompilerType(type.element, bindings),
        length: type.length,
      });
    case "slice":
      return Object.freeze({
        kind: "slice",
        element: substituteRustCompilerType(type.element, bindings),
      });
    case "reference":
    case "raw-pointer":
      return Object.freeze({
        kind: type.kind,
        mutable: type.mutable,
        target: substituteRustCompilerType(type.target, bindings),
      });
    case "function-pointer":
      return Object.freeze({
        ...type,
        parameters: Object.freeze(type.parameters.map((parameter) =>
          substituteRustCompilerType(parameter, bindings))),
        result: substituteRustCompilerType(type.result, bindings),
      });
    case "path":
      return Object.freeze({
        ...type,
        typeArguments: Object.freeze(type.typeArguments.map((argument) =>
          substituteRustCompilerType(argument, bindings))),
      });
  }
}


export function rustStaticValueCanBeCopied(type: RustCompilerType): boolean {
  switch (type.kind) {
    case "unit":
    case "primitive":
    case "raw-pointer":
    case "function-pointer":
      return type.kind !== "primitive" || type.name !== "str";
    case "tuple":
      return type.elements.every(rustStaticValueCanBeCopied);
    case "array":
      return rustStaticValueCanBeCopied(type.element);
    case "reference":
      return type.mutable === false;
    case "generic":
    case "self":
    case "slice":
    case "path":
      return false;
  }
}


export function typeRequirementKey(requirement: RustCompilerTypeRequirement): string {
  return typeof requirement === "string" ? requirement : `trait:${requirement.path}`;
}

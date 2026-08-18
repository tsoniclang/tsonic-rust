import type {
  RustCompilerAssociatedConstant,
  RustCompilerDependency,
  RustCompilerEnumVariant,
  RustCompilerExport,
  RustCompilerField,
  RustCompilerFunction,
  RustCompilerModuleModel,
  RustCompilerParameter,
  RustCompilerProjectSnapshot,
  RustCompilerStandardTypeLocation,
  RustCompilerType,
  RustCompilerTypeParameter,
  RustCompilerTypeRequirement,
  RustCompilerUnsupportedExport,
  RustCompilerUnsupportedMember,
} from "./model.js";
import { rustCompilerProviderProtocolVersion } from "./model.js";
import {
  authoredPublicCanonicalPath,
  authoredPublicIdentity,
  authoredPublicKind,
  authoredPublicName,
  canonicalItemId,
  canonicalItemPath,
  expandedPublicModuleItems,
  isGlobUse,
  type ResolvedRustdocItem,
  type RustdocItemResolver,
} from "./rustdoc-items.js";
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
import {
  canonicalCompilerTypePathKey,
  canonicalPathKey,
  compilerTypeRequirementConditions,
  compilerTypeSupportsRequirement,
  directImplementationTypeParameterPositions,
  mergeTypeParameterRequirements,
  normalizeType,
  normalizeTypeParameters,
  normalizeTraitDispatch,
  normalizeTypeTraits,
  rustStaticValueCanBeCopied,
  sourceVisibleTypeParameterCount,
  substituteRustCompilerType,
  typeParameterGuaranteesRequirement,
  typeRequirementKey,
} from "./rustdoc-types.js";

export function normalizeModule(
  document: RustdocDocument,
  options: {
    readonly snapshot: RustCompilerProjectSnapshot;
    readonly dependency: RustCompilerDependency;
    readonly modulePath: readonly string[];
    readonly requestedExports?: readonly string[];
  },
  resolveItem?: RustdocItemResolver,
): RustCompilerModuleModel {
  const module = findModule(document, options.dependency, options.modulePath, resolveItem);
  const items = expandedPublicModuleItems(
    module,
    "requested Rust module",
    resolveItem,
  );
  const publicItemsByName = new Map<string, ResolvedRustdocItem>();
  const publicItemIdentitiesByName = new Map<string, string>();
  const publicNameByCanonicalPath = new Map<string, string>();
  const ambiguousNames = new Set<string>();
  for (const item of items) {
    const authored = item.item;
    if (authored.visibility !== "public" || isGlobUse(authored) ||
      !providerExportKind(authoredPublicKind(item.document, authored))) {
      continue;
    }
    const name = authoredPublicName(authored);
    if (name === undefined) {
      continue;
    }
    const identity = authoredPublicIdentity(item.document, item.dependency, authored);
    const existingIdentity = publicItemIdentitiesByName.get(name);
    if (existingIdentity === identity) {
      continue;
    }
    if (existingIdentity !== undefined) {
      publicItemsByName.delete(name);
      publicItemIdentitiesByName.delete(name);
      ambiguousNames.add(name);
    } else if (!ambiguousNames.has(name)) {
      publicItemsByName.set(name, item);
      publicItemIdentitiesByName.set(name, identity);
      const canonicalPath = authoredPublicCanonicalPath(item.document, authored);
      if (canonicalPath !== undefined) {
        publicNameByCanonicalPath.set(canonicalPathKey(canonicalPath), name);
      }
    }
  }
  const requested = new Set(options.requestedExports ?? publicItemsByName.keys());
  const exports: RustCompilerExport[] = [];
  const unsupported: RustCompilerUnsupportedExport[] = [];
  const pending = [...requested].sort(compareText);
  const visited = new Set<string>();
  while (pending.length > 0) {
    const name = pending.shift()!;
    if (visited.has(name)) {
      continue;
    }
    visited.add(name);
    if (ambiguousNames.has(name)) {
      unsupported.push({ name, reason: `Rust module exports more than one public item named '${name}'.` });
      continue;
    }
    const item = publicItemsByName.get(name);
    if (item === undefined) {
      unsupported.push({ name, reason: `Rust module does not export public item '${name}'.` });
      continue;
    }
    try {
      const authored = item.item;
      const resolved = resolveItem?.(item.document, item.dependency, authored.id) ?? {
        document: item.document,
        item: authored,
        dependency: item.dependency,
        publicName: name,
      };
      const normalized = normalizeExport(
        resolved.document,
        resolved.item,
        resolved.dependency,
        name,
        [options.dependency.targetCrateName, ...options.modulePath, name],
      );
      exports.push(normalized);
      for (const dependencyName of sameModuleExportDependencies(
        normalized,
        publicNameByCanonicalPath,
      )) {
        if (!visited.has(dependencyName)) {
          pending.push(dependencyName);
        }
      }
      pending.sort(compareText);
    } catch (error) {
      unsupported.push({
        name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  exports.sort((left, right) => compareText(left.name, right.name));
  unsupported.sort((left, right) => compareText(left.name, right.name));
  return Object.freeze({
    protocolVersion: rustCompilerProviderProtocolVersion,
    projectDigest: options.snapshot.digest,
    dependency: options.dependency,
    modulePath: Object.freeze([...options.modulePath]),
    exports: Object.freeze(exports),
    unsupportedExports: Object.freeze(unsupported),
    standardTypeLocations: Object.freeze([]) as readonly RustCompilerStandardTypeLocation[],
  });
}

function sameModuleExportDependencies(
  exported: RustCompilerExport,
  publicNameByCanonicalPath: ReadonlyMap<string, string>,
): readonly string[] {
  const names = new Set<string>();
  const visitType = (type: RustCompilerType): void => {
    switch (type.kind) {
      case "unit":
      case "primitive":
      case "generic":
      case "self":
        return;
      case "tuple":
        type.elements.forEach(visitType);
        return;
      case "array":
      case "slice":
        visitType(type.element);
        return;
      case "reference":
      case "raw-pointer":
        visitType(type.target);
        return;
      case "associated-type":
        visitType(type.owner);
        type.trait.typeArguments.forEach(visitType);
        return;
      case "function-pointer":
        type.parameters.forEach(visitType);
        visitType(type.result);
        return;
      case "path":
        type.typeArguments.forEach(visitType);
        {
          const publicName = publicNameByCanonicalPath.get(canonicalCompilerTypePathKey(type));
          if (publicName !== undefined) {
            names.add(publicName);
          }
        }
        return;
    }
  };
  const visitParameters = (parameters: readonly RustCompilerTypeParameter[]): void => {
    for (const parameter of parameters) {
      if (parameter.defaultType !== undefined) {
        visitType(parameter.defaultType);
      }
    }
  };
  const visitFunction = (fn: RustCompilerFunction): void => {
    visitParameters(fn.typeParameters);
    visitParameters(fn.typeRequirements);
    if (fn.receiver?.kind === "custom") {
      visitType(fn.receiver.type);
    }
    fn.parameters.forEach((parameter) => visitType(parameter.type));
    visitType(fn.result);
    fn.traitDispatch?.typeArguments.forEach(visitType);
  };
  switch (exported.kind) {
    case "constant":
    case "static":
      visitType(exported.type);
      break;
    case "function":
      visitFunction(exported.function);
      break;
    case "struct":
      visitParameters(exported.typeParameters);
      exported.fields.forEach((field) => visitType(field.type));
      exported.methods.forEach(visitFunction);
      exported.associatedConstants.forEach((constant) => {
        visitType(constant.type);
        constant.traitDispatch.typeArguments.forEach(visitType);
      });
      break;
    case "type-alias":
      visitParameters(exported.typeParameters);
      visitType(exported.type);
      break;
    case "enum":
      visitParameters(exported.typeParameters);
      exported.variants.forEach((variant) => variant.fields.forEach(visitType));
      exported.methods.forEach(visitFunction);
      exported.associatedConstants.forEach((constant) => {
        visitType(constant.type);
        constant.traitDispatch.typeArguments.forEach(visitType);
      });
      break;
    case "union":
      visitParameters(exported.typeParameters);
      exported.fields.forEach((field) => visitType(field.type));
      exported.methods.forEach(visitFunction);
      exported.associatedConstants.forEach((constant) => {
        visitType(constant.type);
        constant.traitDispatch.typeArguments.forEach(visitType);
      });
      break;
  }
  names.delete(exported.name);
  return Object.freeze([...names].sort(compareText));
}

function findModule(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  modulePath: readonly string[],
  resolveItem?: RustdocItemResolver,
): ResolvedRustdocItem {
  let module: ResolvedRustdocItem = {
    document,
    item: itemById(document, document.root),
    dependency,
  };
  for (const segment of modulePath) {
    const childrenByIdentity = new Map(expandedPublicModuleItems(
      module,
      `Rust module '${segment}' parent`,
      resolveItem,
    )
      .filter((child) => {
        const authored = child.item;
        return authored.visibility === "public" && !isGlobUse(authored) &&
          authoredPublicName(authored) === segment &&
          authoredPublicKind(child.document, authored) === "module";
      })
      .map((child) => [
        authoredPublicIdentity(child.document, child.dependency, child.item),
        child,
      ] as const));
    const children = [...childrenByIdentity.values()];
    if (children.length !== 1) {
      throw new Error(`Rust module path '${modulePath.join("::")}' does not resolve uniquely at '${segment}'.`);
    }
    const authoredChild = children[0]!;
    const authored = authoredChild.item;
    const child = resolveItem?.(
      authoredChild.document,
      authoredChild.dependency,
      authored.id,
    ) ?? {
      document: authoredChild.document,
      item: authored,
      dependency: authoredChild.dependency,
      publicName: segment,
    };
    if (!hasInnerKind(child.item, "module")) {
      throw new Error(`Rust item '${segment}' in module path '${modulePath.join("::")}' is not a module.`);
    }
    module = child;
  }
  return module;
}

function providerExportKind(kind: string | undefined): boolean {
  return kind === "constant" || kind === "enum" || kind === "function" ||
    kind === "static" || kind === "struct" || kind === "type_alias" || kind === "union";
}

function normalizeExport(
  document: RustdocDocument,
  item: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  publicName: string,
  targetPath: readonly string[],
): RustCompilerExport {
  const name = requireString(publicName, "Rust export name");
  const id = canonicalItemId(dependency, item);
  const canonicalPath = canonicalItemPath(document, item);
  const identity = { id, name, canonicalPath, targetPath: Object.freeze([...targetPath]) };
  if (hasInnerKind(item, "constant")) {
    const constant = requireInnerRecord(item, "constant", `Rust constant '${name}'`);
    return Object.freeze({
      kind: "constant",
      ...identity,
      type: normalizeType(document, constant.type),
    });
  }
  if (hasInnerKind(item, "static")) {
    const static_ = requireInnerRecord(item, "static", `Rust static '${name}'`);
    const mutable = requireBoolean(static_.is_mutable, `${name}.static.is_mutable`);
    const type = normalizeType(document, static_.type);
    if (!rustStaticValueCanBeCopied(type)) {
      throw new Error(`Rust static '${name}' has a value type that is not structurally proven Copy.`);
    }
    return Object.freeze({
      kind: "static",
      ...identity,
      type,
      unsafe: requireBoolean(static_.is_unsafe, `${name}.static.is_unsafe`),
      mutable,
    });
  }
  if (hasInnerKind(item, "function")) {
    return Object.freeze({
      kind: "function",
      ...identity,
      function: normalizeFunction(document, item, dependency, undefined),
    });
  }
  if (hasInnerKind(item, "struct")) {
    const struct = requireInnerRecord(item, "struct", `Rust struct '${name}'`);
    const typeParameters = normalizeTypeParameters(document, requireRecord(struct.generics, `${name}.generics`));
    const fields = normalizeFields(document, struct, dependency);
    const members = normalizeTypeMembers(document, struct, dependency, typeParameters, canonicalPath);
    return Object.freeze({
      kind: "struct",
      ...identity,
      typeParameters,
      fields: fields.values,
      methods: members.methods,
      associatedConstants: members.associatedConstants,
      unsupportedMembers: Object.freeze([...fields.unsupported, ...members.unsupported]
        .sort((left, right) => compareText(`${left.kind}\0${left.name}`, `${right.kind}\0${right.name}`))),
      traits: normalizeTypeTraits(document, struct, typeParameters, canonicalPath),
    });
  }
  if (hasInnerKind(item, "type_alias")) {
    const alias = requireInnerRecord(item, "type_alias", `Rust type alias '${name}'`);
    const generics = requireRecord(alias.generics, `${name}.generics`);
    return Object.freeze({
      kind: "type-alias",
      ...identity,
      typeParameters: normalizeTypeParameters(document, generics),
      type: normalizeType(document, alias.type),
    });
  }
  if (hasInnerKind(item, "enum")) {
    const enum_ = requireInnerRecord(item, "enum", `Rust enum '${name}'`);
    const generics = requireRecord(enum_.generics, `${name}.generics`);
    const typeParameters = normalizeTypeParameters(document, generics);
    const members = normalizeTypeMembers(document, enum_, dependency, typeParameters, canonicalPath);
    const variantsComplete = enum_.has_stripped_variants === false;
    const variants = variantsComplete
      ? normalizeEnumVariants(document, enum_, dependency)
      : { values: Object.freeze([]), unsupported: Object.freeze([]) };
    return Object.freeze({
      kind: "enum",
      ...identity,
      typeParameters,
      variantsComplete,
      variants: variants.values,
      methods: members.methods,
      associatedConstants: members.associatedConstants,
      unsupportedMembers: Object.freeze([...variants.unsupported, ...members.unsupported]
        .sort((left, right) => compareText(`${left.kind}\0${left.name}`, `${right.kind}\0${right.name}`))),
      traits: normalizeTypeTraits(document, enum_, typeParameters, canonicalPath),
    });
  }
  if (hasInnerKind(item, "union")) {
    const union = requireInnerRecord(item, "union", `Rust union '${name}'`);
    const typeParameters = normalizeTypeParameters(
      document,
      requireRecord(union.generics, `${name}.generics`),
    );
    const fields = normalizePublicFields(
      document,
      requireArray(union.fields, `${name}.fields`),
      dependency,
      "union",
    );
    const members = normalizeTypeMembers(document, union, dependency, typeParameters, canonicalPath);
    return Object.freeze({
      kind: "union",
      ...identity,
      typeParameters,
      fields: fields.values,
      methods: members.methods,
      associatedConstants: members.associatedConstants,
      unsupportedMembers: Object.freeze([...fields.unsupported, ...members.unsupported]
        .sort((left, right) => compareText(`${left.kind}\0${left.name}`, `${right.kind}\0${right.name}`))),
      traits: normalizeTypeTraits(document, union, typeParameters, canonicalPath),
    });
  }
  throw new Error(`Rust export '${name}' has no supported provider representation.`);
}

function normalizeEnumVariants(
  document: RustdocDocument,
  enum_: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
): {
  readonly values: readonly RustCompilerEnumVariant[];
  readonly unsupported: readonly RustCompilerUnsupportedMember[];
} {
  const values: RustCompilerEnumVariant[] = [];
  const unsupported: RustCompilerUnsupportedMember[] = [];
  for (const variantId of requireArray(enum_.variants, "Rust enum variants")) {
    const item = itemById(document, variantId);
    const name = requireString(item.name, "Rust enum variant name");
    try {
      const variant = requireInnerRecord(item, "variant", `Rust enum variant '${name}'`);
      if (variant.kind === "plain") {
        values.push(Object.freeze({
          kind: "plain" as const,
          id: canonicalItemId(dependency, item),
          name,
          fields: Object.freeze([]),
        }));
        continue;
      }
      const kind = requireRecord(variant.kind, `Rust enum variant '${name}' kind`);
      if (!Array.isArray(kind.tuple)) {
        throw new Error(`Rust enum variant '${name}' has a struct payload with no canonical source-call contract.`);
      }
      const fields = kind.tuple.map((fieldId) => {
        const field = itemById(document, fieldId);
        return normalizeType(
          document,
          requireInnerRecord(field, "struct_field", `Rust enum variant '${name}' field`),
        );
      });
      values.push(Object.freeze({
        kind: "tuple" as const,
        id: canonicalItemId(dependency, item),
        name,
        fields: Object.freeze(fields),
      }));
    } catch (error) {
      unsupported.push(Object.freeze({
        kind: "variant",
        name,
        reason: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  return {
    values: Object.freeze(values.sort((left, right) => compareText(left.name, right.name))),
    unsupported: Object.freeze(unsupported.sort((left, right) => compareText(left.name, right.name))),
  };
}

function normalizeFields(
  document: RustdocDocument,
  struct: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
): {
  readonly values: readonly RustCompilerField[];
  readonly unsupported: readonly RustCompilerUnsupportedMember[];
} {
  if (struct.kind === "unit") {
    return { values: Object.freeze([]), unsupported: Object.freeze([]) };
  }
  const kind = requireRecord(struct.kind, "Rust struct kind");
  const plain = isRecord(kind.plain) ? kind.plain : undefined;
  if (plain === undefined) {
    return { values: Object.freeze([]), unsupported: Object.freeze([]) };
  }
  return normalizePublicFields(
    document,
    requireArray(plain.fields, "Rust struct fields"),
    dependency,
    "struct",
  );
}

function normalizePublicFields(
  document: RustdocDocument,
  fieldIds: readonly unknown[],
  dependency: RustCompilerDependency,
  ownerKind: "struct" | "union",
): {
  readonly values: readonly RustCompilerField[];
  readonly unsupported: readonly RustCompilerUnsupportedMember[];
} {
  const fields: RustCompilerField[] = [];
  const unsupported: RustCompilerUnsupportedMember[] = [];
  for (const id of fieldIds) {
    const item = itemById(document, id);
    if (item.visibility !== "public") {
      continue;
    }
    const name = typeof item.name === "string" ? item.name : `<field:${String(id)}>`;
    try {
      const inner = requireInnerRecord(item, "struct_field", `Rust ${ownerKind} field`);
      fields.push(Object.freeze({
        id: canonicalItemId(dependency, item),
        name: requireString(item.name, "Rust field name"),
        type: normalizeType(document, inner),
      }));
    } catch (error) {
      unsupported.push(Object.freeze({
        kind: "field",
        name,
        reason: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  return {
    values: Object.freeze(fields.sort((left, right) => compareText(left.name, right.name))),
    unsupported: Object.freeze(unsupported.sort((left, right) => compareText(left.name, right.name))),
  };
}

function normalizeTypeMembers(
  document: RustdocDocument,
  owner: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  declaredTypeParameters: readonly RustCompilerTypeParameter[],
  ownerCanonicalPath: readonly string[],
): {
  readonly methods: readonly RustCompilerFunction[];
  readonly associatedConstants: readonly RustCompilerAssociatedConstant[];
  readonly unsupported: readonly RustCompilerUnsupportedMember[];
} {
  const methods: RustCompilerFunction[] = [];
  const associatedConstants: RustCompilerAssociatedConstant[] = [];
  const unsupported: RustCompilerUnsupportedMember[] = [];
  for (const implId of requireArray(owner.impls, "Rust type impls")) {
    const implItem = itemById(document, implId);
    const impl = requireInnerRecord(implItem, "impl", "Rust impl");
    if (impl.blanket_impl !== null || impl.is_negative === true || impl.is_synthetic === true) {
      continue;
    }
    const traitSelection = impl.trait === null
      ? { kind: "inherent" as const }
      : selectPublicTraitDispatch(document, impl.trait);
    if (traitSelection.kind === "not-public") {
      continue;
    }
    if (traitSelection.kind === "unsupported") {
      for (const memberId of requireArray(impl.items, "Rust impl items")) {
        const item = itemById(document, memberId);
        if (hasInnerKind(item, "function") || hasInnerKind(item, "assoc_const")) {
          unsupported.push(Object.freeze({
            kind: hasInnerKind(item, "assoc_const") ? "associated-constant" : "method",
            name: typeof item.name === "string" ? item.name : `<member:${String(memberId)}>`,
            reason: traitSelection.reason,
          }));
        }
      }
      continue;
    }
    const traitDispatch = traitSelection.kind === "selected"
      ? traitSelection.dispatch
      : undefined;
    const implGenerics = requireRecord(impl.generics, "Rust impl generics");
    let implTypeParameters: readonly RustCompilerTypeParameter[];
    let implementationBindings: ReadonlyMap<string, RustCompilerType>;
    let sourceRequirements: readonly RustCompilerTypeParameter[];
    try {
      implTypeParameters = normalizeTypeParameters(document, implGenerics);
      const selectedRequirements = sourceImplementationRequirements(
        document,
        impl,
        implTypeParameters,
        declaredTypeParameters,
        ownerCanonicalPath,
      );
      const selectedBindings = implementationTypeBindings(
        document,
        impl,
        implTypeParameters,
        declaredTypeParameters,
        ownerCanonicalPath,
      );
      if (selectedRequirements === undefined || selectedBindings === undefined) {
        throw new Error("Rust impl requirements cannot be projected onto the source-visible type arguments.");
      }
      implementationBindings = selectedBindings;
      sourceRequirements = selectedRequirements;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const methodId of requireArray(impl.items, "Rust impl items")) {
        const item = itemById(document, methodId);
        if ((traitDispatch !== undefined || item.visibility === "public") && hasInnerKind(item, "function")) {
          unsupported.push(Object.freeze({
            kind: "method",
            name: typeof item.name === "string" ? item.name : `<method:${String(methodId)}>`,
            reason,
          }));
        } else if (traitDispatch !== undefined && hasInnerKind(item, "assoc_const")) {
          unsupported.push(Object.freeze({
            kind: "associated-constant",
            name: typeof item.name === "string" ? item.name : `<associated-constant:${String(methodId)}>`,
            reason,
          }));
        }
      }
      continue;
    }
    const associatedTypeBindings = traitDispatch === undefined
      ? new Map<string, RustCompilerType>()
      : normalizeAssociatedTypeBindings(
          document,
          impl,
          traitDispatch,
          implementationBindings,
        );
    for (const methodId of requireArray(impl.items, "Rust impl items")) {
      const item = itemById(document, methodId);
      if (traitDispatch === undefined && item.visibility !== "public") {
        continue;
      }
      const name = typeof item.name === "string" ? item.name : `<method:${String(methodId)}>`;
      if (hasInnerKind(item, "assoc_type")) {
        continue;
      }
      try {
        if (hasInnerKind(item, "function")) {
          methods.push(normalizeFunction(document, item, dependency, true, sourceRequirements, {
            implementationBindings,
            associatedTypeBindings,
            ...(traitDispatch === undefined ? {} : {
              traitDispatch: substituteTraitDispatch(traitDispatch, implementationBindings),
            }),
          }));
        } else if (traitDispatch !== undefined && hasInnerKind(item, "assoc_const")) {
          const constant = requireInnerRecord(item, "assoc_const", `Rust associated constant '${name}'`);
          associatedConstants.push(Object.freeze({
            id: canonicalItemId(dependency, item),
            name: requireString(item.name, "Rust associated constant name"),
            type: normalizeMemberType(
              document,
              constant.type,
              implementationBindings,
              associatedTypeBindings,
              traitDispatch,
            ),
            traitDispatch: substituteTraitDispatch(traitDispatch, implementationBindings),
            typeRequirements: sourceRequirements,
          }));
        }
      } catch (error) {
        unsupported.push(Object.freeze({
          kind: hasInnerKind(item, "assoc_const") ? "associated-constant" : "method",
          name,
          reason: error instanceof Error ? error.message : String(error),
        }));
      }
    }
  }
  return {
    methods: Object.freeze(methods.sort((left, right) =>
      compareText(`${left.name}\0${left.id}`, `${right.name}\0${right.id}`))),
    associatedConstants: Object.freeze(associatedConstants.sort((left, right) =>
      compareText(`${left.name}\0${left.id}`, `${right.name}\0${right.id}`))),
    unsupported: Object.freeze(unsupported.sort((left, right) => compareText(left.name, right.name))),
  };
}

function selectPublicTraitDispatch(
  document: RustdocDocument,
  raw: unknown,
):
  | { readonly kind: "selected"; readonly dispatch: ReturnType<typeof normalizeTraitDispatch> }
  | { readonly kind: "not-public" }
  | { readonly kind: "unsupported"; readonly reason: string } {
  const trait = requireRecord(raw, "Rust impl trait");
  const local = document.index[String(trait.id)];
  if (isRecord(local) && local.visibility !== "public") {
    return { kind: "not-public" };
  }
  try {
    return { kind: "selected", dispatch: normalizeTraitDispatch(document, trait) };
  } catch (error) {
    return {
      kind: "unsupported",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function implementationTypeBindings(
  document: RustdocDocument,
  impl: Readonly<Record<string, unknown>>,
  implementationParameters: readonly RustCompilerTypeParameter[],
  declaredTypeParameters: readonly RustCompilerTypeParameter[],
  ownerCanonicalPath: readonly string[],
): ReadonlyMap<string, RustCompilerType> | undefined {
  const positions = directImplementationTypeParameterPositions(
    document,
    impl,
    declaredTypeParameters,
    ownerCanonicalPath,
  );
  if (positions === undefined) {
    return undefined;
  }
  const bindings = new Map<string, RustCompilerType>();
  for (const parameter of implementationParameters) {
    const index = positions.get(parameter.name);
    const declared = index === undefined ? undefined : declaredTypeParameters[index];
    if (declared === undefined) {
      return undefined;
    }
    bindings.set(parameter.name, Object.freeze({ kind: "generic", name: declared.name }));
  }
  return bindings;
}

function normalizeAssociatedTypeBindings(
  document: RustdocDocument,
  impl: Readonly<Record<string, unknown>>,
  traitDispatch: ReturnType<typeof normalizeTraitDispatch>,
  implementationBindings: ReadonlyMap<string, RustCompilerType>,
): ReadonlyMap<string, RustCompilerType> {
  const bindings = new Map<string, RustCompilerType>();
  for (const itemId of requireArray(impl.items, "Rust trait impl items")) {
    const item = itemById(document, itemId);
    if (!hasInnerKind(item, "assoc_type")) {
      continue;
    }
    const associated = requireInnerRecord(item, "assoc_type", "Rust associated type implementation");
    if (associated.type === null || associated.type === undefined) {
      continue;
    }
    const name = requireString(item.name, "Rust associated type name");
    const key = associatedTypeKey(traitDispatch.path, name);
    if (bindings.has(key)) {
      throw new Error(`Rust trait impl defines associated type '${name}' more than once.`);
    }
    bindings.set(
      key,
      substituteRustCompilerType(normalizeType(document, associated.type), implementationBindings),
    );
  }
  return bindings;
}

function normalizeMemberType(
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

function substituteTraitDispatch(
  trait: ReturnType<typeof normalizeTraitDispatch>,
  bindings: ReadonlyMap<string, RustCompilerType>,
): ReturnType<typeof normalizeTraitDispatch> {
  return Object.freeze({
    ...trait,
    typeArguments: Object.freeze(trait.typeArguments.map((argument) =>
      substituteRustCompilerType(argument, bindings))),
  });
}

function associatedTypeKey(traitPath: string, name: string): string {
  return `${traitPath}\0${name}`;
}

function sourceImplementationRequirements(
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

function normalizeFunction(
  document: RustdocDocument,
  item: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  allowReceiver: true | undefined,
  inheritedRequirements: readonly RustCompilerTypeParameter[] = Object.freeze([]),
  options: {
    readonly implementationBindings?: ReadonlyMap<string, RustCompilerType>;
    readonly associatedTypeBindings?: ReadonlyMap<string, RustCompilerType>;
    readonly traitDispatch?: ReturnType<typeof normalizeTraitDispatch>;
  } = {},
): RustCompilerFunction {
  const name = requireString(item.name, "Rust function name");
  const fn = requireInnerRecord(item, "function", `Rust function '${name}'`);
  const signature = requireRecord(fn.sig, `${name}.sig`);
  const variadic = requireBoolean(signature.is_c_variadic, `${name}.sig.is_c_variadic`);
  const header = requireRecord(fn.header, `${name}.header`);
  const unsafe = requireBoolean(header.is_unsafe, `${name}.header.is_unsafe`);
  const abi = normalizeAbi(header.abi, `${name}.header.abi`);
  const generics = requireRecord(fn.generics, `${name}.generics`);
  const typeParameters = normalizeTypeParameters(document, generics);
  const implementationBindings = options.implementationBindings ?? new Map<string, RustCompilerType>();
  const associatedTypeBindings = options.associatedTypeBindings ?? new Map<string, RustCompilerType>();
  const normalizeSelectedType = (raw: unknown): RustCompilerType => normalizeMemberType(
    document,
    raw,
    implementationBindings,
    associatedTypeBindings,
    options.traitDispatch,
  );
  const rawInputs = requireArray(signature.inputs, `${name}.inputs`);
  let receiver: RustCompilerFunction["receiver"];
  const parameters: RustCompilerParameter[] = [];
  for (let index = 0; index < rawInputs.length; index += 1) {
    const pair = rawInputs[index];
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string") {
      throw new Error(`Rust function '${name}' input ${index} has an invalid rustdoc shape.`);
    }
    const type = normalizeSelectedType(pair[1]);
    if (index === 0 && pair[0] === "self") {
      if (allowReceiver !== true) {
        throw new Error(`Free Rust function '${name}' unexpectedly declares a self receiver.`);
      }
      receiver = receiverKind(type, name);
      continue;
    }
    parameters.push(Object.freeze({ name: pair[0], type }));
  }
  const output = signature.output;
  const result = output === null
    ? Object.freeze({ kind: "unit" as const })
    : normalizeSelectedType(output);
  const borrowed = borrowedResultProjection(document, result, receiver, parameters);
  if (borrowed === undefined && !rustResultTypeHasClosedCarrier(result)) {
    throw new Error(`Rust function '${name}' returns a borrowed or unsized value with no closed target carrier.`);
  }
  const typeRequirements = mergeTypeParameterRequirements(
    inheritedRequirements,
    typeParameters,
    ...(borrowed?.typeRequirements === undefined ? [] : [borrowed.typeRequirements]),
  );
  return Object.freeze({
    id: canonicalItemId(dependency, item),
    name,
    parameters: Object.freeze(parameters),
    result,
    typeParameters,
    typeRequirements,
    ...(receiver === undefined ? {} : { receiver }),
    ...(options.traitDispatch === undefined ? {} : { traitDispatch: options.traitDispatch }),
    ...(borrowed === undefined ? {} : { borrowedResult: borrowed.projection }),
    asynchronous: header.is_async === true,
    unsafe,
    abi,
    variadic,
  });
}

function rustResultTypeHasClosedCarrier(type: RustCompilerType): boolean {
  switch (type.kind) {
    case "reference":
    case "slice":
      return false;
    case "tuple":
      return type.elements.every(rustResultTypeHasClosedCarrier);
    case "array":
      return rustResultTypeHasClosedCarrier(type.element);
    case "raw-pointer":
      return true;
    case "function-pointer":
      return type.parameters.every(rustResultTypeHasClosedCarrier) &&
        rustResultTypeHasClosedCarrier(type.result);
    case "path":
      return type.typeArguments.every(rustResultTypeHasClosedCarrier);
    case "associated-type":
      return false;
    case "unit":
    case "primitive":
    case "generic":
    case "self":
      return true;
  }
}

function receiverKind(type: RustCompilerType, functionName: string): RustCompilerFunction["receiver"] {
  if (type.kind === "self") {
    return Object.freeze({ kind: "value" });
  }
  if (type.kind === "reference" && type.target.kind === "self") {
    return Object.freeze({
      kind: type.mutable ? "mutable" : "shared",
      ...(type.lifetime === undefined ? {} : { lifetime: type.lifetime }),
    });
  }
  if (compilerTypeContainsSelf(type)) {
    if (compilerTypeContainsReference(type)) {
      throw new Error(
        `Rust method '${functionName}' has a borrowed custom receiver with no lifetime-bearing source receiver contract.`,
      );
    }
    return Object.freeze({ kind: "custom", type });
  }
  throw new Error(`Rust method '${functionName}' has a custom receiver that does not contain Self.`);
}

function compilerTypeContainsReference(type: RustCompilerType): boolean {
  switch (type.kind) {
    case "reference":
      return true;
    case "tuple":
      return type.elements.some(compilerTypeContainsReference);
    case "array":
    case "slice":
      return compilerTypeContainsReference(type.element);
    case "raw-pointer":
      return compilerTypeContainsReference(type.target);
    case "function-pointer":
      return type.parameters.some(compilerTypeContainsReference) ||
        compilerTypeContainsReference(type.result);
    case "associated-type":
      return compilerTypeContainsReference(type.owner) ||
        type.trait.typeArguments.some(compilerTypeContainsReference);
    case "path":
      return type.typeArguments.some(compilerTypeContainsReference);
    case "unit":
    case "primitive":
    case "generic":
    case "self":
      return false;
  }
}

function compilerTypeContainsSelf(type: RustCompilerType): boolean {
  switch (type.kind) {
    case "self":
      return true;
    case "tuple":
      return type.elements.some(compilerTypeContainsSelf);
    case "array":
    case "slice":
      return compilerTypeContainsSelf(type.element);
    case "reference":
    case "raw-pointer":
      return compilerTypeContainsSelf(type.target);
    case "function-pointer":
      return type.parameters.some(compilerTypeContainsSelf) || compilerTypeContainsSelf(type.result);
    case "associated-type":
      return compilerTypeContainsSelf(type.owner) ||
        type.trait.typeArguments.some(compilerTypeContainsSelf);
    case "path":
      return type.typeArguments.some(compilerTypeContainsSelf);
    case "unit":
    case "primitive":
    case "generic":
      return false;
  }
}

function borrowedResultProjection(
  document: RustdocDocument,
  result: RustCompilerType,
  receiver: RustCompilerFunction["receiver"],
  parameters: readonly RustCompilerParameter[],
): {
  readonly projection: NonNullable<RustCompilerFunction["borrowedResult"]>;
  readonly typeRequirements?: readonly RustCompilerTypeParameter[];
} | undefined {
  if (result.kind !== "reference") {
    return undefined;
  }
  if (result.mutable) {
    return undefined;
  }
  const origin = borrowedResultOrigin(result, receiver, parameters);
  if (origin === undefined) {
    return undefined;
  }
  if (result.target.kind === "primitive" && result.target.name === "str" && result.mutable === false) {
    return {
      projection: Object.freeze({
        sourceType: result.target,
        origin,
        conversion: "owned-string",
      }),
    };
  }
  const typeRequirements = compilerTypeRequirementConditions(
    document,
    result.target,
    "copy",
  );
  if (typeRequirements === undefined) {
    return undefined;
  }
  return {
    projection: Object.freeze({
      sourceType: result.target,
      origin,
      conversion: "copy",
    }),
    ...(typeRequirements.length === 0 ? {} : { typeRequirements }),
  };
}

function borrowedResultOrigin(
  result: Extract<RustCompilerType, { readonly kind: "reference" }>,
  receiver: RustCompilerFunction["receiver"],
  parameters: readonly RustCompilerParameter[],
): NonNullable<RustCompilerFunction["borrowedResult"]>["origin"] | undefined {
  if (result.lifetime === "'static") {
    return Object.freeze({ kind: "static" });
  }
  if (receiver?.kind === "shared" || receiver?.kind === "mutable") {
    if (result.lifetime === undefined || result.lifetime === receiver.lifetime) {
      return Object.freeze({ kind: "receiver" });
    }
  }
  const candidates = parameters.flatMap((parameter, index) =>
    parameter.type.kind === "reference" &&
      (result.lifetime === undefined || parameter.type.lifetime === result.lifetime)
      ? [index]
      : []);
  return candidates.length === 1
    ? Object.freeze({ kind: "parameter", index: candidates[0]! })
    : undefined;
}

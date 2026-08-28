import {
  authoredPublicCanonicalPath,
  authoredPublicIdentity,
  authoredPublicKind,
  authoredPublicName,
  canonicalItemId,
  canonicalItemPath,
  expandedPublicModuleItems,
  compilerAssociatedSourceExportName,
  isCompilerAssociatedSourceExportName,
  isGlobUse,
} from "../rustdoc-items.js";
import {
  canonicalPathKey,
  normalizeGenericParameters,
  normalizeTraitBounds,
  normalizeType,
  normalizeTypeTraits,
  rootNormalizationContext,
  rustCompilerDerivedIdentity,
  rustCompilerItemIdentity,
  rustStaticValueCanBeCopied,
} from "../rustdoc-types.js";
import {
  compareText,
  hasInnerKind,
  itemById,
  requireArray,
  requireBoolean,
  requireInnerRecord,
  requireRecord,
  requireString,
} from "../rustdoc-schema.js";
import {
  normalizeEnumVariants,
  normalizeFields,
  normalizePublicFields,
  normalizeTraitMembers,
  normalizeTypeMembers,
} from "./members.js";
import { normalizeFunction } from "./functions.js";
import { rustCompilerProviderProtocolVersion } from "../model.js";
import type {
  RustCompilerAssociatedConstraint,
  RustCompilerDependency,
  RustCompilerExport,
  RustCompilerFunction,
  RustCompilerGenericArgument,
  RustCompilerGenericParameter,
  RustCompilerModuleModel,
  RustCompilerProjectSnapshot,
  RustCompilerStandardTypeLocation,
  RustCompilerTraitDispatch,
  RustCompilerType,
  RustCompilerUnsupportedExport,
  RustCompilerUnsupportedMember,
} from "../model.js";
import type { ResolvedRustdocItem, RustdocItemResolver } from "../rustdoc-items.js";
import type { RustdocDocument } from "../rustdoc-schema.js";

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
  const items = expandedPublicModuleItems(module, "requested Rust module", resolveItem);
  const publicItemsByName = new Map<string, ResolvedRustdocItem>();
  const publicItemIdentitiesByName = new Map<string, string>();
  const publicNameByCanonicalPath = new Map<string, string>();
  const ambiguousNames = new Set<string>();
  for (const selected of items) {
    const item = selected.item;
    if (item.visibility !== "public" || isGlobUse(item) ||
      !providerExportKind(authoredPublicKind(selected.document, item))) continue;
    const name = authoredPublicName(item);
    if (name === undefined) continue;
    const identity = authoredPublicIdentity(selected.document, selected.dependency, item);
    const previous = publicItemIdentitiesByName.get(name);
    if (previous === identity) continue;
    if (previous !== undefined) {
      publicItemsByName.delete(name);
      publicItemIdentitiesByName.delete(name);
      ambiguousNames.add(name);
    } else if (!ambiguousNames.has(name)) {
      publicItemsByName.set(name, selected);
      publicItemIdentitiesByName.set(name, identity);
      const canonicalPath = authoredPublicCanonicalPath(selected.document, item);
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
    if (visited.has(name)) continue;
    visited.add(name);
    if (ambiguousNames.has(name)) {
      unsupported.push({ name, reason: `Rust module exports more than one public item named '${name}'.` });
      continue;
    }
    const authored = publicItemsByName.get(name);
    if (authored === undefined) {
      const associatedOwner = isCompilerAssociatedSourceExportName(name)
        ? associatedTypeOwnerName(
            name,
            publicItemsByName,
            resolveItem,
          )
        : undefined;
      if (associatedOwner !== undefined) {
        if (!visited.has(associatedOwner)) pending.push(associatedOwner);
        pending.sort(compareText);
        continue;
      }
      unsupported.push({ name, reason: `Rust module does not export public item '${name}'.` });
      continue;
    }
    try {
      const resolved = resolveItem?.(
        authored.document,
        authored.dependency,
        authored.item.id,
      ) ?? { ...authored, publicName: name };
      const normalized = normalizeExport(
        resolved.document,
        resolved.item,
        resolved.dependency,
        name,
        [options.dependency.targetCrateName, ...options.modulePath, name],
        resolveItem,
      );
      exports.push(normalized);
      for (const dependencyName of sameModuleExportDependencies(
        normalized,
        publicNameByCanonicalPath,
      )) {
        if (!visited.has(dependencyName)) pending.push(dependencyName);
      }
      pending.sort(compareText);
    } catch (error) {
      unsupported.push({ name, reason: error instanceof Error ? error.message : String(error) });
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

function associatedTypeOwnerName(
  requestedName: string,
  publicItemsByName: ReadonlyMap<string, ResolvedRustdocItem>,
  resolveItem?: RustdocItemResolver,
): string | undefined {
  let selectedOwner: string | undefined;
  for (const [publicName, authored] of publicItemsByName) {
    const resolved = resolveItem?.(
      authored.document,
      authored.dependency,
      authored.item.id,
    ) ?? authored;
    if (!hasInnerKind(resolved.item, "trait")) continue;
    const trait = requireInnerRecord(
      resolved.item,
      "trait",
      `Rust trait '${publicName}'`,
    );
    const ownerIdentity = rustCompilerItemIdentity(
      resolved.document,
      resolved.dependency,
      resolved.item,
    );
    for (const itemId of requireArray(trait.items, `Rust trait '${publicName}' items`)) {
      const member = itemById(resolved.document, itemId);
      if (!hasInnerKind(member, "assoc_type") || typeof member.name !== "string") continue;
      const identity = rustCompilerDerivedIdentity(ownerIdentity, `associated:${member.name}`);
      if (compilerAssociatedSourceExportName(identity.itemId, member.name) !== requestedName) {
        continue;
      }
      if (selectedOwner !== undefined && selectedOwner !== publicName) {
        throw new Error(
          `Generated Rust associated source export '${requestedName}' belongs to more than one public trait.`,
        );
      }
      selectedOwner = publicName;
    }
  }
  return selectedOwner;
}

function normalizeExport(
  document: RustdocDocument,
  item: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  publicName: string,
  targetPath: readonly string[],
  resolveItem?: RustdocItemResolver,
): RustCompilerExport {
  const name = requireString(publicName, "Rust export name");
  const itemIdentity = rustCompilerItemIdentity(document, dependency, item);
  const identity = {
    id: canonicalItemId(dependency, item),
    name,
    canonicalPath: canonicalItemPath(document, item),
    targetPath: Object.freeze([...targetPath]),
  };
  const root = rootNormalizationContext(document, dependency, item, resolveItem);
  if (hasInnerKind(item, "constant")) {
    const constant = requireInnerRecord(item, "constant", `Rust constant '${name}'`);
    return Object.freeze({
      kind: "constant",
      ...identity,
      type: normalizeType(document, constant.type, root),
    });
  }
  if (hasInnerKind(item, "static")) {
    const static_ = requireInnerRecord(item, "static", `Rust static '${name}'`);
    const mutable = requireBoolean(static_.is_mutable, `${name}.static.is_mutable`);
    const type = normalizeType(document, static_.type, root);
    return Object.freeze({
      kind: "static",
      ...identity,
      type,
      unsafe: requireBoolean(static_.is_unsafe, `${name}.static.is_unsafe`),
      mutable,
      copy: rustStaticValueCanBeCopied(type),
    });
  }
  if (hasInnerKind(item, "function")) {
    return Object.freeze({
      kind: "function",
      ...identity,
      function: normalizeFunction(document, item, dependency, undefined, {
        ...(resolveItem === undefined ? {} : { resolveItem }),
      }),
    });
  }
  if (hasInnerKind(item, "type_alias")) {
    const alias = requireInnerRecord(item, "type_alias", `Rust type alias '${name}'`);
    const generics = normalizeGenericParameters(
      document,
      requireRecord(alias.generics, `${name}.generics`),
      root,
    );
    return Object.freeze({
      kind: "type-alias",
      ...identity,
      genericParameters: generics.parameters,
      type: normalizeType(document, alias.type, generics.context),
    });
  }
  if (hasInnerKind(item, "trait")) {
    const trait = requireInnerRecord(item, "trait", `Rust trait '${name}'`);
    const generics = normalizeGenericParameters(
      document,
      requireRecord(trait.generics, `${name}.generics`),
      root,
    );
    const traitDispatch: RustCompilerTraitDispatch = Object.freeze({
      identity: itemIdentity,
      path: itemIdentity.canonicalPath.join("::"),
      genericArguments: Object.freeze(generics.parameters.map(
        compilerGenericParameterArgument,
      )),
      associatedConstraints: Object.freeze([]),
    });
    const members = normalizeTraitMembers(
      document,
      trait,
      dependency,
      generics.parameters,
      itemIdentity,
      traitDispatch,
      generics.context,
      resolveItem,
    );
    const bounds = normalizeTraitBounds(
      document,
      requireArray(trait.bounds, `${name}.bounds`),
      generics.context,
    );
    if (bounds.maybeSized) {
      throw new Error(`Rust trait '${name}' has an invalid optional Sized supertrait.`);
    }
    return Object.freeze({
      kind: "trait",
      ...identity,
      genericParameters: generics.parameters,
      methods: members.methods,
      associatedConstants: members.associatedConstants,
      associatedTypes: members.associatedTypes,
      unsupportedMembers: members.unsupported,
      superTraits: bounds.traits,
      outlives: bounds.outlives,
      auto: trait.is_auto === true,
      unsafe: trait.is_unsafe === true,
    });
  }
  const declarationKind = hasInnerKind(item, "struct")
    ? "struct" as const
    : hasInnerKind(item, "enum")
      ? "enum" as const
      : hasInnerKind(item, "union")
        ? "union" as const
        : undefined;
  if (declarationKind === undefined) {
    throw new Error(`Rust export '${name}' has no supported provider representation.`);
  }
  const declaration = requireInnerRecord(item, declarationKind, `Rust ${declarationKind} '${name}'`);
  const generics = normalizeGenericParameters(
    document,
    requireRecord(declaration.generics, `${name}.generics`),
    root,
  );
  const members = normalizeTypeMembers(
    document,
    declaration,
    dependency,
    generics.parameters,
    itemIdentity,
    resolveItem,
  );
  const common = {
    ...identity,
    genericParameters: generics.parameters,
    methods: members.methods,
    associatedConstants: members.associatedConstants,
    unsupportedMembers: members.unsupported,
    traits: normalizeTypeTraits(
      document,
      dependency,
      declaration,
      generics.parameters,
      itemIdentity,
      resolveItem,
    ),
  };
  if (declarationKind === "struct") {
    const fields = normalizeFields(document, declaration, dependency, generics.context);
    return Object.freeze({
      kind: declarationKind,
      ...common,
      fields: fields.values,
      unsupportedMembers: mergeUnsupported(common.unsupportedMembers, fields.unsupported),
    });
  }
  if (declarationKind === "enum") {
    const variantsComplete = declaration.has_stripped_variants === false;
    const variants = variantsComplete
      ? normalizeEnumVariants(document, declaration, dependency, generics.context)
      : { values: Object.freeze([]), unsupported: Object.freeze([]) };
    return Object.freeze({
      kind: declarationKind,
      ...common,
      variantsComplete,
      variants: variants.values,
      unsupportedMembers: mergeUnsupported(common.unsupportedMembers, variants.unsupported),
    });
  }
  const fields = normalizePublicFields(
    document,
    requireArray(declaration.fields, `${name}.fields`),
    dependency,
    "union",
    generics.context,
  );
  return Object.freeze({
    kind: declarationKind,
    ...common,
    fields: fields.values,
    unsupportedMembers: mergeUnsupported(common.unsupportedMembers, fields.unsupported),
  });
}

function sameModuleExportDependencies(
  exported: RustCompilerExport,
  publicNameByCanonicalPath: ReadonlyMap<string, string>,
): readonly string[] {
  const names = new Set<string>();
  const selectIdentity = (canonicalPath: readonly string[]): void => {
    const selected = publicNameByCanonicalPath.get(canonicalPathKey(canonicalPath));
    if (selected !== undefined) names.add(selected);
  };
  const visitArgument = (argument: RustCompilerGenericArgument): void => {
    if (argument.kind === "type") visitType(argument.type);
  };
  const visitConstraint = (constraint: RustCompilerAssociatedConstraint): void => {
    constraint.genericArguments.forEach(visitArgument);
    if (constraint.kind === "equality") visitType(constraint.type);
    else constraint.traits.forEach(visitTrait);
  };
  const visitTraitArguments = (trait: RustCompilerTraitDispatch): void => {
    trait.genericArguments.forEach(visitArgument);
    trait.associatedConstraints.forEach(visitConstraint);
  };
  const visitTrait = (trait: RustCompilerTraitDispatch): void => {
    selectIdentity(trait.identity.canonicalPath);
    visitTraitArguments(trait);
  };
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
      case "function-pointer":
        type.parameters.forEach(visitType);
        visitType(type.result);
        return;
      case "trait-object":
        visitTrait(type.principal);
        type.autoTraits.forEach(visitTrait);
        return;
      case "opaque":
        type.bounds.forEach(visitTrait);
        type.captures.forEach(visitArgument);
        return;
      case "associated-type":
        visitType(type.owner);
        visitTrait(type.trait);
        type.genericArguments.forEach(visitArgument);
        return;
      case "path":
        selectIdentity(type.identity.canonicalPath);
        type.genericArguments.forEach(visitArgument);
    }
  };
  const visitGenericParameters = (parameters: readonly RustCompilerGenericParameter[]): void => {
    for (const parameter of parameters) {
      if (parameter.kind === "type") {
        parameter.requirements.forEach((requirement) => {
          if (typeof requirement !== "string") visitTrait(requirement.trait);
        });
        if (parameter.defaultType !== undefined) visitType(parameter.defaultType);
      } else if (parameter.kind === "const") {
        visitType(parameter.type);
      }
    }
  };
  const visitFunction = (fn: RustCompilerFunction): void => {
    visitGenericParameters(fn.genericParameters);
    visitGenericParameters(fn.typeRequirements);
    if (fn.receiver?.kind === "custom") visitType(fn.receiver.type);
    fn.parameters.forEach((parameter) => visitType(parameter.type));
    visitType(fn.result);
    if (fn.traitDispatch !== undefined) visitTraitArguments(fn.traitDispatch);
  };
  switch (exported.kind) {
    case "constant":
    case "static":
      visitType(exported.type);
      break;
    case "function":
      visitFunction(exported.function);
      break;
    case "type-alias":
      visitGenericParameters(exported.genericParameters);
      visitType(exported.type);
      break;
    case "struct":
    case "union":
      visitGenericParameters(exported.genericParameters);
      exported.fields.forEach((field) => visitType(field.type));
      exported.methods.forEach(visitFunction);
      exported.associatedConstants.forEach((constant) => {
        visitType(constant.type);
        visitTraitArguments(constant.traitDispatch);
      });
      break;
    case "enum":
      visitGenericParameters(exported.genericParameters);
      exported.variants.forEach((variant) => variant.fields.forEach((field) =>
        visitType(variant.kind === "struct" ? field.type : field)));
      exported.methods.forEach(visitFunction);
      exported.associatedConstants.forEach((constant) => {
        visitType(constant.type);
        visitTraitArguments(constant.traitDispatch);
      });
      break;
    case "trait":
      visitGenericParameters(exported.genericParameters);
      exported.superTraits.forEach(visitTrait);
      exported.methods.forEach(visitFunction);
      exported.associatedConstants.forEach((constant) => {
        visitType(constant.type);
        visitTraitArguments(constant.traitDispatch);
      });
      exported.associatedTypes.forEach((associated) => {
        visitGenericParameters(associated.genericParameters);
        associated.requirements.forEach((requirement) => {
          if (typeof requirement !== "string") visitTrait(requirement.trait);
        });
        if (associated.defaultType !== undefined) visitType(associated.defaultType);
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
      .filter((child) => child.item.visibility === "public" && !isGlobUse(child.item) &&
        authoredPublicName(child.item) === segment &&
        authoredPublicKind(child.document, child.item) === "module")
      .map((child) => [
        authoredPublicIdentity(child.document, child.dependency, child.item),
        child,
      ] as const));
    const children = [...childrenByIdentity.values()];
    if (children.length !== 1) {
      throw new Error(`Rust module path '${modulePath.join("::")}' does not resolve uniquely at '${segment}'.`);
    }
    const authored = children[0]!;
    module = resolveItem?.(authored.document, authored.dependency, authored.item.id) ?? authored;
    if (!hasInnerKind(module.item, "module")) {
      throw new Error(`Rust item '${segment}' in module path '${modulePath.join("::")}' is not a module.`);
    }
  }
  return module;
}

function providerExportKind(kind: string | undefined): boolean {
  return kind === "constant" || kind === "enum" || kind === "function" ||
    kind === "static" || kind === "struct" || kind === "trait" ||
    kind === "type_alias" || kind === "union";
}

function compilerGenericParameterArgument(
  parameter: RustCompilerGenericParameter,
): RustCompilerGenericArgument {
  if (parameter.kind === "lifetime") {
    return Object.freeze({ kind: "lifetime", lifetime: parameter.lifetime });
  }
  if (parameter.kind === "type") {
    return Object.freeze({
      kind: "type",
      type: Object.freeze({
        kind: "generic",
        identity: parameter.identity,
        name: parameter.name,
      }),
    });
  }
  return Object.freeze({
    kind: "const",
    value: Object.freeze({
      kind: "parameter",
      identity: parameter.identity,
      name: parameter.name,
    }),
  });
}

function mergeUnsupported(
  left: readonly RustCompilerUnsupportedMember[],
  right: readonly RustCompilerUnsupportedMember[],
): readonly RustCompilerUnsupportedMember[] {
  return Object.freeze([...left, ...right].sort((a, b) =>
    compareText(`${a.kind}\0${a.name}`, `${b.kind}\0${b.name}`)));
}

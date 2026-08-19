import {
  authoredPublicCanonicalPath,
  authoredPublicIdentity,
  authoredPublicKind,
  authoredPublicName,
  canonicalItemId,
  canonicalItemPath,
  expandedPublicModuleItems,
  isGlobUse,
} from "../rustdoc-items.js";
import {
  canonicalCompilerTypePathKey,
  canonicalPathKey,
  normalizeType,
  normalizeTypeParameters,
  normalizeTypeTraits,
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
import { normalizeEnumVariants, normalizeFields, normalizePublicFields, normalizeTypeMembers } from "./members.js";
import { normalizeFunction } from "./functions.js";
import { rustCompilerProviderProtocolVersion } from "../model.js";
import type {
  RustCompilerDependency,
  RustCompilerExport,
  RustCompilerFunction,
  RustCompilerModuleModel,
  RustCompilerProjectSnapshot,
  RustCompilerStandardTypeLocation,
  RustCompilerType,
  RustCompilerTypeParameter,
  RustCompilerUnsupportedExport,
} from "../model.js";
import type {
  ResolvedRustdocItem,
  RustdocItemResolver,
} from "../rustdoc-items.js";
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

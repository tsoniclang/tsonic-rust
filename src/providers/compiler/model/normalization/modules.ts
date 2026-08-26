import {
  authoredPublicCanonicalPath,
  authoredPublicIdentity,
  authoredPublicKind,
  authoredPublicName,
  canonicalCompilerItemIdentity,
  canonicalItemId,
  compilerAssociatedSourceExportName,
  expandedPublicModuleItems,
  isGlobUse,
} from "../rustdoc-items.js";
import {
  canonicalPathKey,
  genericParameterMap,
  normalizeGenerics,
  normalizeRustCompilerBound,
  normalizeType,
  normalizeTypeTraits,
  type RustCompilerNormalizationContext,
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
  rustdocItemStability,
  rustdocOtherAttributes,
} from "../rustdoc-schema.js";
import {
  normalizeEnumVariants,
  normalizeFields,
  normalizePublicFields,
  normalizeTraitItems,
  normalizeTypeMembers,
} from "./members.js";
import { normalizeFunction } from "./functions.js";
import { rustCompilerProviderProtocolVersion } from "../model.js";
import type {
  RustCompilerDependency,
  RustCompilerExport,
  RustCompilerGenericArgument,
  RustCompilerImplementation,
  RustCompilerLayout,
  RustCompilerModuleModel,
  RustCompilerProjectSnapshot,
  RustCompilerStandardItemLocation,
  RustCompilerTraitReference,
  RustCompilerUnsupportedExport,
} from "../model.js";
import type { ResolvedRustdocItem, RustdocItemResolver } from "../rustdoc-items.js";
import type { RustdocDocument } from "../rustdoc-schema.js";
import { visitRustCompilerExportReferences } from "../references.js";

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
  const identitiesByName = new Map<string, string>();
  const publicNameByCanonicalPath = new Map<string, string>();
  const ambiguousNames = new Set<string>();
  for (const selected of items) {
    const item = selected.item;
    if (item.visibility !== "public" || isGlobUse(item) ||
      rustdocItemStability(item) === "unstable" ||
      !providerExportKind(authoredPublicKind(selected.document, item))) continue;
    const name = authoredPublicName(item);
    if (name === undefined) continue;
    const identity = authoredPublicIdentity(selected.document, selected.dependency, item);
    const previous = identitiesByName.get(name);
    if (previous === identity) continue;
    if (previous !== undefined) {
      publicItemsByName.delete(name);
      identitiesByName.delete(name);
      ambiguousNames.add(name);
      continue;
    }
    if (!ambiguousNames.has(name)) {
      publicItemsByName.set(name, selected);
      identitiesByName.set(name, identity);
      const canonicalPath = authoredPublicCanonicalPath(selected.document, item);
      if (canonicalPath !== undefined) publicNameByCanonicalPath.set(canonicalPathKey(canonicalPath), name);
    }
  }
  const requested = new Set(options.requestedExports ?? publicItemsByName.keys());
  const associatedExportOwners = indexAssociatedExportOwners(publicItemsByName, resolveItem);
  const exports: RustCompilerExport[] = [];
  const implementations = new Map<string, RustCompilerImplementation>();
  const unsupported: RustCompilerUnsupportedExport[] = [];
  const pending = [...requested].sort(compareText);
  const visited = new Set<string>();
  while (pending.length > 0) {
    const requestedName = pending.shift()!;
    const name = publicItemsByName.has(requestedName)
      ? requestedName
      : associatedExportOwners.get(requestedName) ?? requestedName;
    if (visited.has(name)) continue;
    visited.add(name);
    if (ambiguousNames.has(name)) {
      unsupported.push({ name, reason: `Rust module exports more than one public item named '${name}'.` });
      continue;
    }
    const authored = publicItemsByName.get(name);
    if (authored === undefined) {
      unsupported.push({ name: requestedName, reason: `Rust module does not export public item '${requestedName}'.` });
      continue;
    }
    try {
      const resolved = resolveItem?.(authored.document, authored.dependency, authored.item.id) ?? authored;
      const normalized = normalizeExport(
        resolved.document,
        resolved.item,
        resolved.dependency,
        name,
        [options.dependency.targetCrateName, ...options.modulePath, name],
        resolveItem,
      );
      exports.push(normalized.exported);
      for (const implementation of normalized.implementations) {
        implementations.set(implementationIdentityKey(implementation), implementation);
      }
      for (const dependencyName of sameModuleExportDependencies(normalized.exported, publicNameByCanonicalPath)) {
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
    implementations: Object.freeze([...implementations.values()].sort((left, right) =>
      compareText(left.identity.itemId, right.identity.itemId))),
    unsupportedExports: Object.freeze(unsupported),
    standardItemLocations: Object.freeze([]) as readonly RustCompilerStandardItemLocation[],
  });
}

function indexAssociatedExportOwners(
  publicItemsByName: ReadonlyMap<string, ResolvedRustdocItem>,
  resolveItem?: RustdocItemResolver,
): ReadonlyMap<string, string> {
  const owners = new Map<string, { readonly ownerName: string; readonly ownerIdentity: string }>();
  for (const [ownerName, authored] of publicItemsByName) {
    const resolved = resolveItem?.(authored.document, authored.dependency, authored.item.id) ?? authored;
    if (!hasInnerKind(resolved.item, "trait")) continue;
    const declaration = requireInnerRecord(resolved.item, "trait", `Rust trait '${ownerName}'`);
    const ownerIdentity = canonicalItemId(resolved.dependency, resolved.item);
    for (const itemId of requireArray(declaration.items, `Rust trait '${ownerName}' items`)) {
      const associated = itemById(resolved.document, itemId);
      if (!hasInnerKind(associated, "assoc_type") || rustdocItemStability(associated) === "unstable") continue;
      const associatedName = requireString(associated.name, `Rust trait '${ownerName}' associated type name`);
      const exportName = compilerAssociatedSourceExportName(
        canonicalItemId(resolved.dependency, associated),
        associatedName,
      );
      const existing = owners.get(exportName);
      if (existing !== undefined && existing.ownerIdentity !== ownerIdentity) {
        throw new Error(`Rust generated associated export '${exportName}' has conflicting trait owners.`);
      }
      if (existing === undefined || compareText(ownerName, existing.ownerName) < 0) {
        owners.set(exportName, Object.freeze({ ownerName, ownerIdentity }));
      }
    }
  }
  return new Map([...owners].map(([exportName, owner]) => [exportName, owner.ownerName]));
}

function normalizeExport(
  document: RustdocDocument,
  item: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  publicName: string,
  targetPath: readonly string[],
  resolveItem?: RustdocItemResolver,
): { readonly exported: RustCompilerExport; readonly implementations: readonly RustCompilerImplementation[] } {
  const name = requireString(publicName, "Rust export name");
  const identity = canonicalCompilerItemIdentity(document, dependency, item);
  const base = { identity, name, targetPath: Object.freeze([...targetPath]) };
  const baseContext: RustCompilerNormalizationContext = {
    dependency,
    owner: identity,
    ...(resolveItem === undefined ? {} : { resolveItem }),
  };
  if (hasInnerKind(item, "constant")) {
    const constant = requireInnerRecord(item, "constant", `Rust constant '${name}'`);
    return { exported: Object.freeze({ kind: "constant", ...base, type: normalizeType(document, constant.type, baseContext) }), implementations: Object.freeze([]) };
  }
  if (hasInnerKind(item, "static")) {
    const static_ = requireInnerRecord(item, "static", `Rust static '${name}'`);
    const mutable = requireBoolean(static_.is_mutable, `${name}.static.is_mutable`);
    const type = normalizeType(document, static_.type, baseContext);
    return {
      exported: Object.freeze({
        kind: "static",
        ...base,
        type,
        safety: requireBoolean(static_.is_unsafe, `${name}.static.is_unsafe`) ? "unsafe" : "safe",
        mutable,
        threadLocal: hasAttribute(item, "thread_local"),
      }),
      implementations: Object.freeze([]),
    };
  }
  if (hasInnerKind(item, "function")) {
    return {
      exported: Object.freeze({
        kind: "function",
        ...base,
        function: normalizeFunction(document, item, dependency, undefined, {
          ...(resolveItem === undefined ? {} : { resolveItem }),
        }),
      }),
      implementations: Object.freeze([]),
    };
  }
  if (hasInnerKind(item, "type_alias")) {
    const alias = requireInnerRecord(item, "type_alias", `Rust type alias '${name}'`);
    const generics = normalizeGenerics(document, requireRecord(alias.generics, `${name}.generics`), baseContext);
    const context = { ...baseContext, parameters: genericParameterMap(generics) };
    return {
      exported: Object.freeze({ kind: "type-alias", ...base, generics, type: normalizeType(document, alias.type, context) }),
      implementations: Object.freeze([]),
    };
  }
  if (hasInnerKind(item, "struct") || hasInnerKind(item, "enum") || hasInnerKind(item, "union") || hasInnerKind(item, "trait")) {
    const kind = hasInnerKind(item, "struct")
      ? "struct" as const
      : hasInnerKind(item, "enum")
        ? "enum" as const
        : hasInnerKind(item, "union")
          ? "union" as const
          : "trait" as const;
    const declaration = requireInnerRecord(item, kind, `Rust ${kind} '${name}'`);
    const generics = normalizeGenerics(
      document,
      requireRecord(declaration.generics, `${name}.generics`),
      {
        ...baseContext,
        genericOwnerKind: kind === "trait" ? "trait" : "declaration",
      },
    );
    const context: RustCompilerNormalizationContext = { ...baseContext, parameters: genericParameterMap(generics) };
    const layout = normalizeLayout(item);
    if (kind === "trait") {
      const traitReference: RustCompilerTraitReference = Object.freeze({
        identity,
        displayPath: identity.canonicalPath,
        arguments: Object.freeze(generics.parameters
          .filter((parameter) =>
            parameter.kind !== "type" || parameter.declarationKind === "explicit")
          .map(genericParameterAsArgument)),
        associatedConstraints: Object.freeze([]),
      });
      const members = normalizeTraitItems(document, declaration, dependency, generics, context, traitReference);
      const superTraits = requireArray(declaration.bounds, `${name}.bounds`).map((bound, index) =>
        normalizeRustCompilerBound(
          document,
          bound,
          { ...context, position: `super-trait-${index}` },
        ));
      return {
        exported: Object.freeze({
          kind,
          ...base,
          generics,
          methods: members.methods,
          associatedConstants: members.associatedConstants,
          associatedTypes: members.associatedTypes,
          unsupportedMembers: members.unsupported,
          traits: Object.freeze({ implementations: Object.freeze([]) }),
          layout,
          safety: declaration.is_unsafe === true ? "unsafe" : "safe",
          auto: declaration.is_auto === true,
          implementationItemsRequired: traitImplementationItemsRequired(
            document,
            declaration,
          ),
          superTraits: Object.freeze(superTraits),
        }),
        implementations: members.implementations,
      };
    }
    const members = normalizeTypeMembers(
      document,
      declaration,
      dependency,
      generics,
      identity,
      identity.canonicalPath,
      resolveItem,
    );
    const common = {
      ...base,
      generics,
      methods: members.methods,
      associatedConstants: members.associatedConstants,
      associatedTypes: members.associatedTypes,
      unsupportedMembers: members.unsupported,
      traits: normalizeTypeTraits(document, declaration, generics, identity.canonicalPath, context),
      layout,
    };
    if (kind === "struct") {
      const fields = normalizeFields(document, declaration, dependency, context);
      return {
        exported: Object.freeze({
          kind,
          ...common,
          fields: fields.values,
          unsupportedMembers: mergeUnsupported(common.unsupportedMembers, fields.unsupported),
        }),
        implementations: members.implementations,
      };
    }
    if (kind === "enum") {
      const variantsComplete = declaration.has_stripped_variants === false;
      const variants = variantsComplete
        ? normalizeEnumVariants(document, declaration, dependency, context)
        : { values: Object.freeze([]), unsupported: Object.freeze([]) };
      return {
        exported: Object.freeze({
          kind,
          ...common,
          variantsComplete,
          variants: variants.values,
          unsupportedMembers: mergeUnsupported(common.unsupportedMembers, variants.unsupported),
        }),
        implementations: members.implementations,
      };
    }
    const fields = normalizePublicFields(
      document,
      requireArray(declaration.fields, `${name}.fields`),
      dependency,
      "union",
      context,
      true,
    );
    return {
      exported: Object.freeze({
        kind,
        ...common,
        fields: fields.values,
        unsupportedMembers: mergeUnsupported(common.unsupportedMembers, fields.unsupported),
      }),
      implementations: members.implementations,
    };
  }
  throw new Error(`Rust export '${name}' has no supported provider representation.`);
}

function traitImplementationItemsRequired(
  document: RustdocDocument,
  trait: Readonly<Record<string, unknown>>,
): boolean {
  for (const itemId of requireArray(trait.items, "Rust trait items")) {
    const item = itemById(document, itemId);
    if (hasInnerKind(item, "function")) {
      const callable = requireInnerRecord(item, "function", "Rust trait function");
      if (callable.has_body !== true) return true;
      continue;
    }
    if (hasInnerKind(item, "assoc_const")) {
      const constant = requireInnerRecord(item, "assoc_const", "Rust trait associated constant");
      if (constant.value === null || constant.value === undefined) return true;
      continue;
    }
    if (hasInnerKind(item, "assoc_type")) {
      const associated = requireInnerRecord(item, "assoc_type", "Rust trait associated type");
      if (associated.type === null || associated.type === undefined) return true;
    }
  }
  return false;
}

function implementationIdentityKey(implementation: RustCompilerImplementation): string {
  const identity = implementation.identity;
  return `${canonicalPathKey(identity.canonicalPath)}\0${identity.itemId}`;
}

function sameModuleExportDependencies(
  exported: RustCompilerExport,
  publicNameByCanonicalPath: ReadonlyMap<string, string>,
): readonly string[] {
  const names = new Set<string>();
  const select = (identity: import("../model.js").RustCompilerItemIdentity): void => {
    const selected = publicNameByCanonicalPath.get(canonicalPathKey(identity.canonicalPath));
    if (selected !== undefined) names.add(selected);
  };
  visitRustCompilerExportReferences(exported, { type: select, trait: select });
  names.delete(exported.name);
  return Object.freeze([...names].sort(compareText));
}

function findModule(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  modulePath: readonly string[],
  resolveItem?: RustdocItemResolver,
): ResolvedRustdocItem {
  let module: ResolvedRustdocItem = { document, item: itemById(document, document.root), dependency };
  for (const segment of modulePath) {
    const children = expandedPublicModuleItems(module, `Rust module '${segment}' parent`, resolveItem)
      .filter((child) => child.item.visibility === "public" && !isGlobUse(child.item) &&
        authoredPublicName(child.item) === segment && authoredPublicKind(child.document, child.item) === "module");
    if (children.length !== 1) throw new Error(`Rust module path '${modulePath.join("::")}' does not resolve uniquely at '${segment}'.`);
    const authored = children[0]!;
    module = resolveItem?.(authored.document, authored.dependency, authored.item.id) ?? authored;
    if (!hasInnerKind(module.item, "module")) throw new Error(`Rust item '${segment}' is not a module.`);
  }
  return module;
}

function providerExportKind(kind: string | undefined): boolean {
  return kind === "constant" || kind === "enum" || kind === "function" || kind === "static" ||
    kind === "struct" || kind === "trait" || kind === "type_alias" || kind === "union";
}

function normalizeLayout(item: Readonly<Record<string, unknown>>): RustCompilerLayout {
  const attributes = rustdocOtherAttributes(item);
  let representation: RustCompilerLayout["representation"] = "rust";
  let packed: RustCompilerLayout["packed"];
  let alignment: RustCompilerLayout["alignment"];
  for (const attribute of attributes) {
    const compact = attribute.replace(/\s+/gu, "");
    if (compact === "#[repr(C)]") representation = "c";
    else if (compact === "#[repr(transparent)]") representation = "transparent";
    else {
      const packedMatch = /^#\[repr\(packed(?:\(([0-9]+)\))?\)\]$/u.exec(compact);
      const alignMatch = /^#\[repr\(align\(([0-9]+)\)\)\]$/u.exec(compact);
      if (packedMatch !== null) packed = Object.freeze({ kind: "literal", literalKind: "integer", value: BigInt(packedMatch[1] ?? "1") });
      else if (alignMatch !== null) alignment = Object.freeze({ kind: "literal", literalKind: "integer", value: BigInt(alignMatch[1]!) });
    }
  }
  return Object.freeze({ representation, ...(packed === undefined ? {} : { packed }), ...(alignment === undefined ? {} : { alignment }) });
}

function hasAttribute(item: Readonly<Record<string, unknown>>, name: string): boolean {
  return rustdocOtherAttributes(item).some((entry) =>
    entry.replace(/\s+/gu, "") === `#[${name}]`);
}

function genericParameterAsArgument(
  parameter: import("../model.js").RustCompilerGenericParameter,
): RustCompilerGenericArgument {
  switch (parameter.kind) {
    case "lifetime": return Object.freeze({ kind: "lifetime", value: parameter.identity });
    case "type": return Object.freeze({ kind: "type", value: Object.freeze({ kind: "type-parameter", identity: parameter.identity, displayName: parameter.displayName }) });
    case "const": return Object.freeze({
      kind: "const",
      value: Object.freeze({
        kind: "parameter",
        identity: parameter.identity,
        displayName: parameter.displayName,
      }),
    });
  }
}

function mergeUnsupported(
  left: readonly import("../model.js").RustCompilerUnsupportedMember[],
  right: readonly import("../model.js").RustCompilerUnsupportedMember[],
): readonly import("../model.js").RustCompilerUnsupportedMember[] {
  return Object.freeze([...left, ...right].sort((a, b) => compareText(`${a.kind}\0${a.name}`, `${b.kind}\0${b.name}`)));
}

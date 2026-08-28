import type {
  RustCompilerDependency,
  RustCompilerFunction,
  RustCompilerGenericArgument,
  RustCompilerGenericParameter,
  RustCompilerModuleModel,
  RustCompilerProjectSnapshot,
  RustCompilerStandardLibrarySnapshot,
  RustCompilerStandardTypeLocation,
  RustCompilerType,
} from "../model/model.js";
import {
  verifyRustCompilerDependencySource,
  verifyRustCompilerStandardLibraryMetadata,
} from "../snapshot/cargo-snapshot.js";
import { standardModuleSpecifier } from "./module-specifier.js";
import {
  digestText,
  loadRustdocDocument,
  validateDependencyBelongsToSnapshot,
} from "../snapshot/rustdoc-artifact.js";
import {
  authoredPublicCanonicalPath,
  authoredPublicKind,
  authoredPublicName,
  canonicalItemId,
  isGlobUse,
  rustdocPathIdentity,
  type ResolvedRustdocItem,
} from "../model/rustdoc-items.js";
import {
  compareText,
  hasInnerKind,
  isRecord,
  itemById,
  requireArray,
  requireInnerRecord,
  requireRecord,
  requireString,
  type RustdocDocument,
} from "../model/rustdoc-schema.js";
import {
  canonicalPathKey,
  compilerTypeRequirementCanonicalPath,
  normalizeGenericParameters,
  rootNormalizationContext,
  standardTypePathKind,
} from "../model/rustdoc-types.js";

export interface RustStandardLibraryContext {
  readonly snapshot: RustCompilerStandardLibrarySnapshot;
  readonly targetDirectory: string;
  readonly publicDocument: RustdocDocument;
  readonly documentsByCrate: Map<string, RustdocDocument>;
  readonly itemIdsByCanonicalIdentity: Map<string, ReadonlyMap<string, string>>;
  readonly publicTypeAliasesByCrate: Map<string, Map<string, readonly string[]>>;
  readonly typeLocationsByCanonicalPath: Map<string, RustCompilerStandardTypeLocation>;
}

const standardLibraryContexts = new Map<string, RustStandardLibraryContext>();

export function loadStandardLibraryContext(
  snapshot: RustCompilerProjectSnapshot,
  targetDirectory: string,
): RustStandardLibraryContext {
  if (snapshot.kind !== "standard-library") {
    throw new Error("Rust standard-library context requires an exact standard-library compiler snapshot.");
  }
  const existing = standardLibraryContexts.get(snapshot.digest);
  if (existing !== undefined) {
    if (existing.targetDirectory !== targetDirectory ||
      JSON.stringify(existing.snapshot) !== JSON.stringify(snapshot)) {
      throw new Error("Rust standard-library compiler context conflicts with its immutable snapshot or artifact directory.");
    }
    return existing;
  }
  const dependency = snapshot.dependencies.find(({ alias }) => alias === "std");
  if (dependency === undefined || dependency.crateName !== "std") {
    throw new Error("Rust standard-library compiler snapshot has no exact 'std' crate dependency.");
  }
  validateDependencyBelongsToSnapshot(snapshot, dependency);
  verifyRustCompilerStandardLibraryMetadata(snapshot);
  verifyRustCompilerDependencySource(snapshot, dependency);
  const publicDocument = loadRustdocDocument({ snapshot, dependency, targetDirectory });
  verifyRustCompilerDependencySource(snapshot, dependency);
  const baseContext: RustStandardLibraryContext = {
    snapshot,
    targetDirectory,
    publicDocument,
    documentsByCrate: new Map([["std", publicDocument]]),
    itemIdsByCanonicalIdentity: new Map(),
    publicTypeAliasesByCrate: new Map(),
    typeLocationsByCanonicalPath: new Map(),
  };
  standardLibraryContexts.set(snapshot.digest, baseContext);
  return baseContext;
}

export function resolveStandardLibraryItem(
  context: RustStandardLibraryContext,
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  id: unknown,
): ResolvedRustdocItem {
  const local = document.index[String(id)];
  if (!isRecord(local)) {
    return resolveStandardLibraryCanonicalItem(context, document, id);
  }
  if (!hasInnerKind(local, "use")) {
    return {
      document,
      item: local,
      dependency,
      ...(typeof local.name === "string" ? { publicName: local.name } : {}),
    };
  }
  const use = requireInnerRecord(local, "use", "Rust standard-library public re-export");
  const publicName = requireString(use.name, "Rust standard-library public re-export name");
  if (use.is_glob === true) {
    throw new Error(`Rust standard-library glob re-export '${publicName}' has no singular selected export identity.`);
  }
  const selected = document.index[String(use.id)];
  const resolved = isRecord(selected)
    ? resolveStandardLibraryItem(context, document, dependency, use.id)
    : resolveStandardLibraryCanonicalItem(context, document, use.id);
  return { ...resolved, publicName };
}

function resolveStandardLibraryCanonicalItem(
  context: RustStandardLibraryContext,
  sourceDocument: RustdocDocument,
  id: unknown,
): ResolvedRustdocItem {
  const lookup = lookupStandardLibraryCanonicalItem(context, sourceDocument, id);
  if (lookup.resolved === undefined) {
    throw new Error(
      `Rust sysroot crate '${lookup.crateName}' does not contain re-exported item '${lookup.canonicalPath.join("::")}'.`,
    );
  }
  return lookup.resolved;
}

function lookupStandardLibraryCanonicalItem(
  context: RustStandardLibraryContext,
  sourceDocument: RustdocDocument,
  id: unknown,
): {
  readonly canonicalPath: readonly string[];
  readonly crateName: string;
  readonly resolved?: ResolvedRustdocItem;
} {
  const pathRecord = requireRecord(
    sourceDocument.paths[String(id)],
    `Rust standard-library re-export '${String(id)}' path`,
  );
  const path = requireArray(
    pathRecord.path,
    `Rust standard-library re-export '${String(id)}' path segments`,
  );
  if (path.length < 2 || path.some((segment) => typeof segment !== "string")) {
    throw new Error(`Rust standard-library re-export '${String(id)}' has no canonical crate-qualified path.`);
  }
  const canonicalPath = path as string[];
  const canonicalKind = requireString(
    pathRecord.kind,
    `Rust standard-library re-export '${String(id)}' kind`,
  );
  const crateName = canonicalPath[0]!;
  const dependency = context.snapshot.dependencies.find((candidate) =>
    candidate.crateName === crateName);
  if (dependency === undefined) {
    throw new Error(`Rust standard-library re-export '${canonicalPath.join("::")}' belongs to untracked sysroot crate '${crateName}'.`);
  }
  const document = loadStandardLibraryCrateDocument(context, dependency);
  let idsByIdentity = context.itemIdsByCanonicalIdentity.get(crateName);
  if (idsByIdentity === undefined) {
    const indexed = new Map<string, string>();
    for (const [candidateId, candidate] of Object.entries(document.paths)) {
      if (!isRecord(candidate) || !Array.isArray(candidate.path) ||
        candidate.path.some((segment) => typeof segment !== "string") ||
        typeof candidate.kind !== "string") {
        continue;
      }
      const key = rustdocPathIdentity(candidate.path as string[], candidate.kind);
      if (indexed.has(key)) {
        throw new Error(
          `Rust sysroot crate '${crateName}' exposes duplicate canonical ${candidate.kind} identity '${(candidate.path as string[]).join("::")}'.`,
        );
      }
      indexed.set(key, candidateId);
    }
    idsByIdentity = indexed;
    context.itemIdsByCanonicalIdentity.set(crateName, idsByIdentity);
  }
  const resolvedId = idsByIdentity.get(rustdocPathIdentity(canonicalPath, canonicalKind));
  if (resolvedId === undefined) {
    return { canonicalPath, crateName };
  }
  return {
    canonicalPath,
    crateName,
    resolved: {
      document,
      item: itemById(document, resolvedId),
      dependency,
      publicName: canonicalPath[canonicalPath.length - 1],
    },
  };
}

function standardTypeLocation(
  context: RustStandardLibraryContext,
  canonicalPath: readonly string[],
): RustCompilerStandardTypeLocation | undefined {
  const canonicalKey = canonicalPathKey(canonicalPath);
  const cached = context.typeLocationsByCanonicalPath.get(canonicalKey);
  if (cached !== undefined) {
    return cached;
  }
  const [crateName, ...pathWithinCrate] = canonicalPath;
  const exportName = pathWithinCrate[pathWithinCrate.length - 1];
  if (crateName === undefined || exportName === undefined || pathWithinCrate.length < 1) {
    throw new Error(`Rust standard-library type '${canonicalPath.join("::")}' has no crate-qualified identity.`);
  }
  const dependency = context.snapshot.dependencies.find((candidate) =>
    candidate.crateName === crateName);
  if (dependency === undefined) {
    return undefined;
  }
  const document = loadStandardLibraryCrateDocument(context, dependency);
  const candidateIds = Object.entries(document.paths)
    .filter(([, candidate]) => isRecord(candidate) && Array.isArray(candidate.path) &&
      canonicalPathKey(candidate.path as string[]) === canonicalKey &&
      standardTypePathKind(candidate.kind))
    .map(([id]) => id);
  if (candidateIds.length !== 1) {
    return undefined;
  }
  const item = itemById(document, candidateIds[0]!);
  const publicPath = preferredStandardLibraryPublicTypeAlias(context, canonicalPath);
  if (publicPath === undefined) {
    return undefined;
  }
  const publicCrateName = publicPath[0]!;
  const publicExportName = publicPath[publicPath.length - 1]!;
  const inner = requireRecord(item.inner, `Rust standard-library type '${exportName}' inner declaration`);
  const declaration = isRecord(inner.struct)
    ? inner.struct
    : isRecord(inner.enum)
      ? inner.enum
      : isRecord(inner.union)
        ? inner.union
        : isRecord(inner.type_alias)
          ? inner.type_alias
          : isRecord(inner.trait)
            ? inner.trait
          : undefined;
  if (declaration === undefined) {
    return undefined;
  }
  const parameters = normalizeGenericParameters(
    document,
    requireRecord(declaration.generics, `Rust standard-library type '${exportName}' generics`),
    rootNormalizationContext(
      document,
      dependency,
      item,
      (sourceDocument, sourceDependency, id) =>
        resolveStandardLibraryItem(context, sourceDocument, sourceDependency, id),
    ),
  ).parameters;
  const location: RustCompilerStandardTypeLocation = Object.freeze({
    canonicalPath: Object.freeze([...canonicalPath]),
    sourceModuleSpecifier: standardModuleSpecifier(publicCrateName, publicPath.slice(1, -1)),
    sourceExportName: publicExportName,
    targetPath: publicPath,
    targetId: `rust.std.${context.snapshot.digest.slice(0, 24)}.${digestText(canonicalPath.join("\0")).slice(0, 24)}`,
    genericParameters: parameters,
  });
  context.typeLocationsByCanonicalPath.set(canonicalKey, location);
  return location;
}

function preferredStandardLibraryPublicTypeAlias(
  context: RustStandardLibraryContext,
  canonicalPath: readonly string[],
): readonly string[] | undefined {
  const canonicalCrateName = canonicalPath[0];
  const dependencies = [...context.snapshot.dependencies].sort((left, right) => {
    const leftRank = left.crateName === "std"
      ? 0
      : left.crateName === canonicalCrateName
        ? 1
        : 2;
    const rightRank = right.crateName === "std"
      ? 0
      : right.crateName === canonicalCrateName
        ? 1
        : 2;
    return leftRank - rightRank || compareText(left.crateName, right.crateName);
  });
  for (const dependency of dependencies) {
    const document = loadStandardLibraryCrateDocument(context, dependency);
    const alias = standardLibraryPublicTypeAlias(
      context,
      dependency,
      document,
      canonicalPath,
    );
    if (alias !== undefined) {
      return alias;
    }
  }
  return undefined;
}

export function loadStandardLibraryCrateDocument(
  context: RustStandardLibraryContext,
  dependency: RustCompilerDependency,
): RustdocDocument {
  const cached = context.documentsByCrate.get(dependency.crateName);
  if (cached !== undefined) {
    return cached;
  }
  validateDependencyBelongsToSnapshot(context.snapshot, dependency);
  verifyRustCompilerDependencySource(context.snapshot, dependency);
  const document = loadRustdocDocument({
    snapshot: context.snapshot,
    dependency,
    targetDirectory: context.targetDirectory,
  });
  verifyRustCompilerDependencySource(context.snapshot, dependency);
  context.documentsByCrate.set(dependency.crateName, document);
  return document;
}

function standardLibraryPublicTypeAlias(
  context: RustStandardLibraryContext,
  dependency: RustCompilerDependency,
  document: RustdocDocument,
  canonicalPath: readonly string[],
): readonly string[] | undefined {
  let aliases = context.publicTypeAliasesByCrate.get(dependency.crateName);
  if (aliases === undefined) {
    aliases = new Map();
    context.publicTypeAliasesByCrate.set(dependency.crateName, aliases);
  }
  const canonicalKey = canonicalPathKey(canonicalPath);
  const cached = aliases.get(canonicalKey);
  if (cached !== undefined) {
    return cached;
  }
  const bestModulePaths = new Map<string, readonly string[]>();
  const pending: (ResolvedRustdocItem & { readonly path: readonly string[] })[] = [{
    document,
    item: itemById(document, document.root),
    dependency,
    path: Object.freeze([]),
  }];
  while (pending.length > 0) {
    pending.sort((left, right) => comparePublicAliasPath(left.path, right.path));
    const current = pending.shift()!;
    const moduleId = canonicalItemId(current.dependency, current.item);
    const bestPath = bestModulePaths.get(moduleId);
    if (bestPath !== undefined && comparePublicAliasPath(bestPath, current.path) <= 0) {
      continue;
    }
    bestModulePaths.set(moduleId, current.path);
    const module = requireInnerRecord(current.item, "module", "Rust public module");
    for (const childId of requireArray(module.items, "Rust public module items")) {
      const authored = itemById(current.document, childId);
      if (authored.visibility !== "public") {
        continue;
      }
      if (isGlobUse(authored)) {
        const selectedId = requireInnerRecord(
          authored,
          "use",
          "Rust public module glob re-export",
        ).id;
        const selected = resolvePublicModuleForAliasSearch(
          context,
          current.document,
          current.dependency,
          selectedId,
        );
        if (selected !== undefined) {
          pending.push({ ...selected, path: current.path });
        }
        continue;
      }
      const name = authoredPublicName(authored);
      const kind = authoredPublicKind(current.document, authored);
      if (name === undefined || kind === undefined) {
        continue;
      }
      if (standardTypePathKind(kind)) {
        const selectedPath = authoredPublicCanonicalPath(current.document, authored);
        if (selectedPath !== undefined && canonicalPathKey(selectedPath) === canonicalKey) {
          const alias = Object.freeze([dependency.targetCrateName, ...current.path, name]);
          const existing = aliases.get(canonicalKey);
          if (existing === undefined || comparePublicAliasPath(alias, existing) < 0) {
            aliases.set(canonicalKey, alias);
          }
        }
      }
      if (kind !== "module") {
        continue;
      }
      const resolved = resolvePublicModuleForAliasSearch(
        context,
        current.document,
        current.dependency,
        authored.id,
      );
      if (resolved !== undefined) {
        pending.push({
          ...resolved,
          path: Object.freeze([...current.path, name]),
        });
      }
    }
  }
  return aliases.get(canonicalKey);
}

function resolvePublicModuleForAliasSearch(
  context: RustStandardLibraryContext,
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  id: unknown,
): ResolvedRustdocItem | undefined {
  const local = document.index[String(id)];
  const resolved = isRecord(local)
    ? hasInnerKind(local, "use")
      ? lookupStandardLibraryCanonicalItem(
          context,
          document,
          requireInnerRecord(local, "use", "Rust public module re-export").id,
        ).resolved
      : { document, item: local, dependency }
    : lookupStandardLibraryCanonicalItem(context, document, id).resolved;
  return resolved !== undefined && hasInnerKind(resolved.item, "module")
    ? resolved
    : undefined;
}

function comparePublicAliasPath(left: readonly string[], right: readonly string[]): number {
  return left.length - right.length || compareText(left.join("/"), right.join("/"));
}

export function collectModuleStandardTypeLocations(
  module: Omit<RustCompilerModuleModel, "standardTypeLocations">,
  context: RustStandardLibraryContext,
): readonly RustCompilerStandardTypeLocation[] {
  const selected = new Map<string, RustCompilerStandardTypeLocation>();
  const selectCanonicalPath = (canonicalPath: readonly string[]): void => {
    if (!context.snapshot.dependencies.some((dependency) =>
      dependency.crateName === canonicalPath[0])) {
      return;
    }
    const location = standardTypeLocation(context, canonicalPath);
    const key = location === undefined
      ? undefined
      : canonicalPathKey(location.canonicalPath);
    if (location !== undefined && key !== undefined && !selected.has(key)) {
      selected.set(key, location);
      visitParameters(location.genericParameters);
    }
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
      case "associated-type":
        visitType(type.owner);
        visitTrait(type.trait);
        type.genericArguments.forEach(visitArgument);
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
      case "path": {
        selectCanonicalPath([type.crateName, ...type.modulePath, type.name]);
        type.genericArguments.forEach(visitArgument);
        return;
      }
    }
  };
  const visitArgument = (argument: RustCompilerGenericArgument): void => {
    if (argument.kind === "type") visitType(argument.type);
  };
  const visitTrait = (
    trait: import("../model/model.js").RustCompilerTraitDispatch,
  ): void => {
    selectCanonicalPath(trait.identity.canonicalPath);
    trait.genericArguments.forEach(visitArgument);
    trait.associatedConstraints.forEach((constraint) => {
      constraint.genericArguments.forEach(visitArgument);
      if (constraint.kind === "equality") {
        visitType(constraint.type);
      } else {
        constraint.traits.forEach(visitTrait);
      }
    });
  };
  const visitParameters = (parameters: readonly RustCompilerGenericParameter[]): void => {
    for (const parameter of parameters) {
      if (parameter.kind === "type") {
        parameter.requirements.forEach((requirement) => {
          if (typeof requirement === "string") {
            selectCanonicalPath(compilerTypeRequirementCanonicalPath(requirement));
          } else {
            visitTrait(requirement.trait);
          }
        });
        if (parameter.defaultType !== undefined) visitType(parameter.defaultType);
      } else if (parameter.kind === "const") {
        visitType(parameter.type);
      }
    }
  };
  const visitFunction = (fn: RustCompilerFunction): void => {
    visitParameters(fn.genericParameters);
    visitParameters(fn.typeRequirements);
    if (fn.receiver?.kind === "custom") {
      visitType(fn.receiver.type);
    }
    fn.parameters.forEach((parameter) => visitType(parameter.type));
    visitType(fn.result);
    if (fn.traitDispatch !== undefined) visitTrait(fn.traitDispatch);
  };
  for (const exported of module.exports) {
    switch (exported.kind) {
      case "constant":
      case "static":
        visitType(exported.type);
        break;
      case "function":
        visitFunction(exported.function);
        break;
      case "type-alias":
        visitParameters(exported.genericParameters);
        visitType(exported.type);
        break;
      case "struct":
      case "union":
        selectCanonicalPath(exported.canonicalPath);
        visitParameters(exported.genericParameters);
        exported.fields.forEach((field) => visitType(field.type));
        exported.methods.forEach(visitFunction);
        exported.associatedConstants.forEach((constant) => {
          visitType(constant.type);
          visitTrait(constant.traitDispatch);
        });
        break;
      case "enum":
        selectCanonicalPath(exported.canonicalPath);
        visitParameters(exported.genericParameters);
        exported.variants.forEach((variant) => {
          if (variant.kind === "struct") {
            variant.fields.forEach((field) => visitType(field.type));
          } else {
            variant.fields.forEach(visitType);
          }
        });
        exported.methods.forEach(visitFunction);
        exported.associatedConstants.forEach((constant) => {
          visitType(constant.type);
          visitTrait(constant.traitDispatch);
        });
        break;
      case "trait":
        selectCanonicalPath(exported.canonicalPath);
        visitParameters(exported.genericParameters);
        exported.superTraits.forEach(visitTrait);
        exported.methods.forEach(visitFunction);
        exported.associatedConstants.forEach((constant) => {
          visitType(constant.type);
          visitTrait(constant.traitDispatch);
        });
        exported.associatedTypes.forEach((associated) => {
          visitParameters(associated.genericParameters);
          associated.requirements.forEach((requirement) => {
            if (typeof requirement === "string") {
              selectCanonicalPath(compilerTypeRequirementCanonicalPath(requirement));
            } else {
              visitTrait(requirement.trait);
            }
          });
          associated.ownerRequirements.forEach((requirement) => {
            if (typeof requirement === "string") {
              selectCanonicalPath(compilerTypeRequirementCanonicalPath(requirement));
            } else {
              visitTrait(requirement.trait);
            }
          });
          if (associated.defaultType !== undefined) visitType(associated.defaultType);
        });
        break;
    }
  }
  return Object.freeze([...selected.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, location]) => location));
}

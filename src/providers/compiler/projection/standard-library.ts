import type {
  RustCompilerDependency,
  RustCompilerGenerics,
  RustCompilerModuleModel,
  RustCompilerProjectSnapshot,
  RustCompilerStandardLibrarySnapshot,
  RustCompilerStandardItemLocation,
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
  canonicalCompilerItemIdentity,
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
  rustdocItemStability,
  type RustdocDocument,
} from "../model/rustdoc-schema.js";
import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import {
  canonicalPathKey,
  normalizeGenerics,
  standardTypePathKind,
} from "../model/rustdoc-types.js";
import { visitRustCompilerModuleReferences } from "../model/references.js";
import { sourceGenericParameterHasDefault } from "./utilities.js";

export interface RustStandardLibraryContext {
  readonly snapshot: RustCompilerStandardLibrarySnapshot;
  readonly targetDirectory: string;
  readonly publicDocument: RustdocDocument;
  readonly documentsByCrate: Map<string, RustdocDocument>;
  readonly itemIdsByCanonicalIdentity: Map<string, ReadonlyMap<string, string>>;
  readonly publicItemAliasesByCrate: Map<string, Map<string, readonly string[]>>;
  readonly itemLocationsByCanonicalPath: Map<string, RustCompilerStandardItemLocation>;
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
      !closedMetadataEquals(existing.snapshot, snapshot)) {
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
    publicItemAliasesByCrate: new Map(),
    itemLocationsByCanonicalPath: new Map(),
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
  const path = document.paths[String(id)];
  const pathSegments = isRecord(path) && Array.isArray(path.path) &&
      path.path.every((segment) => typeof segment === "string")
    ? path.path as readonly string[]
    : undefined;
  if (!isRecord(local) ||
    (pathSegments !== undefined && pathSegments[0] !== dependency.crateName)) {
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

function standardItemLocation(
  context: RustStandardLibraryContext,
  canonicalPath: readonly string[],
  kind: "type" | "trait",
): RustCompilerStandardItemLocation {
  const canonicalKey = canonicalPathKey(canonicalPath);
  const cached = context.itemLocationsByCanonicalPath.get(canonicalKey);
  if (cached !== undefined) {
    if (cached.kind !== kind) {
      throw new Error(`Rust standard item '${canonicalPath.join("::")}' was requested as both ${cached.kind} and ${kind}.`);
    }
    return cached;
  }
  const [crateName, ...pathWithinCrate] = canonicalPath;
  const exportName = pathWithinCrate[pathWithinCrate.length - 1];
  if (crateName === undefined || exportName === undefined || pathWithinCrate.length < 1) {
    throw new Error(`Rust standard-library item '${canonicalPath.join("::")}' has no crate-qualified identity.`);
  }
  const dependency = context.snapshot.dependencies.find((candidate) =>
    candidate.crateName === crateName);
  if (dependency === undefined) {
    throw new Error(`Rust standard-library item '${canonicalPath.join("::")}' belongs to untracked sysroot crate '${crateName}'.`);
  }
  const document = loadStandardLibraryCrateDocument(context, dependency);
  const candidateIds = Object.entries(document.paths)
    .filter(([, candidate]) => isRecord(candidate) && Array.isArray(candidate.path) &&
      canonicalPathKey(candidate.path as string[]) === canonicalKey &&
      (kind === "trait" ? candidate.kind === "trait" : standardTypePathKind(candidate.kind)))
    .map(([id]) => id);
  if (candidateIds.length !== 1) {
    throw new Error(
      `Rust standard-library ${kind} '${canonicalPath.join("::")}' has ${candidateIds.length} exact compiler identities; expected one.`,
    );
  }
  const item = itemById(document, candidateIds[0]!);
  const identity = Object.freeze({
    kind,
    canonicalPath: Object.freeze([...canonicalPath]),
    targetId: `rust.std.${context.snapshot.digest.slice(0, 24)}.${digestText(canonicalPath.join("\0")).slice(0, 24)}`,
  });
  const publicPath = preferredStandardLibraryPublicItemAlias(context, canonicalPath, kind);
  if (publicPath === undefined) {
    const location: RustCompilerStandardItemLocation = Object.freeze({
      ...identity,
      sourceAvailability: "unavailable",
    });
    context.itemLocationsByCanonicalPath.set(canonicalKey, location);
    return location;
  }
  const publicCrateName = publicPath[0]!;
  const publicExportName = publicPath[publicPath.length - 1]!;
  const inner = requireRecord(item.inner, `Rust standard-library ${kind} '${exportName}' inner declaration`);
  const declaration = isRecord(inner.trait)
    ? inner.trait
    : isRecord(inner.struct)
    ? inner.struct
    : isRecord(inner.enum)
      ? inner.enum
      : isRecord(inner.union)
        ? inner.union
        : isRecord(inner.type_alias)
          ? inner.type_alias
          : undefined;
  if (declaration === undefined) {
    throw new Error(`Rust standard-library item '${canonicalPath.join("::")}' is not a supported ${kind} declaration.`);
  }
  const itemIdentity = canonicalCompilerItemIdentity(document, dependency, item);
  const generics = normalizeGenerics(
    document,
    requireRecord(declaration.generics, `Rust standard-library type '${exportName}' generics`),
    {
      dependency,
      owner: itemIdentity,
      resolveItem: (itemDocument, itemDependency, id) =>
        resolveStandardLibraryItem(context, itemDocument, itemDependency, id),
    },
  );
  const sourceStability = rustdocItemStability(item) ?? "stable";
  const sourceGenericParameters = sourceStability === "unstable"
    ? declaredSourceGenericParameters(generics)
    : sourceVisibleStandardGenericParameters(context, generics);
  const firstDefault = sourceGenericParameters.findIndex(sourceGenericParameterHasDefault);
  if (firstDefault >= 0 && sourceGenericParameters.slice(firstDefault).some((parameter) =>
    !sourceGenericParameterHasDefault(parameter))) {
    throw new Error(
      `Rust standard-library item '${canonicalPath.join("::")}' has a non-trailing default generic parameter.`,
    );
  }
  const location: RustCompilerStandardItemLocation = Object.freeze({
    ...identity,
    sourceAvailability: "available",
    sourceModuleSpecifier: standardModuleSpecifier(publicCrateName, publicPath.slice(1, -1)),
    sourceExportName: publicExportName,
    targetPath: publicPath,
    sourceStability,
    sourceGenericArgumentCount: sourceGenericParameters.length,
    requiredSourceGenericArgumentCount: firstDefault < 0
      ? sourceGenericParameters.length
      : firstDefault,
  });
  context.itemLocationsByCanonicalPath.set(canonicalKey, location);
  return location;
}

function sourceVisibleStandardGenericParameters(
  context: RustStandardLibraryContext,
  generics: RustCompilerGenerics,
): readonly import("../model/model.js").RustCompilerGenericParameter[] {
  const parameters = declaredSourceGenericParameters(generics);
  const firstUnavailable = parameters.findIndex((parameter) =>
    parameter.kind === "type" && sourceGenericParameterHasDefault(parameter) && parameter.bounds.some((bound) =>
      bound.kind === "trait" && (() => {
        const location = standardItemLocation(context, bound.trait.identity.canonicalPath, "trait");
        return location.sourceAvailability === "unavailable" || location.sourceStability === "unstable";
      })()));
  if (firstUnavailable < 0) return Object.freeze(parameters);
  if (parameters.slice(firstUnavailable).some((parameter) =>
    !sourceGenericParameterHasDefault(parameter))) {
    throw new Error(
      "Rust standard-library source-inaccessible default generic parameters do not form a trailing suffix.",
    );
  }
  return Object.freeze(parameters.slice(0, firstUnavailable));
}

function declaredSourceGenericParameters(
  generics: RustCompilerGenerics,
): readonly import("../model/model.js").RustCompilerGenericParameter[] {
  return Object.freeze(generics.parameters.filter((parameter) =>
    parameter.kind !== "type" || parameter.declarationKind === "explicit"));
}

function preferredStandardLibraryPublicItemAlias(
  context: RustStandardLibraryContext,
  canonicalPath: readonly string[],
  kind: "type" | "trait",
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
    const alias = standardLibraryPublicItemAlias(
      context,
      dependency,
      document,
      canonicalPath,
      kind,
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

function standardLibraryPublicItemAlias(
  context: RustStandardLibraryContext,
  dependency: RustCompilerDependency,
  document: RustdocDocument,
  canonicalPath: readonly string[],
  selectedKind: "type" | "trait",
): readonly string[] | undefined {
  let aliases = context.publicItemAliasesByCrate.get(dependency.crateName);
  if (aliases === undefined) {
    aliases = new Map();
    context.publicItemAliasesByCrate.set(dependency.crateName, aliases);
  }
  const pathKey = canonicalPathKey(canonicalPath);
  const canonicalKey = `${selectedKind}\0${pathKey}`;
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
      const authoredKind = authoredPublicKind(current.document, authored);
      if (name === undefined || authoredKind === undefined) {
        continue;
      }
      if (selectedKind === "trait" ? authoredKind === "trait" : standardTypePathKind(authoredKind)) {
        const selectedPath = authoredPublicCanonicalPath(current.document, authored);
        if (selectedPath !== undefined && canonicalPathKey(selectedPath) === pathKey) {
          const alias = Object.freeze([dependency.targetCrateName, ...current.path, name]);
          const existing = aliases.get(canonicalKey);
          if (existing === undefined || comparePublicAliasPath(alias, existing) < 0) {
            aliases.set(canonicalKey, alias);
          }
        }
      }
      if (authoredKind !== "module") {
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

export function collectModuleStandardItemLocations(
  module: Omit<RustCompilerModuleModel, "standardItemLocations">,
  context: RustStandardLibraryContext,
): readonly RustCompilerStandardItemLocation[] {
  const selected = new Map<string, RustCompilerStandardItemLocation>();
  const select = (canonicalPath: readonly string[], kind: "type" | "trait"): void => {
    if (!context.snapshot.dependencies.some((dependency) => dependency.crateName === canonicalPath[0])) return;
    const location = standardItemLocation(context, canonicalPath, kind);
    const key = canonicalPathKey(location.canonicalPath);
    const existing = selected.get(key);
    if (existing !== undefined && existing.kind !== location.kind) {
      throw new Error(`Rust standard item '${canonicalPath.join("::")}' has contradictory semantic kinds.`);
    }
    selected.set(key, location);
  };
  visitRustCompilerModuleReferences(module, {
    type: (identity) => select(identity.canonicalPath, "type"),
    trait: (identity) => select(identity.canonicalPath, "trait"),
  });
  return Object.freeze([...selected.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, location]) => location));
}

import { createHash } from "node:crypto";
import type { RustCompilerDependency } from "./model.js";
import {
  hasInnerKind,
  isRecord,
  itemById,
  requireArray,
  requireInnerRecord,
  requireRecord,
  type RustdocDocument,
} from "./rustdoc-schema.js";
import { canonicalPathKey } from "./rustdoc-types.js";

export interface ResolvedRustdocItem {
  readonly document: RustdocDocument;
  readonly item: Readonly<Record<string, unknown>>;
  readonly dependency: RustCompilerDependency;
  readonly publicName?: string;
}

export type RustdocItemResolver = (
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  id: unknown,
) => ResolvedRustdocItem;

export function isGlobUse(item: Readonly<Record<string, unknown>>): boolean {
  if (!hasInnerKind(item, "use")) {
    return false;
  }
  return requireInnerRecord(item, "use", "Rust public use").is_glob === true;
}

export function rustdocPathIdentity(path: readonly string[], kind: string): string {
  return `${canonicalPathKey(path)}\0${kind}`;
}

export function authoredPublicName(item: Readonly<Record<string, unknown>>): string | undefined {
  if (hasInnerKind(item, "use")) {
    const use = requireInnerRecord(item, "use", "Rust public re-export");
    return use.is_glob === true || typeof use.name !== "string" ? undefined : use.name;
  }
  return typeof item.name === "string" ? item.name : undefined;
}

export function expandedPublicModuleItems(
  moduleItem: ResolvedRustdocItem,
  label: string,
  resolveItem?: RustdocItemResolver,
  activeModules: ReadonlySet<string> = new Set(),
): readonly ResolvedRustdocItem[] {
  const moduleId = canonicalItemId(moduleItem.dependency, moduleItem.item);
  if (activeModules.has(moduleId)) {
    throw new Error(`${label} contains a recursive public glob re-export.`);
  }
  const nextActive = new Set(activeModules);
  nextActive.add(moduleId);
  const module = requireInnerRecord(moduleItem.item, "module", label);
  const expanded: ResolvedRustdocItem[] = [];
  for (const childId of requireArray(module.items, `${label} items`)) {
    const authored = itemById(moduleItem.document, childId);
    if (authored.visibility !== "public") {
      continue;
    }
    if (!isGlobUse(authored)) {
      expanded.push({
        document: moduleItem.document,
        item: authored,
        dependency: moduleItem.dependency,
      });
      continue;
    }
    const selectedId = requireInnerRecord(authored, "use", `${label} glob re-export`).id;
    const local = moduleItem.document.index[String(selectedId)];
    const selected = resolveItem?.(
      moduleItem.document,
      moduleItem.dependency,
      selectedId,
    ) ?? (isRecord(local) ? {
      document: moduleItem.document,
      item: local,
      dependency: moduleItem.dependency,
    } : undefined);
    if (selected === undefined || !hasInnerKind(selected.item, "module")) {
      throw new Error(`${label} has a public glob re-export without an exact module identity.`);
    }
    expanded.push(...expandedPublicModuleItems(
      selected,
      `${label} glob re-export`,
      resolveItem,
      nextActive,
    ));
  }
  return Object.freeze(expanded);
}

export function authoredPublicCanonicalPath(
  document: RustdocDocument,
  item: Readonly<Record<string, unknown>>,
): readonly string[] | undefined {
  const selectedId = hasInnerKind(item, "use")
    ? requireInnerRecord(item, "use", "Rust public re-export").id
    : item.id;
  const path = document.paths[String(selectedId)];
  return isRecord(path) && Array.isArray(path.path) &&
    path.path.every((segment) => typeof segment === "string")
    ? path.path as string[]
    : undefined;
}

export function authoredPublicIdentity(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  item: Readonly<Record<string, unknown>>,
): string {
  const path = authoredPublicCanonicalPath(document, item);
  const kind = authoredPublicKind(document, item);
  return path === undefined || kind === undefined
    ? canonicalItemId(dependency, item)
    : rustdocPathIdentity(path, kind);
}

export function authoredPublicKind(
  document: RustdocDocument,
  item: Readonly<Record<string, unknown>>,
): string | undefined {
  if (hasInnerKind(item, "use")) {
    const selectedId = requireInnerRecord(item, "use", "Rust public re-export").id;
    const path = document.paths[String(selectedId)];
    return isRecord(path) && typeof path.kind === "string" ? path.kind : undefined;
  }
  for (const kind of [
    "constant",
    "enum",
    "function",
    "module",
    "static",
    "struct",
    "trait",
    "type_alias",
    "union",
  ]) {
    if (hasInnerKind(item, kind)) {
      return kind;
    }
  }
  return undefined;
}

export function canonicalItemId(dependency: RustCompilerDependency, item: Readonly<Record<string, unknown>>): string {
  const id = item.id;
  if (typeof id !== "number" && typeof id !== "string") {
    throw new Error(`Rust item has no stable rustdoc identifier.`);
  }
  return `${dependency.packageId}#${String(id)}`;
}

export function compilerAssociatedSourceExportName(
  itemId: string,
  displayName: string,
): string {
  const readableName = /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(displayName)
    ? displayName
    : "AssociatedType";
  const digest = createHash("sha256").update(itemId).digest("hex").slice(0, 12);
  return `RustAssociated${readableName}_${digest}`;
}

export function isCompilerAssociatedSourceExportName(name: string): boolean {
  return /^RustAssociated[A-Za-z_$][A-Za-z0-9_$]*_[0-9a-f]{12}$/u.test(name);
}

export function canonicalItemPath(
  document: RustdocDocument,
  item: Readonly<Record<string, unknown>>,
): readonly string[] {
  const id = item.id;
  if (typeof id !== "number" && typeof id !== "string") {
    throw new Error("Rust item has no stable rustdoc identifier for its canonical path.");
  }
  const path = requireRecord(document.paths[String(id)], `Rust item '${String(id)}' canonical path`);
  const segments = requireArray(path.path, `Rust item '${String(id)}' canonical path segments`);
  if (segments.length < 2 || segments.some((segment) => typeof segment !== "string")) {
    throw new Error(`Rust item '${String(id)}' has no canonical crate-qualified path.`);
  }
  return Object.freeze(segments as string[]);
}

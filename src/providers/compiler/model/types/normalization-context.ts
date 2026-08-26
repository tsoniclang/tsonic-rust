import { canonicalItemId, canonicalItemPath } from "../rustdoc-items.js";
import {
  isRecord,
  requireArray,
  requireRecord,
} from "../rustdoc-schema.js";
import type {
  RustCompilerDependency,
  RustCompilerGenericParameter,
  RustCompilerItemIdentity,
} from "../model.js";
import type { RustdocDocument } from "../rustdoc-schema.js";
import type { RustdocItemResolver } from "../rustdoc-items.js";

export interface RustCompilerNormalizationContext {
  readonly dependency: RustCompilerDependency;
  readonly owner: RustCompilerItemIdentity;
  readonly parameters: ReadonlyMap<string, RustCompilerGenericParameter>;
  readonly selfOwner?: RustCompilerItemIdentity;
  readonly position: string;
  readonly resolvingAliases: ReadonlySet<string>;
  readonly resolveItem?: RustdocItemResolver;
}

export function rustCompilerItemIdentity(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  item: Readonly<Record<string, unknown>>,
): RustCompilerItemIdentity {
  return Object.freeze({
    itemId: canonicalItemId(dependency, item),
    canonicalPath: canonicalItemPath(document, item),
  });
}

export function rustCompilerNestedItemIdentity(
  dependency: RustCompilerDependency,
  item: Readonly<Record<string, unknown>>,
  owner: RustCompilerItemIdentity,
): RustCompilerItemIdentity {
  const itemId = canonicalItemId(dependency, item);
  return Object.freeze({
    itemId,
    canonicalPath: Object.freeze([...owner.canonicalPath, `<item:${itemId}>`]),
  });
}

export function resolveRustCompilerItem(
  document: RustdocDocument,
  id: unknown,
  context: RustCompilerNormalizationContext,
): {
  readonly document: RustdocDocument;
  readonly dependency: RustCompilerDependency;
  readonly item?: Readonly<Record<string, unknown>>;
  readonly identity: RustCompilerItemIdentity;
} {
  const local = document.index[String(id)];
  const resolved = context.resolveItem === undefined
    ? undefined
    : context.resolveItem(document, context.dependency, id);
  const selectedDocument = resolved?.document ?? document;
  const selectedDependency = resolved?.dependency ?? context.dependency;
  const item = resolved?.item ?? (isRecord(local) ? local : undefined);
  if (item !== undefined) {
    return Object.freeze({
      document: selectedDocument,
      dependency: selectedDependency,
      item,
      identity: rustCompilerItemIdentity(selectedDocument, selectedDependency, item),
    });
  }
  const pathRecord = requireRecord(document.paths[String(id)], `Rust item '${String(id)}' path`);
  const path = requireArray(pathRecord.path, `Rust item '${String(id)}' path segments`);
  if (path.length < 2 || path.some((segment) => typeof segment !== "string")) {
    throw new Error(`Rust item '${String(id)}' has no canonical crate-qualified identity.`);
  }
  return Object.freeze({
    document,
    dependency: context.dependency,
    identity: Object.freeze({
      itemId: `${context.dependency.packageId}#${String(id)}`,
      canonicalPath: Object.freeze(path as string[]),
    }),
  });
}

export function rustCompilerDerivedIdentity(
  owner: RustCompilerItemIdentity,
  role: string,
): RustCompilerItemIdentity {
  return Object.freeze({
    itemId: `${owner.itemId}\0${role}`,
    canonicalPath: Object.freeze([...owner.canonicalPath, `<${role}>`]),
  });
}

export function rootNormalizationContext(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  item: Readonly<Record<string, unknown>>,
  resolveItem?: RustdocItemResolver,
): RustCompilerNormalizationContext {
  const owner = rustCompilerItemIdentity(document, dependency, item);
  return rootNormalizationContextForIdentity(dependency, owner, resolveItem);
}

export function rootNormalizationContextForIdentity(
  dependency: RustCompilerDependency,
  owner: RustCompilerItemIdentity,
  resolveItem?: RustdocItemResolver,
): RustCompilerNormalizationContext {
  return Object.freeze({
    dependency,
    owner,
    parameters: new Map<string, RustCompilerGenericParameter>(),
    selfOwner: owner,
    position: "root",
    resolvingAliases: new Set<string>(),
    ...(resolveItem === undefined ? {} : { resolveItem }),
  });
}

export function childNormalizationContext(
  context: RustCompilerNormalizationContext,
  position: string,
): RustCompilerNormalizationContext {
  return Object.freeze({
    ...context,
    position: `${context.position}/${position}`,
  });
}

export function derivedNormalizationContext(
  dependency: RustCompilerDependency,
  owner: RustCompilerItemIdentity,
  role: string,
  options: {
    readonly selfOwner?: RustCompilerItemIdentity;
    readonly resolveItem?: RustdocItemResolver;
  } = {},
): RustCompilerNormalizationContext {
  const identity = rustCompilerDerivedIdentity(owner, role);
  return Object.freeze({
    dependency,
    owner: identity,
    parameters: new Map<string, RustCompilerGenericParameter>(),
    selfOwner: options.selfOwner ?? owner,
    position: role,
    resolvingAliases: new Set<string>(),
    ...(options.resolveItem === undefined ? {} : { resolveItem: options.resolveItem }),
  });
}

export function contextWithParameters(
  context: RustCompilerNormalizationContext,
  parameters: readonly RustCompilerGenericParameter[],
): RustCompilerNormalizationContext {
  const selected = new Map(context.parameters);
  for (const parameter of parameters) {
    const name = parameter.kind === "lifetime"
      ? parameter.lifetime.name
      : parameter.name;
    const existing = selected.get(name);
    if (existing !== undefined && existing !== parameter) {
      throw new Error(`Rust generic parameter '${name}' conflicts with an enclosing declaration.`);
    }
    selected.set(name, parameter);
  }
  return Object.freeze({ ...context, parameters: selected });
}

export function contextResolvingAlias(
  context: RustCompilerNormalizationContext,
  aliasId: string,
): RustCompilerNormalizationContext {
  if (context.resolvingAliases.has(aliasId)) {
    throw new Error(`Rust type alias '${aliasId}' is recursively referenced.`);
  }
  const resolvingAliases = new Set(context.resolvingAliases);
  resolvingAliases.add(aliasId);
  return Object.freeze({ ...context, resolvingAliases });
}

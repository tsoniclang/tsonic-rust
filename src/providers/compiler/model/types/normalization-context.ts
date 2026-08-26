import { canonicalItemId, canonicalItemPath } from "../rustdoc-items.js";
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
  return Object.freeze({
    dependency,
    owner,
    parameters: new Map(),
    selfOwner: owner,
    position: "root",
    resolvingAliases: new Set(),
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
    parameters: new Map(),
    selfOwner: options.selfOwner ?? owner,
    position: role,
    resolvingAliases: new Set(),
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

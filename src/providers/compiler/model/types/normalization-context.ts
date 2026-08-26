import type { RustdocItemResolver } from "../rustdoc-items.js";
import type {
  RustCompilerDependency,
  RustCompilerGenericParameter,
  RustCompilerItemIdentity,
  RustCompilerLifetime,
  RustCompilerTraitReference,
  RustCompilerType,
} from "../model.js";

export interface RustCompilerNormalizationContext {
  readonly dependency: RustCompilerDependency;
  readonly owner: RustCompilerItemIdentity;
  readonly parameters?: ReadonlyMap<string, RustCompilerGenericParameter>;
  readonly boundLifetimes?: ReadonlyMap<string, RustCompilerLifetime>;
  readonly resolvingAliases?: ReadonlySet<string>;
  readonly position?: string;
  readonly genericOwnerKind?: "trait" | "declaration" | "callable" | "associated-item";
  readonly resolveItem?: RustdocItemResolver;
  readonly selfType?: RustCompilerType;
  readonly traitDispatch?: RustCompilerTraitReference;
  readonly depth?: number;
}

const maximumRustCompilerTypeDepth = 128;

export function normalizeCompilerLifetime(
  raw: unknown,
  context: RustCompilerNormalizationContext,
  position: string,
): RustCompilerLifetime {
  if (raw === "'static" || raw === "static") return Object.freeze({ kind: "static" });
  if (raw === null || raw === undefined || raw === "'_") {
    return Object.freeze({ kind: "elided", ownerId: context.owner.itemId, position });
  }
  if (typeof raw !== "string") {
    throw new Error("Rust lifetime has no stable rustdoc representation.");
  }
  const name = stripRustLifetimeName(raw);
  const bound = context.boundLifetimes?.get(name);
  if (bound !== undefined) return bound;
  const parameter = context.parameters?.get(name) ?? context.parameters?.get(raw);
  if (parameter?.kind !== "lifetime") {
    throw new Error(`Rust lifetime '${raw}' has no declaration-backed identity.`);
  }
  return parameter.identity;
}

export function stripRustLifetimeName(name: string): string {
  return name.startsWith("'") ? name.slice(1) : name;
}

export function childCompilerNormalizationContext(
  context: RustCompilerNormalizationContext,
  position: string,
): RustCompilerNormalizationContext {
  const depth = (context.depth ?? 0) + 1;
  if (depth > maximumRustCompilerTypeDepth) {
    throw new Error(
      `Rust compiler type normalization exceeded its finite depth limit of ${maximumRustCompilerTypeDepth} at '${context.position ?? "root"}'.`,
    );
  }
  return {
    ...context,
    depth,
    position: context.position === undefined ? position : `${context.position}/${position}`,
  };
}

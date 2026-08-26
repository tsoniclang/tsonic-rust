import {
  compareText,
  isRecord,
  normalizeAbi,
  requireArray,
  requireBoolean,
  requireInnerRecord,
  requireRecord,
  requireString,
} from "../rustdoc-schema.js";
import {
  canonicalCompilerItemIdentity,
  compilerItemIdentityById,
  derivedCompilerItemIdentity,
  resolveRustdocItem,
} from "../rustdoc-items.js";
import type { ResolvedRustdocItem, RustdocItemResolver } from "../rustdoc-items.js";
import type {
  RustCompilerAssociatedConstraint,
  RustCompilerBinder,
  RustCompilerBound,
  RustCompilerDependency,
  RustCompilerGenericArgument,
  RustCompilerGenericParameter,
  RustCompilerGenerics,
  RustCompilerItemIdentity,
  RustCompilerLifetime,
  RustCompilerLifetimeParameter,
  RustCompilerTraitReference,
  RustCompilerType,
  RustCompilerTypeParameter,
} from "../model.js";
import type { RustdocDocument } from "../rustdoc-schema.js";
import { normalizeRustConstExpression } from "./const-expressions.js";
import {
  exactAssociatedTypeIdentity,
  resolveExactSuperTraitReference,
  traitReferenceSubstitutions,
} from "./trait-resolution.js";
import { visitRustCompilerBoundReferences } from "../references.js";

export { exactAssociatedTypeIdentity } from "./trait-resolution.js";

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

export function standardTypePathKind(value: unknown): boolean {
  return value === "struct" || value === "enum" || value === "union" ||
    value === "type_alias" || value === "trait";
}

export function canonicalCompilerTypePathKey(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
): string {
  return canonicalPathKey(type.identity.canonicalPath);
}

export function canonicalPathKey(path: readonly string[]): string {
  return path.join("\0");
}

export function normalizeType(
  document: RustdocDocument,
  raw: unknown,
  context: RustCompilerNormalizationContext,
): RustCompilerType {
  const type = requireRecord(raw, "Rust type");
  if (typeof type.primitive === "string") {
    if (type.primitive === "never") return Object.freeze({ kind: "never" });
    return Object.freeze({ kind: "primitive", name: type.primitive });
  }
  if (typeof type.generic === "string") {
    if (type.generic === "Self") {
      return context.selfType ?? Object.freeze({ kind: "self", owner: context.owner });
    }
    const parameter = context.parameters?.get(type.generic);
    if (parameter?.kind !== "type") {
      throw new Error(`Rust type parameter '${type.generic}' has no declaration-backed identity.`);
    }
    return Object.freeze({
      kind: "type-parameter",
      identity: parameter.identity,
      displayName: parameter.displayName,
    });
  }
  if (Array.isArray(type.tuple)) {
    const elements = type.tuple.map((entry, index) => normalizeType(
      document,
      entry,
      childContext(context, `tuple-${index}`),
    ));
    return elements.length === 0
      ? Object.freeze({ kind: "unit" })
      : Object.freeze({ kind: "tuple", elements: Object.freeze(elements) });
  }
  if (type.slice !== undefined) {
    return Object.freeze({
      kind: "slice",
      element: normalizeType(document, type.slice, childContext(context, "slice")),
    });
  }
  if (isRecord(type.array)) {
    return Object.freeze({
      kind: "array",
      element: normalizeType(document, type.array.type, childContext(context, "array-element")),
      length: normalizeRustConstExpression(document, type.array.len, context),
    });
  }
  if (isRecord(type.borrowed_ref)) {
    return Object.freeze({
      kind: "reference",
      mutable: type.borrowed_ref.is_mutable === true,
      lifetime: normalizeLifetime(
        type.borrowed_ref.lifetime,
        context,
        context.position ?? "reference",
      ),
      target: normalizeType(document, type.borrowed_ref.type, childContext(context, "reference-target")),
    });
  }
  if (isRecord(type.raw_pointer)) {
    return Object.freeze({
      kind: "raw-pointer",
      mutable: type.raw_pointer.is_mutable === true,
      target: normalizeType(document, type.raw_pointer.type, childContext(context, "pointer-target")),
    });
  }
  if (isRecord(type.function_pointer)) {
    const functionPointer = type.function_pointer;
    const binder = normalizeBinder(
      document,
      requireArray(functionPointer.generic_params, "Rust function-pointer generic parameters"),
      context,
      "function-pointer",
    );
    const pointerContext = binder === undefined
      ? context
      : { ...context, boundLifetimes: boundLifetimeMap(binder) };
    const signature = requireRecord(functionPointer.sig, "Rust function-pointer signature");
    const header = requireRecord(functionPointer.header, "Rust function-pointer header");
    const parameters = requireArray(signature.inputs, "Rust function-pointer inputs").map((input, index) => {
      if (!Array.isArray(input) || input.length !== 2) {
        throw new Error(`Rust function-pointer input ${index} has an invalid rustdoc shape.`);
      }
      return normalizeType(document, input[1], childContext(pointerContext, `parameter-${index}`));
    });
    return Object.freeze({
      kind: "function-pointer",
      ...(binder === undefined ? {} : { binder }),
      parameters: Object.freeze(parameters),
      result: signature.output === null
        ? Object.freeze({ kind: "unit" as const })
        : normalizeType(document, signature.output, childContext(pointerContext, "result")),
      abi: normalizeAbi(header.abi, "Rust function-pointer ABI"),
      safety: requireBoolean(header.is_unsafe, "Rust function-pointer safety")
        ? "unsafe"
        : "safe",
      variadic: requireBoolean(signature.is_c_variadic, "Rust function-pointer variadicness"),
    });
  }
  if (isRecord(type.qualified_path)) {
    const qualified = type.qualified_path;
    const authoredTrait = normalizeTraitReference(document, qualified.trait, context);
    const trait = authoredTrait.arguments.length === 0 && context.traitDispatch !== undefined
      ? exactSuperTraitReference(document, context.traitDispatch, authoredTrait.identity, context) ?? authoredTrait
      : authoredTrait;
    const displayName = requireString(qualified.name, "Rust associated type name");
    return Object.freeze({
      kind: "associated-type",
      owner: normalizeType(document, qualified.self_type, childContext(context, "associated-owner")),
      trait,
      item: exactAssociatedTypeIdentity(document, trait.identity, displayName, context),
      displayName,
      arguments: normalizePathArguments(document, qualified.args, context).arguments,
    });
  }
  if (isRecord(type.resolved_path)) {
    const resolved = type.resolved_path;
    const identity = resolvedCompilerItemIdentity(document, resolved.id, context);
    const path = identity.canonicalPath;
    const arguments_ = normalizePathArguments(document, resolved.args, context);
    return Object.freeze({
      kind: "path",
      identity,
      crateName: path[0]!,
      modulePath: Object.freeze(path.slice(1, -1)),
      name: path[path.length - 1]!,
      arguments: arguments_.arguments,
    });
  }
  if (isRecord(type.dyn_trait)) {
    const traits = requireArray(type.dyn_trait.traits, "Rust dynamic trait bounds")
      .map((entry) => requireRecord(entry, "Rust dynamic trait bound"));
    if (traits.length === 0) {
      throw new Error("Rust trait object has no principal trait.");
    }
    const references = traits.map((entry) => normalizeDynamicTraitReference(
      document,
      entry.trait,
      withBinderParameters(document, entry.generic_params, context, "trait-object"),
    ));
    const principals = references.filter((entry) => !entry.auto);
    if (principals.length !== 1) {
      throw new Error(principals.length === 0
        ? "Rust auto-trait-only objects have no approved source projection."
        : "Rust trait objects may contain exactly one non-auto principal trait.");
    }
    const autoTraits = references.filter((entry) => entry.auto)
      .map((entry) => entry.reference)
      .sort((left, right) => compareText(left.identity.itemId, right.identity.itemId));
    if (autoTraits.some((entry, index) => index > 0 &&
      entry.identity.itemId === autoTraits[index - 1]!.identity.itemId)) {
      throw new Error("Rust trait object repeats one exact auto-trait identity.");
    }
    return Object.freeze({
      kind: "trait-object",
      principal: principals[0]!.reference,
      autoTraits: Object.freeze(autoTraits),
      lifetime: normalizeLifetime(type.dyn_trait.lifetime, context, "trait-object"),
    });
  }
  if (Array.isArray(type.impl_trait)) {
    const rawBounds = type.impl_trait.map((bound, index) => normalizeBound(
      document,
      bound,
      childContext(context, `opaque-bound-${index}`),
    ));
    const captureBounds = rawBounds.filter((bound): bound is Extract<RustCompilerBound, {
      readonly kind: "precise-capture";
    }> => bound.kind === "precise-capture");
    if (captureBounds.length > 1) {
      throw new Error("Rust opaque type declares more than one precise capture contract.");
    }
    const bounds = Object.freeze(rawBounds.filter((bound) => bound.kind !== "precise-capture"));
    if (!bounds.some((bound) => bound.kind === "trait")) {
      throw new Error("Rust opaque type requires at least one exact trait bound.");
    }
    const captures = Object.freeze([...(captureBounds[0]?.captures ?? [])]
      .sort(compareRustCompilerCaptures));
    const captureKeys = captures.map(rustCompilerCaptureIdentityKey);
    if (new Set(captureKeys).size !== captureKeys.length) {
      throw new Error("Rust opaque type repeats one exact generic capture identity.");
    }
    const requiredCaptureKeys = requiredRustOpaqueCaptureKeys(bounds, context);
    if (captureBounds.length === 0 && requiredCaptureKeys.size !== 0) {
      throw new Error("Rust generic opaque type has no exact compiler-visible capture contract.");
    }
    const captured = new Set(captureKeys);
    const missing = [...requiredCaptureKeys].filter((key) => !captured.has(key));
    if (missing.length !== 0) {
      throw new Error("Rust opaque precise capture omits an in-scope type, const, or bound-referenced lifetime parameter.");
    }
    return Object.freeze({
      kind: "opaque",
      identity: derivedCompilerItemIdentity(context.owner, `opaque:${context.position ?? "type"}`),
      bounds,
      captures,
    });
  }
  if (type.infer !== undefined) {
    throw new Error("Rust inferred provider types do not have a stable public contract.");
  }
  if (isRecord(type.pat)) {
    throw new Error("Rust pattern types require an explicit target-dialect and source-projection contract.");
  }
  throw new Error("Rust type has no supported structural representation.");
}

export function exactSuperTraitReference(
  document: RustdocDocument,
  selectedTrait: RustCompilerTraitReference,
  targetIdentity: RustCompilerItemIdentity,
  context: RustCompilerNormalizationContext,
): RustCompilerTraitReference | undefined {
  return resolveExactSuperTraitReference(document, selectedTrait, targetIdentity, context, {
    normalizeGenerics,
    genericParameterMap,
    normalizeTraitReference,
  });
}

export function normalizeGenerics(
  document: RustdocDocument,
  raw: Readonly<Record<string, unknown>>,
  context: RustCompilerNormalizationContext,
): RustCompilerGenerics {
  const normalized = normalizeGenericParameters(document, raw, context, true);
  const wherePredicates = requireArray(raw.where_predicates, "Rust generic where predicates")
    .map((predicate, index) => normalizeWherePredicate(
      document,
      predicate,
      childContext(normalized.context, `where-${index}`),
    ));
  return Object.freeze({
    parameters: normalized.parameters,
    wherePredicates: Object.freeze(wherePredicates),
  });
}

function normalizeGenericParameters(
  document: RustdocDocument,
  raw: Readonly<Record<string, unknown>>,
  context: RustCompilerNormalizationContext,
  includeBounds: boolean,
): {
  readonly parameters: readonly RustCompilerGenericParameter[];
  readonly context: RustCompilerNormalizationContext;
} {
  const rawParameters = requireArray(raw.params, "Rust generic parameters");
  const rawParameterRecords = rawParameters.map((entry, index) =>
    requireRecord(entry, `Rust generic parameter ${index}`));
  const rawNames = new Set<string>();
  const shells = rawParameterRecords.map((entry, index) => {
    const candidate = genericParameterShell(entry, context.owner, index);
    const name = genericParameterName(candidate);
    if (rawNames.has(name)) {
      throw new Error(`Rust generic parameter '${name}' is declared more than once.`);
    }
    rawNames.add(name);
    const inherited = context.parameters?.get(name);
    if (inherited !== undefined && inherited.kind !== candidate.kind) {
      throw new Error(`Rust generic parameter '${name}' conflicts with its inherited parameter kind.`);
    }
    return inherited ?? candidate;
  });
  const parametersByName = new Map<string, RustCompilerGenericParameter>(context.parameters);
  for (const parameter of shells) {
    const name = genericParameterName(parameter);
    parametersByName.set(name, parameter);
  }
  const parameterContext: RustCompilerNormalizationContext = {
    ...context,
    parameters: parametersByName,
  };
  const parameters = rawParameterRecords.map((entry, index) => normalizeGenericParameter(
    document,
    entry,
    shells[index]!,
    parameterContext,
    includeBounds,
  ));
  const normalizedByName = new Map<string, RustCompilerGenericParameter>(context.parameters);
  for (const parameter of parameters) {
    normalizedByName.set(genericParameterName(parameter), parameter);
  }
  const completeContext = { ...parameterContext, parameters: normalizedByName };
  return Object.freeze({
    parameters: Object.freeze(parameters),
    context: completeContext,
  });
}

export function normalizeTraitReference(
  document: RustdocDocument,
  raw: unknown,
  context: RustCompilerNormalizationContext,
): RustCompilerTraitReference {
  const trait = requireRecord(raw, "Rust trait reference");
  const local = document.index[String(trait.id)];
  const resolved = context.resolveItem === undefined && !isRecord(local)
    ? undefined
    : resolveRustdocItem(document, context.dependency, trait.id, context.resolveItem);
  const identity = resolved === undefined
    ? compilerItemIdentityById(document, context.dependency, trait.id)
    : canonicalCompilerItemIdentity(resolved.document, resolved.dependency, resolved.item);
  const selected = normalizePathArguments(document, trait.args, context, identity);
  const normalized = Object.freeze({
    identity,
    displayPath: identity.canonicalPath,
    arguments: selected.arguments,
    associatedConstraints: selected.constraints,
  });
  return resolved === undefined
    ? normalized
    : completeDefaultedTraitArguments(normalized, context, resolved);
}

function normalizeDynamicTraitReference(
  document: RustdocDocument,
  raw: unknown,
  context: RustCompilerNormalizationContext,
): {
  readonly reference: RustCompilerTraitReference;
  readonly auto: boolean;
} {
  const trait = requireRecord(raw, "Rust dynamic trait reference");
  const local = document.index[String(trait.id)];
  if (context.resolveItem === undefined && !isRecord(local)) {
    throw new Error("Rust trait-object classification requires the exact referenced trait declaration.");
  }
  const resolved = resolveRustdocItem(document, context.dependency, trait.id, context.resolveItem);
  const declaration = requireInnerRecord(
    resolved.item,
    "trait",
    "Rust dynamic trait declaration",
  );
  return Object.freeze({
    reference: normalizeTraitReference(document, raw, context),
    auto: requireBoolean(declaration.is_auto, "Rust dynamic trait auto-trait classification"),
  });
}

function completeDefaultedTraitArguments(
  trait: RustCompilerTraitReference,
  context: RustCompilerNormalizationContext,
  resolvedTrait: ResolvedRustdocItem,
): RustCompilerTraitReference {
  const declaration = requireInnerRecord(resolvedTrait.item, "trait", "Rust exact trait declaration");
  const parameters = normalizeGenericParameters(
    resolvedTrait.document,
    requireRecord(declaration.generics, "Rust exact trait generics"),
    {
      dependency: resolvedTrait.dependency,
      owner: trait.identity,
      genericOwnerKind: "trait",
      selfType: context.selfType ?? Object.freeze({ kind: "self", owner: trait.identity }),
      ...(context.resolveItem === undefined ? {} : { resolveItem: context.resolveItem }),
    },
    false,
  ).parameters.filter((parameter) =>
    parameter.kind !== "type" || parameter.declarationKind === "explicit");
  if (trait.arguments.length >= parameters.length) return trait;
  const omitted = parameters.slice(trait.arguments.length);
  if (omitted.some((parameter) => parameter.kind === "lifetime" ||
    (parameter.kind === "type" ? parameter.defaultType === undefined : parameter.defaultValue === undefined))) {
    return trait;
  }
  const substitutions = traitReferenceSubstitutions(
    Object.freeze({ parameters, wherePredicates: Object.freeze([]) }),
    trait.arguments,
  );
  const arguments_ = parameters.map((parameter): RustCompilerGenericArgument => {
    if (parameter.kind === "type") {
      const value = substitutions.types.get(parameter.identity.itemId);
      if (value === undefined) throw new Error(`Rust trait type parameter '${parameter.displayName}' was not instantiated.`);
      return Object.freeze({ kind: "type", value });
    }
    if (parameter.kind === "lifetime") {
      if (parameter.identity.kind !== "parameter") {
        throw new Error("Rust trait lifetime parameter has no declaration-backed identity.");
      }
      const value = substitutions.lifetimes.get(parameter.identity.identity.itemId);
      if (value === undefined) throw new Error("Rust trait lifetime parameter was not instantiated.");
      return Object.freeze({ kind: "lifetime", value });
    }
    const value = substitutions.consts.get(parameter.identity.itemId);
    if (value === undefined) throw new Error(`Rust trait const parameter '${parameter.displayName}' was not instantiated.`);
    return Object.freeze({ kind: "const", value });
  });
  return Object.freeze({
    ...trait,
    arguments: Object.freeze(arguments_),
  });
}

function resolvedCompilerItemIdentity(
  document: RustdocDocument,
  id: unknown,
  context: RustCompilerNormalizationContext,
): RustCompilerItemIdentity {
  const resolved = context.resolveItem?.(document, context.dependency, id);
  return resolved === undefined
    ? compilerItemIdentityById(document, context.dependency, id)
    : canonicalCompilerItemIdentity(
        resolved.document,
        resolved.dependency,
        resolved.item,
      );
}

export function normalizePathArguments(
  document: RustdocDocument,
  raw: unknown,
  context: RustCompilerNormalizationContext,
  associatedOwner?: RustCompilerItemIdentity,
): {
  readonly arguments: readonly RustCompilerGenericArgument[];
  readonly constraints: readonly RustCompilerAssociatedConstraint[];
} {
  if (raw === null || raw === undefined) {
    return Object.freeze({ arguments: Object.freeze([]), constraints: Object.freeze([]) });
  }
  const args = requireRecord(raw, "Rust path arguments");
  if (isRecord(args.parenthesized)) {
    const parenthesized = args.parenthesized;
    const inputs = requireArray(parenthesized.inputs, "Rust parenthesized path inputs").map(
      (input, index) =>
        normalizeType(document, input, childContext(context, `parenthesized-input-${index}`)),
    );
    const argumentsTuple: RustCompilerGenericArgument = Object.freeze({
      kind: "type",
      value: inputs.length === 0
        ? Object.freeze({ kind: "unit" })
        : Object.freeze({ kind: "tuple", elements: Object.freeze(inputs) }),
    });
    const output: RustCompilerGenericArgument = Object.freeze({
      kind: "type",
      value: parenthesized.output === null
        ? Object.freeze({ kind: "unit" })
        : normalizeType(document, parenthesized.output, childContext(context, "parenthesized-output")),
    });
    return Object.freeze({
      arguments: Object.freeze([argumentsTuple, output]),
      constraints: Object.freeze([]),
    });
  }
  const angle = requireRecord(args.angle_bracketed, "Rust angle-bracketed arguments");
  return Object.freeze({
    arguments: Object.freeze(requireArray(angle.args, "Rust generic arguments").map(
      (argument, index) => normalizeGenericArgument(
        document,
        argument,
        childContext(context, `argument-${index}`),
      ),
    )),
    constraints: Object.freeze(requireArray(angle.constraints, "Rust associated constraints").map(
      (constraint, index) => {
        if (associatedOwner === undefined) {
          throw new Error("Rust associated constraint has no exact owning trait identity.");
        }
        return normalizeAssociatedConstraint(
          document,
          constraint,
          associatedOwner,
          childContext(context, `constraint-${index}`),
        );
      },
    )),
  });
}

export function genericParameterMap(
  generics: RustCompilerGenerics,
): ReadonlyMap<string, RustCompilerGenericParameter> {
  return new Map(generics.parameters.map((parameter) => [genericParameterName(parameter), parameter]));
}

function normalizeGenericParameter(
  document: RustdocDocument,
  raw: Readonly<Record<string, unknown>>,
  shell: RustCompilerGenericParameter,
  context: RustCompilerNormalizationContext,
  includeBounds: boolean,
): RustCompilerGenericParameter {
  const kind = requireRecord(raw.kind, `Rust generic parameter '${genericParameterName(shell)}' kind`);
  if (shell.kind === "lifetime") {
    const lifetime = requireRecord(kind.lifetime, `Rust lifetime parameter '${genericParameterName(shell)}'`);
    return Object.freeze({
      ...shell,
      bounds: includeBounds
        ? Object.freeze(requireArray(lifetime.outlives, "Rust lifetime outlives bounds").map(
            (entry, index) => normalizeLifetime(entry, context, `lifetime-bound-${index}`),
          ))
        : Object.freeze([]),
    });
  }
  if (shell.kind === "type") {
    const type = requireRecord(kind.type, `Rust type parameter '${shell.displayName}'`);
    const parameterType: RustCompilerType = Object.freeze({
      kind: "type-parameter",
      identity: shell.identity,
      displayName: shell.displayName,
    });
    return Object.freeze({
      ...shell,
      bounds: includeBounds
        ? Object.freeze(requireArray(type.bounds, `Rust type parameter '${shell.displayName}' bounds`)
            .map((bound, index) => {
              const normalized = normalizeBound(document, bound, {
                ...childContext(context, `bound-${index}`),
                selfType: parameterType,
              });
              return normalized.kind === "lifetime-outlives"
                ? Object.freeze({
                    kind: "type-outlives" as const,
                    type: parameterType,
                    lifetime: normalized.shorter,
                  })
                : normalized;
            }))
        : Object.freeze([]),
      ...(type.default === null || type.default === undefined
        ? {}
        : { defaultType: normalizeType(document, type.default, childContext(context, "default-type")) }),
      declarationKind: requireBoolean(
        type.is_synthetic,
        `Rust type parameter '${shell.displayName}' synthetic flag`,
      )
        ? context.genericOwnerKind === "trait"
          ? "implicit-self"
          : "synthetic"
        : "explicit",
    });
  }
  const const_ = requireRecord(kind.const, `Rust const parameter '${shell.displayName}'`);
  return Object.freeze({
    ...shell,
    type: normalizeType(document, const_.type, childContext(context, "const-parameter-type")),
    ...(const_.default === null || const_.default === undefined
      ? {}
      : { defaultValue: normalizeRustConstExpression(document, const_.default, context) }),
  });
}

function genericParameterShell(
  raw: Readonly<Record<string, unknown>>,
  owner: RustCompilerItemIdentity,
  index: number,
): RustCompilerGenericParameter {
  const name = requireString(raw.name, `Rust generic parameter ${index} name`);
  const kind = requireRecord(raw.kind, `Rust generic parameter '${name}' kind`);
  const identity = derivedCompilerItemIdentity(owner, `generic-${index}:${name}`);
  if (isRecord(kind.lifetime)) {
    return Object.freeze({
      kind: "lifetime",
      identity: Object.freeze({ kind: "parameter", identity, displayName: stripLifetime(name) }),
      bounds: Object.freeze([]),
    });
  }
  if (isRecord(kind.type)) {
    return Object.freeze({
      kind: "type",
      identity,
      displayName: name,
      bounds: Object.freeze([]),
      declarationKind: "explicit",
    });
  }
  if (isRecord(kind.const)) {
    return Object.freeze({
      kind: "const",
      identity,
      displayName: name,
      type: Object.freeze({ kind: "unit" }),
    });
  }
  throw new Error(`Rust generic parameter '${name}' has no supported kind.`);
}

function normalizeWherePredicate(
  document: RustdocDocument,
  raw: unknown,
  context: RustCompilerNormalizationContext,
): import("../model.js").RustCompilerWherePredicate {
  const predicate = requireRecord(raw, "Rust where predicate");
  if (isRecord(predicate.bound_predicate)) {
    const bounded = predicate.bound_predicate;
    const binder = normalizeBinder(
      document,
      requireArray(bounded.generic_params, "Rust where-bound generic parameters"),
      context,
      "where-bound",
    );
    const boundContext = binder === undefined
      ? context
      : { ...context, boundLifetimes: boundLifetimeMap(binder) };
    const type = normalizeType(document, bounded.type, childContext(boundContext, "where-type"));
    const bounds = Object.freeze(requireArray(bounded.bounds, "Rust where type bounds").map((rawBound, index) => {
      const bound = normalizeBound(document, rawBound, {
        ...childContext(boundContext, `where-bound-${index}`),
        selfType: type,
      });
      if (bound.kind === "lifetime-outlives") {
        return Object.freeze({ kind: "type-outlives" as const, type, lifetime: bound.shorter });
      }
      return bound;
    }));
    return Object.freeze({
      kind: "type",
      ...(binder === undefined ? {} : { binder }),
      type,
      bounds,
    });
  }
  if (isRecord(predicate.lifetime_predicate)) {
    const lifetime = predicate.lifetime_predicate;
    const longer = normalizeLifetime(lifetime.lifetime, context, "where-lifetime");
    return Object.freeze({
      kind: "lifetime",
      lifetime: longer,
      outlives: Object.freeze(requireArray(lifetime.outlives, "Rust lifetime where bounds").map(
        (shorter, index) => normalizeLifetime(shorter, context, `where-outlives-${index}`),
      )),
    });
  }
  if (isRecord(predicate.eq_predicate)) {
    const equality = predicate.eq_predicate;
    const projection = normalizeType(document, equality.lhs, childContext(context, "where-equality-left"));
    if (projection.kind !== "associated-type") {
      throw new Error("Rust equality predicate left side is not an associated type projection.");
    }
    return Object.freeze({
      kind: "equality" as const,
      projection,
      value: normalizeType(document, equality.rhs, childContext(context, "where-equality-right")),
    });
  }
  throw new Error("Rust where predicate has no supported structural representation.");
}

function normalizeBound(
  document: RustdocDocument,
  raw: unknown,
  context: RustCompilerNormalizationContext,
): RustCompilerBound {
  const bound = requireRecord(raw, "Rust generic bound");
  if (isRecord(bound.trait_bound)) {
    const traitBound = bound.trait_bound;
    const binder = normalizeBinder(
      document,
      requireArray(traitBound.generic_params, "Rust higher-ranked trait parameters"),
      context,
      "trait-bound",
    );
    const traitContext = binder === undefined
      ? context
      : { ...context, boundLifetimes: boundLifetimeMap(binder) };
    const modifier = traitBound.modifier;
    if (modifier === "maybe_const") {
      throw new Error("Rust ~const trait bounds require an explicitly selected const-trait dialect contract.");
    }
    if (modifier !== "none" && modifier !== "maybe") {
      throw new Error(`Rust trait bound modifier '${String(modifier)}' is unsupported by the selected dialect.`);
    }
    return Object.freeze({
      kind: "trait",
      ...(binder === undefined ? {} : { binder }),
      trait: normalizeTraitReference(document, traitBound.trait, traitContext),
      polarity: modifier === "maybe" ? "maybe" : "required",
    });
  }
  if (typeof bound.outlives === "string") {
    return Object.freeze({
      kind: "lifetime-outlives",
      longer: normalizeLifetime(undefined, context, "bounded-value"),
      shorter: normalizeLifetime(bound.outlives, context, "outlives"),
    });
  }
  if (Array.isArray(bound.use)) {
    return Object.freeze({
      kind: "precise-capture",
      captures: Object.freeze(bound.use.map((entry, index) => normalizeCapture(entry, context, `capture-${index}`))),
    });
  }
  throw new Error("Rust generic bound has no supported structural representation.");
}

function normalizeGenericArgument(
  document: RustdocDocument,
  raw: unknown,
  context: RustCompilerNormalizationContext,
): RustCompilerGenericArgument {
  const argument = requireRecord(raw, "Rust generic argument");
  if (argument.lifetime !== undefined) {
    return Object.freeze({ kind: "lifetime", value: normalizeLifetime(argument.lifetime, context, context.position ?? "argument") });
  }
  if (argument.type !== undefined) {
    return Object.freeze({ kind: "type", value: normalizeType(document, argument.type, context) });
  }
  if (argument.const !== undefined) {
    const value = isRecord(argument.const) && argument.const.expr !== undefined
      ? argument.const.expr
      : argument.const;
    return Object.freeze({ kind: "const", value: normalizeRustConstExpression(document, value, context) });
  }
  if (argument.infer !== undefined) {
    return Object.freeze({ kind: "const", value: Object.freeze({ kind: "inferred" }) });
  }
  throw new Error("Rust generic argument has no supported discriminant.");
}

function normalizeAssociatedConstraint(
  document: RustdocDocument,
  raw: unknown,
  owner: RustCompilerItemIdentity,
  context: RustCompilerNormalizationContext,
): RustCompilerAssociatedConstraint {
  const constraint = requireRecord(raw, "Rust associated constraint");
  const name = requireString(constraint.name, "Rust associated constraint name");
  const item = exactAssociatedTypeIdentity(document, owner, name, context);
  const arguments_ = normalizePathArguments(document, constraint.args, context).arguments;
  const binding = requireRecord(constraint.binding, `Rust associated constraint '${name}' binding`);
  if (binding.equality !== undefined) {
    const equality = requireRecord(binding.equality, `Rust associated constraint '${name}' equality`);
    if (equality.type === undefined) {
      throw new Error(`Rust associated constraint '${name}' equality is not a type equality.`);
    }
    return Object.freeze({
      kind: "equality",
      item,
      displayName: name,
      arguments: arguments_,
      type: normalizeType(document, equality.type, childContext(context, "associated-equality")),
    });
  }
  if (Array.isArray(binding.constraint)) {
    return Object.freeze({
      kind: "bounds",
      item,
      displayName: name,
      arguments: arguments_,
      bounds: Object.freeze(binding.constraint.map((bound, index) => normalizeBound(
        document,
        bound,
        childContext(context, `associated-bound-${index}`),
      ))),
    });
  }
  throw new Error(`Rust associated constraint '${name}' has no supported binding.`);
}

function normalizeLifetime(raw: unknown, context: RustCompilerNormalizationContext, position: string): RustCompilerLifetime {
  if (raw === "'static" || raw === "static") return Object.freeze({ kind: "static" });
  if (raw === null || raw === undefined || raw === "'_") {
    return Object.freeze({ kind: "elided", ownerId: context.owner.itemId, position });
  }
  if (typeof raw !== "string") throw new Error("Rust lifetime has no stable rustdoc representation.");
  const name = stripLifetime(raw);
  const bound = context.boundLifetimes?.get(name);
  if (bound !== undefined) return bound;
  const parameter = context.parameters?.get(name) ?? context.parameters?.get(raw);
  if (parameter?.kind !== "lifetime") {
    throw new Error(`Rust lifetime '${raw}' has no declaration-backed identity.`);
  }
  return parameter.identity;
}

function normalizeCapture(raw: unknown, context: RustCompilerNormalizationContext, position: string): RustCompilerGenericArgument {
  if (typeof raw !== "string") throw new Error(`Rust precise capture ${position} has no stable representation.`);
  if (raw.startsWith("'")) {
    const value = normalizeLifetime(raw, context, position);
    if (value.kind !== "parameter" && value.kind !== "elided") {
      throw new Error(`Rust precise capture '${raw}' is not an in-scope lifetime parameter.`);
    }
    return Object.freeze({ kind: "lifetime", value });
  }
  if (raw === "Self") {
    if (context.selfType?.kind !== "self") {
      throw new Error("Rust precise Self capture is not owned by an exact trait declaration.");
    }
    return Object.freeze({ kind: "type", value: context.selfType });
  }
  const parameter = context.parameters?.get(raw);
  if (parameter?.kind === "type") {
    return Object.freeze({ kind: "type", value: Object.freeze({ kind: "type-parameter", identity: parameter.identity, displayName: parameter.displayName }) });
  }
  if (parameter?.kind === "const") {
    return Object.freeze({
      kind: "const",
      value: Object.freeze({
        kind: "parameter",
        identity: parameter.identity,
        displayName: parameter.displayName,
      }),
    });
  }
  throw new Error(`Rust precise capture '${raw}' has no declaration-backed identity.`);
}

function rustCompilerCaptureIdentityKey(capture: RustCompilerGenericArgument): string {
  switch (capture.kind) {
    case "lifetime": {
      const lifetime = capture.value;
      switch (lifetime.kind) {
        case "static": return "lifetime:static";
        case "parameter": return `lifetime:parameter:${lifetime.identity.itemId}`;
        case "bound": return `lifetime:bound:${lifetime.binderId}:${lifetime.parameterId}`;
        case "elided": return `lifetime:elided:${lifetime.ownerId}:${lifetime.position}`;
      }
    }
    case "type":
      if (capture.value.kind === "type-parameter") {
        return `type:${capture.value.identity.itemId}`;
      }
      if (capture.value.kind === "self") return `type:self:${capture.value.owner.itemId}`;
      throw new Error("Rust precise type capture is not a declaration-backed type parameter or trait Self.");
    case "const":
      if (capture.value.kind !== "parameter") {
        throw new Error("Rust precise const capture is not a declaration-backed const parameter.");
      }
      return `const:${capture.value.identity.itemId}`;
  }
}

function compareRustCompilerCaptures(
  left: RustCompilerGenericArgument,
  right: RustCompilerGenericArgument,
): number {
  const leftRank = left.kind === "lifetime" ? 0 : left.kind === "type" ? 1 : 2;
  const rightRank = right.kind === "lifetime" ? 0 : right.kind === "type" ? 1 : 2;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return compareText(
    rustCompilerCaptureIdentityKey(left),
    rustCompilerCaptureIdentityKey(right),
  );
}

function requiredRustOpaqueCaptureKeys(
  bounds: readonly RustCompilerBound[],
  context: RustCompilerNormalizationContext,
): ReadonlySet<string> {
  const required = new Set<string>();
  for (const parameter of context.parameters?.values() ?? []) {
    if (parameter.kind === "type") required.add(`type:${parameter.identity.itemId}`);
    else if (parameter.kind === "const") required.add(`const:${parameter.identity.itemId}`);
  }
  if (context.selfType?.kind === "self") {
    required.add(`type:self:${context.selfType.owner.itemId}`);
  }
  for (const bound of bounds) {
    visitRustCompilerBoundReferences(bound, {
      type: () => {},
      trait: () => {},
      lifetime: (lifetime) => {
        if (lifetime.kind === "parameter") {
          required.add(`lifetime:parameter:${lifetime.identity.itemId}`);
        } else if (lifetime.kind === "elided") {
          required.add(`lifetime:elided:${lifetime.ownerId}:${lifetime.position}`);
        }
      },
    });
  }
  return required;
}

function normalizeBinder(
  document: RustdocDocument,
  rawParameters: readonly unknown[],
  context: RustCompilerNormalizationContext,
  role: string,
): RustCompilerBinder | undefined {
  if (rawParameters.length === 0) return undefined;
  const owner = derivedCompilerItemIdentity(context.owner, `binder:${role}`);
  const lifetimes = rawParameters.map((entry, index): RustCompilerLifetimeParameter => {
    const raw = requireRecord(entry, `Rust binder parameter ${index}`);
    const shell = genericParameterShell(raw, owner, index);
    if (shell.kind !== "lifetime") throw new Error("Rust higher-ranked binders may contain only lifetime parameters.");
    const normalized = normalizeGenericParameter(document, raw, shell, context, true);
    if (normalized.kind !== "lifetime") throw new Error("Rust higher-ranked binder normalized to a non-lifetime parameter.");
    return normalized;
  });
  return Object.freeze({ id: owner.itemId, lifetimes: Object.freeze(lifetimes) });
}

function withBinderParameters(
  document: RustdocDocument,
  raw: unknown,
  context: RustCompilerNormalizationContext,
  role: string,
): RustCompilerNormalizationContext {
  const parameters = raw === null || raw === undefined ? Object.freeze([]) : requireArray(raw, `Rust ${role} binder parameters`);
  const binder = normalizeBinder(document, parameters, context, role);
  return binder === undefined ? context : { ...context, boundLifetimes: boundLifetimeMap(binder) };
}

function boundLifetimeMap(binder: RustCompilerBinder): ReadonlyMap<string, RustCompilerLifetime> {
  return new Map(binder.lifetimes.map((parameter) => {
    const identity = parameter.identity;
    if (identity.kind !== "parameter") throw new Error("Rust binder parameter has no declaration identity.");
    return [identity.displayName, Object.freeze({
      kind: "bound" as const,
      binderId: binder.id,
      parameterId: identity.identity.itemId,
      displayName: identity.displayName,
    })] as const;
  }));
}

function genericParameterName(parameter: RustCompilerGenericParameter): string {
  return parameter.kind === "lifetime"
    ? parameter.identity.kind === "parameter" || parameter.identity.kind === "bound"
      ? parameter.identity.displayName
      : "static"
    : parameter.displayName;
}

function stripLifetime(name: string): string {
  return name.startsWith("'") ? name.slice(1) : name;
}

function childContext(context: RustCompilerNormalizationContext, position: string): RustCompilerNormalizationContext {
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

export function compareCompilerGenericParameters(left: RustCompilerGenericParameter, right: RustCompilerGenericParameter): number {
  return compareText(genericParameterName(left), genericParameterName(right));
}

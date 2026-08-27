import {
  compareText,
  isRecord,
  requireArray,
  requireRecord,
  requireString,
} from "../rustdoc-schema.js";
import {
  childNormalizationContext,
  contextWithParameters,
  resolveRustCompilerItem,
  rustCompilerDerivedIdentity,
} from "./normalization-context.js";
import {
  normalizeConstArgument,
  normalizeLifetime,
  normalizePathArguments,
  normalizeType,
} from "./rustdoc-type-normalization.js";
import {
  typeRequirementKey,
} from "./substitution.js";
import type {
  RustCompilerGenericParameter,
  RustCompilerLifetime,
  RustCompilerLifetimeBinder,
  RustCompilerLifetimeParameter,
  RustCompilerTraitDispatch,
  RustCompilerType,
  RustCompilerTypeParameter,
  RustCompilerTypeRequirement,
} from "../model.js";
import type { RustdocDocument } from "../rustdoc-schema.js";
import type { RustCompilerNormalizationContext } from "./normalization-context.js";

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

export function normalizeTraitDispatch(
  document: RustdocDocument,
  raw: unknown,
  context: RustCompilerNormalizationContext,
): RustCompilerTraitDispatch {
  const trait = requireRecord(raw, "Rust trait reference");
  const pathRecord = requireRecord(
    document.paths[String(trait.id)],
    `Rust trait reference '${String(trait.id)}'`,
  );
  const path = requireArray(pathRecord.path, "Rust trait path");
  if (pathRecord.kind !== "trait" || path.length < 2 ||
    path.some((segment) => typeof segment !== "string")) {
    throw new Error(`Rust trait reference '${String(trait.id)}' has no canonical crate-qualified identity.`);
  }
  const identity = resolveRustCompilerItem(document, trait.id, context).identity;
  const selected = normalizePathArguments(
    document,
    trait.args,
    childNormalizationContext(context, `trait:${identity.itemId}`),
    identity,
  );
  return Object.freeze({
    identity,
    path: (path as string[]).join("::"),
    genericArguments: selected.genericArguments,
    associatedConstraints: selected.associatedConstraints,
  });
}

export interface NormalizedRustCompilerGenerics {
  readonly parameters: readonly RustCompilerGenericParameter[];
  readonly context: RustCompilerNormalizationContext;
  readonly selfRequirements: readonly RustCompilerTypeRequirement[];
  readonly selfOutlives: readonly RustCompilerLifetime[];
  readonly selfMaybeSized: boolean;
}

export function normalizeDeclaredGenericParameters(
  document: RustdocDocument,
  generics: Readonly<Record<string, unknown>>,
  context: RustCompilerNormalizationContext,
): NormalizedRustCompilerGenerics {
  const rawParameters = requireArray(generics.params, "Rust generic parameters");
  const names = new Set<string>();
  const shells = rawParameters.map((raw, index): RustCompilerGenericParameter => {
    const parameter = requireRecord(raw, `Rust generic parameter ${index}`);
    const rawName = requireString(parameter.name, `Rust generic parameter ${index} name`);
    if (names.has(rawName)) {
      throw new Error(`Rust generic parameter '${rawName}' is declared more than once.`);
    }
    names.add(rawName);
    const kind = requireRecord(parameter.kind, `Rust generic parameter '${rawName}' kind`);
    if (isRecord(kind.lifetime)) {
      return Object.freeze({
        kind: "lifetime" as const,
        lifetime: Object.freeze({
          kind: "parameter" as const,
          identity: rustCompilerDerivedIdentity(context.owner, `lifetime:${index}`),
          name: lifetimeDisplayName(rawName),
        }),
        outlives: Object.freeze([]),
      });
    }
    if (isRecord(kind.type)) {
      if (kind.type.is_synthetic !== false) {
        throw new Error(`Rust type parameter '${rawName}' is synthetic and has no public source contract.`);
      }
      return Object.freeze({
        kind: "type" as const,
        identity: rustCompilerDerivedIdentity(context.owner, `type:${index}`),
        name: rawName,
        requirements: Object.freeze([]),
        outlives: Object.freeze([]),
        maybeSized: false,
      });
    }
    if (isRecord(kind.const)) {
      return Object.freeze({
        kind: "const" as const,
        identity: rustCompilerDerivedIdentity(context.owner, `const:${index}`),
        name: rawName,
        type: Object.freeze({ kind: "unit" as const }),
      });
    }
    throw new Error(`Rust generic parameter '${rawName}' has an unsupported rustdoc kind.`);
  });
  const shellContext = contextWithParameters(context, shells);
  const parameters = rawParameters.map((raw, index): RustCompilerGenericParameter => {
    const parameter = requireRecord(raw, `Rust generic parameter ${index}`);
    const rawName = requireString(parameter.name, `Rust generic parameter ${index} name`);
    const rawKind = requireRecord(parameter.kind, `Rust generic parameter '${rawName}' kind`);
    const shell = shells[index]!;
    if (shell.kind === "lifetime") {
      const lifetime = requireRecord(rawKind.lifetime, `Rust lifetime parameter '${rawName}'`);
      return Object.freeze({
        ...shell,
        outlives: Object.freeze(requireArray(
          lifetime.outlives,
          `Rust lifetime parameter '${rawName}' bounds`,
        ).map((bound, boundIndex) => normalizeLifetime(
          bound,
          shellContext,
          `parameter:${index}:outlives:${boundIndex}`,
        ))),
      });
    }
    if (shell.kind === "type") {
      const type = requireRecord(rawKind.type, `Rust type parameter '${rawName}'`);
      const selected = normalizeTypeBounds(
        document,
        requireArray(type.bounds, `Rust type parameter '${rawName}' bounds`),
        shellContext,
      );
      return Object.freeze({
        ...shell,
        requirements: selected.requirements,
        outlives: selected.outlives,
        maybeSized: selected.maybeSized,
        ...(type.default === null || type.default === undefined
          ? {}
          : {
              defaultType: normalizeType(
                document,
                type.default,
                childNormalizationContext(shellContext, `parameter:${index}:default`),
              ),
            }),
      });
    }
    const constant = requireRecord(rawKind.const, `Rust const parameter '${rawName}'`);
    return Object.freeze({
      ...shell,
      type: normalizeType(
        document,
        constant.type,
        childNormalizationContext(shellContext, `parameter:${index}:type`),
      ),
      ...(constant.default === null || constant.default === undefined
        ? {}
        : {
            defaultValue: normalizeConstArgument(
              constant.default,
              shellContext,
              `parameter:${index}:default`,
            ),
          }),
    });
  });
  const completeContext = contextWithParameters(context, parameters);
  return Object.freeze({
    parameters: Object.freeze(parameters),
    context: completeContext,
    selfRequirements: Object.freeze([]),
    selfOutlives: Object.freeze([]),
    selfMaybeSized: false,
  });
}

export function normalizeGenericParameters(
  document: RustdocDocument,
  generics: Readonly<Record<string, unknown>>,
  context: RustCompilerNormalizationContext,
): NormalizedRustCompilerGenerics {
  const declared = normalizeDeclaredGenericParameters(document, generics, context);
  const augmented = applyWherePredicates(
    document,
    declared.parameters,
    requireArray(generics.where_predicates, "Rust generic where predicates"),
    declared.context,
  );
  return Object.freeze({
    parameters: augmented.parameters,
    context: contextWithParameters(context, augmented.parameters),
    selfRequirements: augmented.selfRequirements,
    selfOutlives: augmented.selfOutlives,
    selfMaybeSized: augmented.selfMaybeSized,
  });
}

export function normalizeLifetimeBinder(
  rawParameters: unknown,
  context: RustCompilerNormalizationContext,
  role: string,
): {
  readonly binder?: RustCompilerLifetimeBinder;
  readonly context: RustCompilerNormalizationContext;
} {
  const raw = requireArray(rawParameters, `Rust ${role} binder parameters`);
  if (raw.length === 0) return Object.freeze({ context });
  const binderIdentity = `${context.owner.itemId}\0binder:${context.position}:${role}`;
  const names = new Set<string>();
  const parameters = raw.map((entry, index): RustCompilerLifetimeParameter => {
    const parameter = requireRecord(entry, `Rust ${role} binder parameter ${index}`);
    const name = requireString(parameter.name, `Rust ${role} binder parameter ${index} name`);
    const kind = requireRecord(parameter.kind, `Rust ${role} binder parameter '${name}' kind`);
    if (!isRecord(kind.lifetime) || names.has(name)) {
      throw new Error(`Rust ${role} binder must contain unique lifetime parameters only.`);
    }
    names.add(name);
    return Object.freeze({
      kind: "lifetime",
      lifetime: Object.freeze({
        kind: "bound",
        binderIdentity,
        identity: `${binderIdentity}\0${index}`,
        name: lifetimeDisplayName(name),
      }),
      outlives: Object.freeze([]),
    });
  });
  const binderContext = contextWithParameters(context, parameters);
  const completed = raw.map((entry, index): RustCompilerLifetimeParameter => {
    const parameter = requireRecord(entry, `Rust ${role} binder parameter ${index}`);
    const kind = requireRecord(parameter.kind, `Rust ${role} binder parameter kind`);
    const lifetime = requireRecord(kind.lifetime, `Rust ${role} lifetime parameter`);
    return Object.freeze({
      ...parameters[index]!,
      outlives: Object.freeze(requireArray(
        lifetime.outlives,
        `Rust ${role} lifetime bounds`,
      ).map((bound, boundIndex) => normalizeLifetime(
        bound,
        binderContext,
        `${role}:${index}:outlives:${boundIndex}`,
      ))),
    });
  });
  const finalContext = contextWithParameters(context, completed);
  return Object.freeze({
    binder: Object.freeze({ identity: binderIdentity, parameters: Object.freeze(completed) }),
    context: finalContext,
  });
}

export function sourceVisibleTypeParameterCount(
  parameters: readonly RustCompilerGenericParameter[],
): number {
  const sourceParameters = parameters.filter((parameter) => parameter.kind === "type");
  const firstDefault = sourceParameters.findIndex((parameter) => parameter.defaultType !== undefined);
  if (firstDefault < 0) return sourceParameters.length;
  if (sourceParameters.slice(firstDefault).some((parameter) => parameter.defaultType === undefined)) {
    throw new Error("Rust default type parameters must form one trailing source-omittable suffix.");
  }
  return firstDefault;
}

export function rustCompilerTraitRequirement(
  trait: RustCompilerTraitDispatch,
): RustCompilerTypeRequirement {
  const segments = trait.identity.canonicalPath;
  const exactMarker = trait.genericArguments.length === 0 &&
    trait.associatedConstraints.length === 0 && trait.lifetimeBinder === undefined;
  if (exactMarker && segments.length === 3 &&
    segments[0] === "core" && segments[1] === "clone" && segments[2] === "Clone") {
    return "clone";
  }
  if (exactMarker && segments.length === 3 &&
    segments[0] === "core" && segments[1] === "marker" && segments[2] === "Copy") {
    return "copy";
  }
  return Object.freeze({ kind: "trait", trait });
}

export function mergeTypeParameterRequirements(
  ...groups: readonly (readonly RustCompilerTypeParameter[])[]
): readonly RustCompilerTypeParameter[] {
  const byIdentity = new Map<string, RustCompilerTypeParameter>();
  for (const group of groups) {
    for (const parameter of group) {
      const existing = byIdentity.get(parameter.identity.itemId);
      const requirements = new Map<string, RustCompilerTypeRequirement>();
      for (const requirement of existing?.requirements ?? []) {
        requirements.set(typeRequirementKey(requirement), requirement);
      }
      for (const requirement of parameter.requirements) {
        requirements.set(typeRequirementKey(requirement), requirement);
      }
      byIdentity.set(parameter.identity.itemId, Object.freeze({
        ...parameter,
        requirements: Object.freeze([...requirements.entries()]
          .sort(([left], [right]) => compareText(left, right))
          .map(([, requirement]) => requirement)),
      }));
    }
  }
  return Object.freeze([...byIdentity.values()].sort((left, right) =>
    compareText(left.identity.itemId, right.identity.itemId)));
}

function applyWherePredicates(
  document: RustdocDocument,
  parameters: readonly RustCompilerGenericParameter[],
  predicates: readonly unknown[],
  context: RustCompilerNormalizationContext,
): {
  readonly parameters: readonly RustCompilerGenericParameter[];
  readonly selfRequirements: readonly RustCompilerTypeRequirement[];
  readonly selfOutlives: readonly RustCompilerLifetime[];
  readonly selfMaybeSized: boolean;
} {
  const selected = new Map(parameters.map((parameter) => [parameterIdentity(parameter), parameter] as const));
  let selfRequirements: readonly RustCompilerTypeRequirement[] = Object.freeze([]);
  let selfOutlives: readonly RustCompilerLifetime[] = Object.freeze([]);
  let selfMaybeSized = true;
  for (const [index, raw] of predicates.entries()) {
    const predicate = requireRecord(raw, `Rust generic where predicate ${index}`);
    if (isRecord(predicate.lifetime_predicate)) {
      const lifetimePredicate = predicate.lifetime_predicate;
      const lifetime = normalizeLifetime(
        lifetimePredicate.lifetime,
        context,
        `where:${index}:lifetime`,
      );
      if (lifetime.kind !== "parameter") {
        throw new Error("Rust lifetime where predicates must constrain one declared lifetime parameter.");
      }
      const parameter = selected.get(lifetime.identity.itemId);
      if (parameter?.kind !== "lifetime") {
        throw new Error("Rust lifetime where predicate has no matching declaration.");
      }
      selected.set(lifetime.identity.itemId, Object.freeze({
        ...parameter,
        outlives: mergeLifetimes(parameter.outlives, requireArray(
          lifetimePredicate.outlives,
          "Rust lifetime where-predicate bounds",
        ).map((bound, boundIndex) => normalizeLifetime(
          bound,
          context,
          `where:${index}:outlives:${boundIndex}`,
        ))),
      }));
      continue;
    }
    const bounded = isRecord(predicate.bound_predicate) ? predicate.bound_predicate : undefined;
    if (bounded === undefined || requireArray(
      bounded.generic_params,
      "Rust generic where-predicate binders",
    ).length !== 0) {
      throw new Error("Rust equality and higher-ranked where predicates have no current provider requirement contract.");
    }
    const type = normalizeType(
      document,
      bounded.type,
      childNormalizationContext(context, `where:${index}:type`),
    );
    const bounds = normalizeTypeBounds(
      document,
      requireArray(bounded.bounds, "Rust type where-predicate bounds"),
      context,
    );
    if (type.kind === "self") {
      selfRequirements = mergeRequirements(selfRequirements, bounds.requirements);
      selfOutlives = mergeLifetimes(selfOutlives, bounds.outlives);
      if (bounds.requirements.some((requirement) =>
        typeof requirement === "object" && requirement.kind === "trait" &&
        isSizedTrait(requirement.trait))) {
        selfMaybeSized = false;
      }
      if (bounds.maybeSized) selfMaybeSized = true;
      continue;
    }
    if (type.kind !== "generic") {
      throw new Error("Rust where predicates must constrain one declared type parameter directly.");
    }
    const parameter = selected.get(type.identity.itemId);
    if (parameter?.kind !== "type") {
      throw new Error("Rust type where predicate has no matching declaration.");
    }
    selected.set(type.identity.itemId, Object.freeze({
      ...parameter,
      requirements: mergeRequirements(parameter.requirements, bounds.requirements),
      outlives: mergeLifetimes(parameter.outlives, bounds.outlives),
      maybeSized: parameter.maybeSized || bounds.maybeSized,
    }));
  }
  return Object.freeze({
    parameters: Object.freeze(parameters.map((parameter) => selected.get(parameterIdentity(parameter))!)),
    selfRequirements,
    selfOutlives,
    selfMaybeSized,
  });
}

export function normalizeTypeBounds(
  document: RustdocDocument,
  bounds: readonly unknown[],
  context: RustCompilerNormalizationContext,
): {
  readonly requirements: readonly RustCompilerTypeRequirement[];
  readonly outlives: readonly RustCompilerLifetime[];
  readonly maybeSized: boolean;
} {
  const selected = normalizeTraitBounds(document, bounds, context);
  return Object.freeze({
    requirements: mergeRequirements(
      [],
      selected.traits.map(rustCompilerTraitRequirement),
    ),
    outlives: selected.outlives,
    maybeSized: selected.maybeSized,
  });
}

export function normalizeTraitBounds(
  document: RustdocDocument,
  bounds: readonly unknown[],
  context: RustCompilerNormalizationContext,
): {
  readonly traits: readonly RustCompilerTraitDispatch[];
  readonly outlives: readonly RustCompilerLifetime[];
  readonly maybeSized: boolean;
} {
  const traits: RustCompilerTraitDispatch[] = [];
  const outlives: RustCompilerLifetime[] = [];
  let maybeSized = false;
  for (const [index, raw] of bounds.entries()) {
    const bound = requireRecord(raw, `Rust generic bound ${index}`);
    if (bound.outlives !== undefined) {
      outlives.push(normalizeLifetime(bound.outlives, context, `bound:${index}:outlives`));
      continue;
    }
    const traitBound = isRecord(bound.trait_bound) ? bound.trait_bound : undefined;
    if (traitBound === undefined) {
      throw new Error("Rust generic bound is neither one lifetime nor one exact trait.");
    }
    const binder = normalizeLifetimeBinder(
      traitBound.generic_params,
      childNormalizationContext(context, `bound:${index}`),
      `trait-bound:${index}`,
    );
    const selectedTrait = normalizeTraitDispatch(document, traitBound.trait, binder.context);
    const trait = Object.freeze({
      ...selectedTrait,
      ...(binder.binder === undefined ? {} : { lifetimeBinder: binder.binder }),
    });
    if (traitBound.modifier === "maybe") {
      if (!isSizedTrait(trait)) {
        throw new Error(`Rust optional trait '${trait.path}' has no provider requirement contract.`);
      }
      maybeSized = true;
      continue;
    }
    if (traitBound.modifier !== "none" && traitBound.modifier !== "maybe_const") {
      throw new Error(`Rust trait-bound modifier '${String(traitBound.modifier)}' is unsupported.`);
    }
    traits.push(trait);
  }
  return Object.freeze({
    traits: Object.freeze([...new Map(traits.map((trait) => [
      typeRequirementKey({ kind: "trait", trait }),
      trait,
    ])).values()]),
    outlives: mergeLifetimes([], outlives),
    maybeSized,
  });
}

function isSizedTrait(trait: RustCompilerTraitDispatch): boolean {
  const path = trait.identity.canonicalPath;
  return trait.lifetimeBinder === undefined && trait.genericArguments.length === 0 &&
    trait.associatedConstraints.length === 0 && path.length === 3 &&
    path[0] === "core" && path[1] === "marker" && path[2] === "Sized";
}

function parameterIdentity(parameter: RustCompilerGenericParameter): string {
  return parameter.kind === "lifetime"
    ? parameter.lifetime.kind === "parameter"
      ? parameter.lifetime.identity.itemId
      : parameter.lifetime.identity
    : parameter.identity.itemId;
}

function lifetimeDisplayName(name: string): string {
  const value = name.startsWith("'") ? name.slice(1) : name;
  if (value.length === 0 || value === "static" || value === "_") {
    throw new Error(`Rust lifetime parameter '${name}' has no declaration name.`);
  }
  return value;
}

function mergeRequirements(
  left: readonly RustCompilerTypeRequirement[],
  right: readonly RustCompilerTypeRequirement[],
): readonly RustCompilerTypeRequirement[] {
  const values = new Map<string, RustCompilerTypeRequirement>();
  for (const requirement of [...left, ...right]) {
    values.set(typeRequirementKey(requirement), requirement);
  }
  return Object.freeze([...values.entries()]
    .sort(([leftKey], [rightKey]) => compareText(leftKey, rightKey))
    .map(([, requirement]) => requirement));
}

function mergeLifetimes(
  left: readonly RustCompilerLifetime[],
  right: readonly RustCompilerLifetime[],
): readonly RustCompilerLifetime[] {
  const values = new Map<string, RustCompilerLifetime>();
  for (const lifetime of [...left, ...right]) {
    values.set(lifetimeKey(lifetime), lifetime);
  }
  return Object.freeze([...values.entries()]
    .sort(([leftKey], [rightKey]) => compareText(leftKey, rightKey))
    .map(([, lifetime]) => lifetime));
}

function lifetimeKey(lifetime: RustCompilerLifetime): string {
  switch (lifetime.kind) {
    case "static":
    case "placeholder":
      return lifetime.kind;
    case "parameter":
      return `parameter:${lifetime.identity.itemId}`;
    case "bound":
      return `bound:${lifetime.identity}`;
    case "elided":
      return `elided:${lifetime.ownerIdentity}:${lifetime.position}`;
  }
}

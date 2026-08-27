import {
  hasInnerKind,
  isRecord,
  itemById,
  normalizeAbi,
  requireArray,
  requireBoolean,
  requireInnerRecord,
  requireRecord,
  requireString,
} from "../rustdoc-schema.js";
import {
  childNormalizationContext,
  contextResolvingAlias,
  derivedNormalizationContext,
  resolveRustCompilerItem,
  rootNormalizationContext,
  rustCompilerDerivedIdentity,
} from "./normalization-context.js";
import {
  normalizeDeclaredGenericParameters,
  normalizeGenericParameters,
  normalizeLifetimeBinder,
  normalizeTypeBounds,
  normalizeTraitDispatch,
} from "./normalization.js";
import type {
  RustCompilerAssociatedConstraint,
  RustCompilerConstArgument,
  RustCompilerGenericArgument,
  RustCompilerGenericParameter,
  RustCompilerItemIdentity,
  RustCompilerLifetime,
  RustCompilerTraitDispatch,
  RustCompilerType,
} from "../model.js";
import type { RustdocDocument } from "../rustdoc-schema.js";
import type { RustCompilerNormalizationContext } from "./normalization-context.js";
import {
  createRustCompilerSubstitutions,
  rustCompilerGenericArgumentSemanticKey,
  substituteRustCompilerType,
} from "./substitution.js";

export interface NormalizedRustCompilerPathArguments {
  readonly genericArguments: readonly RustCompilerGenericArgument[];
  readonly associatedConstraints: readonly RustCompilerAssociatedConstraint[];
}

export function normalizeType(
  document: RustdocDocument,
  raw: unknown,
  context: RustCompilerNormalizationContext,
): RustCompilerType {
  const type = requireRecord(raw, "Rust type");
  if (typeof type.primitive === "string") {
    return Object.freeze({ kind: "primitive", name: type.primitive });
  }
  if (typeof type.generic === "string") {
    if (type.generic === "Self") {
      if (context.selfOwner === undefined) {
        throw new Error("Rust Self type has no exact owning declaration.");
      }
      return Object.freeze({ kind: "self", owner: context.selfOwner });
    }
    const parameter = context.parameters.get(type.generic);
    if (parameter?.kind !== "type") {
      throw new Error(`Rust type parameter '${type.generic}' has no declaration-backed identity.`);
    }
    return Object.freeze({ kind: "generic", identity: parameter.identity, name: parameter.name });
  }
  if (Array.isArray(type.tuple)) {
    return Object.freeze({
      kind: "tuple",
      elements: Object.freeze(type.tuple.map((element, index) => normalizeType(
        document,
        element,
        childNormalizationContext(context, `tuple:${index}`),
      ))),
    });
  }
  if (type.slice !== undefined) {
    return Object.freeze({
      kind: "slice",
      element: normalizeType(document, type.slice, childNormalizationContext(context, "slice")),
    });
  }
  if (isRecord(type.array)) {
    return Object.freeze({
      kind: "array",
      element: normalizeType(document, type.array.type, childNormalizationContext(context, "array:element")),
      length: normalizeConstArgument(type.array.len, context, "array:length"),
    });
  }
  if (isRecord(type.borrowed_ref)) {
    return Object.freeze({
      kind: "reference",
      mutable: requireBoolean(type.borrowed_ref.is_mutable, "Rust reference mutability"),
      lifetime: normalizeLifetime(
        type.borrowed_ref.lifetime,
        context,
        `${context.position}/reference:lifetime`,
      ),
      target: normalizeType(
        document,
        type.borrowed_ref.type,
        childNormalizationContext(context, "reference:target"),
      ),
    });
  }
  if (isRecord(type.raw_pointer)) {
    return Object.freeze({
      kind: "raw-pointer",
      mutable: requireBoolean(type.raw_pointer.is_mutable, "Rust raw-pointer mutability"),
      target: normalizeType(
        document,
        type.raw_pointer.type,
        childNormalizationContext(context, "raw-pointer:target"),
      ),
    });
  }
  if (isRecord(type.function_pointer)) {
    return normalizeFunctionPointer(document, type.function_pointer, context);
  }
  if (isRecord(type.qualified_path)) {
    const qualified = type.qualified_path;
    const trait = normalizeTraitDispatch(
      document,
      qualified.trait,
      childNormalizationContext(context, "associated:trait"),
    );
    const selected = normalizePathArguments(
      document,
      qualified.args,
      childNormalizationContext(context, "associated:arguments"),
      trait.identity,
    );
    if (selected.associatedConstraints.length !== 0) {
      throw new Error("Rust associated-type path arguments cannot contain nested associated constraints.");
    }
    const name = requireString(qualified.name, "Rust associated type name");
    const declaration = normalizeAssociatedTypeReference(
      document,
      qualified.trait,
      trait,
      name,
      context,
    );
    if (declaration.genericParameters.length !== selected.genericArguments.length ||
      declaration.genericParameters.some((parameter, index) =>
        parameter.kind !== "lifetime" || selected.genericArguments[index]?.kind !== "lifetime")) {
      throw new Error("Generic associated Rust types have no closed provider type contract.");
    }
    return Object.freeze({
      kind: "associated-type",
      identity: rustCompilerDerivedIdentity(trait.identity, `associated:${name}`),
      owner: normalizeType(
        document,
        qualified.self_type,
        childNormalizationContext(context, "associated:owner"),
      ),
      trait,
      name,
      genericArguments: selected.genericArguments,
      maybeSized: declaration.maybeSized,
    });
  }
  if (isRecord(type.resolved_path)) {
    return normalizeResolvedPath(document, type.resolved_path, context);
  }
  if (isRecord(type.dyn_trait)) {
    return normalizeDynamicTrait(document, type.dyn_trait, context);
  }
  if (Array.isArray(type.impl_trait)) {
    return normalizeOpaqueType(document, type.impl_trait, context);
  }
  if (type.infer !== undefined) {
    throw new Error("Rust inferred provider types have no exact public contract.");
  }
  if (isRecord(type.pat)) {
    throw new Error("Rust pattern types have no approved provider lifetime contract.");
  }
  throw new Error("Rust type has no supported exact representation.");
}

function normalizeAssociatedTypeReference(
  document: RustdocDocument,
  rawTrait: unknown,
  trait: RustCompilerTraitDispatch,
  name: string,
  context: RustCompilerNormalizationContext,
): {
  readonly genericParameters: readonly RustCompilerGenericParameter[];
  readonly maybeSized: boolean;
} {
  const traitReference = requireRecord(rawTrait, "Rust associated-type trait reference");
  const resolvedTrait = resolveRustCompilerItem(document, traitReference.id, context);
  if (resolvedTrait.item === undefined || !hasInnerKind(resolvedTrait.item, "trait") ||
    resolvedTrait.identity.itemId !== trait.identity.itemId) {
    throw new Error(`Rust associated type '${name}' has no exact trait declaration.`);
  }
  const traitBody = requireInnerRecord(
    resolvedTrait.item,
    "trait",
    `Rust associated type '${name}' trait declaration`,
  );
  const candidates = requireArray(
    traitBody.items,
    `Rust associated type '${name}' trait members`,
  ).flatMap((itemId): readonly Readonly<Record<string, unknown>>[] => {
    const selected = itemById(resolvedTrait.document, itemId);
    return hasInnerKind(selected, "assoc_type") && selected.name === name
      ? Object.freeze([selected])
      : Object.freeze([]);
  });
  if (candidates.length !== 1) {
    throw new Error(`Rust associated type '${name}' does not select one exact declaration.`);
  }
  const associated = requireInnerRecord(
    candidates[0]!,
    "assoc_type",
    `Rust associated type '${name}' declaration`,
  );
  const associatedContext = derivedNormalizationContext(
    resolvedTrait.dependency,
    trait.identity,
    `associated:${name}`,
    {
      selfOwner: trait.identity,
      ...(context.resolveItem === undefined ? {} : { resolveItem: context.resolveItem }),
    },
  );
  const generics = normalizeDeclaredGenericParameters(
    resolvedTrait.document,
    requireRecord(associated.generics, `Rust associated type '${name}' generics`),
    associatedContext,
  );
  const bounds = normalizeTypeBounds(
    resolvedTrait.document,
    requireArray(associated.bounds, `Rust associated type '${name}' bounds`),
    generics.context,
  );
  return Object.freeze({
    genericParameters: generics.parameters,
    maybeSized: bounds.maybeSized,
  });
}

export function normalizeLifetime(
  raw: unknown,
  context: RustCompilerNormalizationContext,
  position: string,
): RustCompilerLifetime {
  if (raw === null || raw === undefined) {
    return Object.freeze({ kind: "elided", ownerIdentity: context.owner.itemId, position });
  }
  if (raw === "'static" || raw === "static") return Object.freeze({ kind: "static" });
  if (raw === "'_" || raw === "_") return Object.freeze({ kind: "placeholder" });
  if (typeof raw !== "string") {
    throw new Error("Rust lifetime has no stable rustdoc representation.");
  }
  const name = stripLifetimeName(raw);
  const parameter = context.parameters.get(name) ?? context.parameters.get(raw);
  if (parameter?.kind !== "lifetime") {
    throw new Error(`Rust lifetime '${raw}' has no declaration-backed identity.`);
  }
  return parameter.lifetime;
}

export function normalizeConstArgument(
  raw: unknown,
  context: RustCompilerNormalizationContext,
  position: string,
): RustCompilerConstArgument {
  if (typeof raw === "boolean") return Object.freeze({ kind: "boolean", value: raw });
  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw)) {
      throw new Error(`Rust const argument at '${position}' is not a safe integer.`);
    }
    return Object.freeze({ kind: "integer", value: String(raw) });
  }
  const expression = isRecord(raw)
    ? typeof raw.expr === "string"
      ? raw.expr
      : typeof raw.value === "string"
        ? raw.value
        : undefined
    : typeof raw === "string"
      ? raw
      : undefined;
  if (expression === undefined) {
    throw new Error(`Rust const argument at '${position}' has no exact scalar representation.`);
  }
  const source = expression.trim();
  if (source === "_") return Object.freeze({ kind: "infer" });
  if (source === "true" || source === "false") {
    return Object.freeze({ kind: "boolean", value: source === "true" });
  }
  if (isRustIntegerLiteral(source)) {
    return Object.freeze({ kind: "integer", value: normalizeRustInteger(source) });
  }
  if (isRustCharacterLiteral(source)) {
    return Object.freeze({ kind: "char", value: decodeRustCharacter(source) });
  }
  if (/^(?:r#)?[A-Za-z_][A-Za-z0-9_]*$/u.test(source)) {
    const parameter = context.parameters.get(source);
    if (parameter?.kind !== "const") {
      throw new Error(`Rust const argument '${source}' has no declaration-backed identity.`);
    }
    return Object.freeze({ kind: "parameter", identity: parameter.identity, name: parameter.name });
  }
  throw new Error(`Rust const argument '${source}' is outside the approved literal-or-parameter contract.`);
}

export function normalizePathArguments(
  document: RustdocDocument,
  raw: unknown,
  context: RustCompilerNormalizationContext,
  associatedOwner?: RustCompilerItemIdentity,
): NormalizedRustCompilerPathArguments {
  if (raw === null || raw === undefined) {
    return Object.freeze({
      genericArguments: Object.freeze([]),
      associatedConstraints: Object.freeze([]),
    });
  }
  const args = requireRecord(raw, "Rust path arguments");
  if (isRecord(args.parenthesized)) {
    if (associatedOwner === undefined) {
      throw new Error("Rust parenthesized path arguments require one exact trait identity.");
    }
    const parenthesized = args.parenthesized;
    const parameters = requireArray(parenthesized.inputs, "Rust parenthesized path inputs")
      .map((input, index) => normalizeType(
        document,
        input,
        childNormalizationContext(context, `parenthesized:input:${index}`),
      ));
    const input: RustCompilerType = parameters.length === 0
      ? Object.freeze({ kind: "unit" })
      : Object.freeze({ kind: "tuple", elements: Object.freeze(parameters) });
    const result: RustCompilerType = parenthesized.output === null
      ? Object.freeze({ kind: "unit" })
      : normalizeType(
          document,
          parenthesized.output,
          childNormalizationContext(context, "parenthesized:output"),
        );
    return Object.freeze({
      genericArguments: Object.freeze([
        Object.freeze({ kind: "type" as const, type: input }),
      ]),
      associatedConstraints: Object.freeze([Object.freeze({
        kind: "equality" as const,
        identity: rustCompilerDerivedIdentity(associatedOwner, "associated:Output"),
        name: "Output",
        genericArguments: Object.freeze([]),
        type: result,
      })]),
    });
  }
  const angle = requireRecord(args.angle_bracketed, "Rust angle-bracketed path arguments");
  const genericArguments = requireArray(angle.args, "Rust path generic arguments")
    .map((rawArgument, index): RustCompilerGenericArgument => {
      const argument = requireRecord(rawArgument, `Rust path generic argument ${index}`);
      if (argument.lifetime !== undefined) {
        return Object.freeze({
          kind: "lifetime",
          lifetime: normalizeLifetime(argument.lifetime, context, `${context.position}/argument:${index}`),
        });
      }
      if (argument.type !== undefined) {
        return Object.freeze({
          kind: "type",
          type: normalizeType(
            document,
            argument.type,
            childNormalizationContext(context, `argument:${index}:type`),
          ),
        });
      }
      if (argument.const !== undefined) {
        return Object.freeze({
          kind: "const",
          value: normalizeConstArgument(argument.const, context, `argument:${index}:const`),
        });
      }
      throw new Error(`Rust path generic argument ${index} has no exact lifetime, type, or const kind.`);
    });
  const rawConstraints = requireArray(angle.constraints, "Rust path associated constraints");
  if (rawConstraints.length !== 0 && associatedOwner === undefined) {
    throw new Error("Rust associated constraints have no exact owning trait identity.");
  }
  const associatedConstraints = rawConstraints.map((constraint, index) => normalizeAssociatedConstraint(
    document,
    constraint,
    associatedOwner!,
    childNormalizationContext(context, `constraint:${index}`),
  ));
  return Object.freeze({
    genericArguments: Object.freeze(genericArguments),
    associatedConstraints: Object.freeze(associatedConstraints),
  });
}

function normalizeFunctionPointer(
  document: RustdocDocument,
  pointer: Readonly<Record<string, unknown>>,
  context: RustCompilerNormalizationContext,
): RustCompilerType {
  const selectedBinder = normalizeLifetimeBinder(
    pointer.generic_params,
    context,
    "function-pointer",
  );
  const signature = requireRecord(pointer.sig, "Rust function pointer signature");
  if (requireBoolean(signature.is_c_variadic, "Rust function-pointer variadicness")) {
    throw new Error("Variadic Rust function-pointer types have no approved source contract.");
  }
  const header = requireRecord(pointer.header, "Rust function pointer header");
  const parameters = requireArray(signature.inputs, "Rust function pointer inputs").map((input, index) => {
    if (!Array.isArray(input) || input.length !== 2) {
      throw new Error(`Rust function pointer input ${index} has an invalid rustdoc shape.`);
    }
    return normalizeType(
      document,
      input[1],
      childNormalizationContext(selectedBinder.context, `parameter:${index}`),
    );
  });
  return Object.freeze({
    kind: "function-pointer",
    parameters: Object.freeze(parameters),
    result: signature.output === null
      ? Object.freeze({ kind: "unit" })
      : normalizeType(
          document,
          signature.output,
          childNormalizationContext(selectedBinder.context, "result"),
        ),
    ...(selectedBinder.binder === undefined ? {} : { lifetimeBinder: selectedBinder.binder }),
    abi: normalizeAbi(header.abi, "Rust function pointer ABI"),
    unsafe: requireBoolean(header.is_unsafe, "Rust function pointer safety"),
  });
}

function normalizeResolvedPath(
  document: RustdocDocument,
  resolvedPath: Readonly<Record<string, unknown>>,
  context: RustCompilerNormalizationContext,
): RustCompilerType {
  const resolved = resolveRustCompilerItem(document, resolvedPath.id, context);
  const identity = resolved.identity;
  const path = identity.canonicalPath;
  const selected = normalizePathArguments(
    document,
    resolvedPath.args,
    childNormalizationContext(context, `path:${identity.itemId}`),
  );
  if (selected.associatedConstraints.length !== 0) {
    throw new Error("Rust nominal type paths cannot contain associated constraints.");
  }
  if (resolved.item !== undefined && hasInnerKind(resolved.item, "type_alias")) {
    const alias = requireInnerRecord(resolved.item, "type_alias", `Rust type alias '${identity.itemId}'`);
    const aliasRoot = rootNormalizationContext(
      resolved.document,
      resolved.dependency,
      resolved.item,
      context.resolveItem,
    );
    const aliasContext = contextResolvingAlias(Object.freeze({
      ...aliasRoot,
      resolvingAliases: context.resolvingAliases,
    }), identity.itemId);
    const generics = normalizeGenericParameters(
      resolved.document,
      requireRecord(alias.generics, `Rust type alias '${identity.itemId}' generics`),
      aliasContext,
    );
    const substitutions = createRustCompilerSubstitutions(
      generics.parameters,
      selected.genericArguments,
    );
    return substituteRustCompilerType(
      normalizeType(
        resolved.document,
        alias.type,
        childNormalizationContext(generics.context, "alias:target"),
      ),
      substitutions,
    );
  }
  return Object.freeze({
    kind: "path",
    identity,
    crateName: path[0]!,
    modulePath: Object.freeze(path.slice(1, -1)),
    name: path[path.length - 1]!,
    genericArguments: selected.genericArguments,
  });
}

function normalizeDynamicTrait(
  document: RustdocDocument,
  dynamic: Readonly<Record<string, unknown>>,
  context: RustCompilerNormalizationContext,
): RustCompilerType {
  const selected = requireArray(dynamic.traits, "Rust dynamic trait bounds").map((entry, index) => {
    const bound = requireRecord(entry, `Rust dynamic trait bound ${index}`);
    const binder = normalizeLifetimeBinder(
      bound.generic_params,
      childNormalizationContext(context, `trait-object:${index}`),
      `trait-object:${index}`,
    );
    const trait = normalizeTraitDispatch(document, bound.trait, binder.context);
    const traitRecord = requireRecord(bound.trait, `Rust dynamic trait bound ${index} trait`);
    const resolved = resolveRustCompilerItem(document, traitRecord.id, binder.context);
    if (resolved.item === undefined || !hasInnerKind(resolved.item, "trait")) {
      throw new Error(`Rust dynamic trait '${trait.path}' has no exact declaration for auto-trait classification.`);
    }
    const declaration = requireInnerRecord(resolved.item, "trait", `Rust dynamic trait '${trait.path}'`);
    return Object.freeze({
      trait: Object.freeze({
        ...trait,
        ...(binder.binder === undefined ? {} : { lifetimeBinder: binder.binder }),
      }),
      auto: requireBoolean(declaration.is_auto, `Rust dynamic trait '${trait.path}' auto classification`),
    });
  });
  const principal = selected.filter((entry) => !entry.auto);
  if (principal.length !== 1) {
    throw new Error(`Rust trait object requires exactly one non-auto principal trait; found ${principal.length}.`);
  }
  const autoTraits = selected.filter((entry) => entry.auto)
    .map((entry) => entry.trait)
    .sort((left, right) => left.identity.itemId.localeCompare(right.identity.itemId));
  if (autoTraits.some((trait, index) => index > 0 &&
    trait.identity.itemId === autoTraits[index - 1]!.identity.itemId)) {
    throw new Error("Rust trait object repeats one exact auto-trait identity.");
  }
  return Object.freeze({
    kind: "trait-object",
    principal: principal[0]!.trait,
    autoTraits: Object.freeze(autoTraits),
    lifetime: normalizeLifetime(dynamic.lifetime, context, `${context.position}/trait-object:lifetime`),
  });
}

function normalizeOpaqueType(
  document: RustdocDocument,
  rawBounds: readonly unknown[],
  context: RustCompilerNormalizationContext,
): RustCompilerType {
  const bounds: RustCompilerTraitDispatch[] = [];
  const outlives: RustCompilerLifetime[] = [];
  let captures: readonly RustCompilerGenericArgument[] | undefined;
  for (const [index, raw] of rawBounds.entries()) {
    const bound = requireRecord(raw, `Rust opaque bound ${index}`);
    if (bound.outlives !== undefined) {
      outlives.push(normalizeLifetime(
        bound.outlives,
        context,
        `${context.position}/opaque:outlives:${index}`,
      ));
      continue;
    }
    if (Array.isArray(bound.use)) {
      if (captures !== undefined) {
        throw new Error("Rust opaque type declares more than one precise capture set.");
      }
      captures = Object.freeze(bound.use.map((capture, captureIndex) => normalizeOpaqueCapture(
        capture,
        context,
        `opaque:capture:${captureIndex}`,
      )));
      continue;
    }
    const traitBound = requireRecord(bound.trait_bound, `Rust opaque trait bound ${index}`);
    if (traitBound.modifier !== "none" && traitBound.modifier !== "maybe_const") {
      throw new Error(`Rust opaque trait-bound modifier '${String(traitBound.modifier)}' is unsupported.`);
    }
    const binder = normalizeLifetimeBinder(
      traitBound.generic_params,
      childNormalizationContext(context, `opaque:bound:${index}`),
      `opaque-bound:${index}`,
    );
    const trait = normalizeTraitDispatch(document, traitBound.trait, binder.context);
    bounds.push(Object.freeze({
      ...trait,
      ...(binder.binder === undefined ? {} : { lifetimeBinder: binder.binder }),
    }));
  }
  if (bounds.length === 0) throw new Error("Rust opaque type has no exact trait bound.");
  if (captures === undefined) {
    throw new Error("Rust opaque type has no exact compiler-visible capture set.");
  }
  const captureKeys = captures.map((capture) =>
    rustCompilerGenericArgumentSemanticKey(capture));
  if (new Set(captureKeys).size !== captureKeys.length) {
    throw new Error("Rust opaque type repeats one exact capture identity.");
  }
  return Object.freeze({
    kind: "opaque",
    identity: rustCompilerDerivedIdentity(context.owner, `opaque:${context.position}`),
    bounds: Object.freeze(bounds),
    outlives: Object.freeze(outlives),
    captures,
  });
}

function normalizeOpaqueCapture(
  raw: unknown,
  context: RustCompilerNormalizationContext,
  position: string,
): RustCompilerGenericArgument {
  const capture = requireRecord(raw, `Rust ${position}`);
  if (capture.lifetime !== undefined) {
    const lifetime = normalizeLifetime(capture.lifetime, context, `${context.position}/${position}`);
    if (lifetime.kind !== "parameter" && lifetime.kind !== "bound") {
      throw new Error(`Rust ${position} is not an in-scope lifetime declaration.`);
    }
    return Object.freeze({ kind: "lifetime", lifetime });
  }
  const name = requireString(capture.param, `Rust ${position} parameter`);
  if (name === "Self") {
    if (context.selfOwner === undefined) {
      throw new Error(`Rust ${position} captures Self outside an exact trait owner.`);
    }
    return Object.freeze({
      kind: "type",
      type: Object.freeze({ kind: "self", owner: context.selfOwner }),
    });
  }
  const parameter = context.parameters.get(name);
  if (parameter?.kind === "type") {
    return Object.freeze({
      kind: "type",
      type: Object.freeze({ kind: "generic", identity: parameter.identity, name: parameter.name }),
    });
  }
  if (parameter?.kind === "const") {
    return Object.freeze({
      kind: "const",
      value: Object.freeze({ kind: "parameter", identity: parameter.identity, name: parameter.name }),
    });
  }
  throw new Error(`Rust ${position} parameter '${name}' has no declaration-backed identity.`);
}

function normalizeAssociatedConstraint(
  document: RustdocDocument,
  raw: unknown,
  owner: RustCompilerItemIdentity,
  context: RustCompilerNormalizationContext,
): RustCompilerAssociatedConstraint {
  const constraint = requireRecord(raw, "Rust associated constraint");
  const name = requireString(constraint.name, "Rust associated constraint name");
  const selected = normalizePathArguments(
    document,
    constraint.args,
    childNormalizationContext(context, "arguments"),
  );
  if (selected.associatedConstraints.length !== 0) {
    throw new Error("Rust associated constraint arguments cannot contain nested constraints.");
  }
  const identity = rustCompilerDerivedIdentity(owner, `associated:${name}`);
  const binding = requireRecord(constraint.binding, `Rust associated constraint '${name}' binding`);
  if (isRecord(binding.equality)) {
    return Object.freeze({
      kind: "equality",
      identity,
      name,
      genericArguments: selected.genericArguments,
      type: normalizeType(
        document,
        binding.equality.type,
        childNormalizationContext(context, "equality"),
      ),
    });
  }
  const rawBounds = requireArray(binding.constraint, `Rust associated constraint '${name}' bounds`);
  const traits: RustCompilerTraitDispatch[] = [];
  const outlives: RustCompilerLifetime[] = [];
  for (const [index, rawBound] of rawBounds.entries()) {
    const bound = requireRecord(rawBound, `Rust associated constraint '${name}' bound ${index}`);
    if (bound.outlives !== undefined) {
      outlives.push(normalizeLifetime(
        bound.outlives,
        context,
        `${context.position}/outlives:${index}`,
      ));
      continue;
    }
    const traitBound = requireRecord(
      bound.trait_bound,
      `Rust associated constraint '${name}' trait bound ${index}`,
    );
    if (traitBound.modifier !== "none" && traitBound.modifier !== "maybe_const") {
      throw new Error(`Rust associated constraint '${name}' has unsupported trait modifier '${String(traitBound.modifier)}'.`);
    }
    const binder = normalizeLifetimeBinder(
      traitBound.generic_params,
      childNormalizationContext(context, `bound:${index}`),
      `associated-bound:${index}`,
    );
    const trait = normalizeTraitDispatch(document, traitBound.trait, binder.context);
    traits.push(Object.freeze({
      ...trait,
      ...(binder.binder === undefined ? {} : { lifetimeBinder: binder.binder }),
    }));
  }
  return Object.freeze({
    kind: "bounds",
    identity,
    name,
    genericArguments: selected.genericArguments,
    traits: Object.freeze(traits),
    outlives: Object.freeze(outlives),
  });
}

function stripLifetimeName(value: string): string {
  return value.startsWith("'") ? value.slice(1) : value;
}

function isRustIntegerLiteral(value: string): boolean {
  return /^-?(?:0[xX][0-9A-Fa-f_]+|0[oO][0-7_]+|0[bB][01_]+|[0-9][0-9_]*)(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize)?$/u.test(value);
}

function normalizeRustInteger(value: string): string {
  const negative = value.startsWith("-");
  const source = negative ? value.slice(1) : value;
  const unsuffixed = source
    .replace(/(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize)$/u, "")
    .split("_")
    .join("");
  const parsed = BigInt(unsuffixed);
  return (negative ? -parsed : parsed).toString();
}

function isRustCharacterLiteral(value: string): boolean {
  return value.length >= 3 && value.startsWith("'") && value.endsWith("'");
}

function decodeRustCharacter(value: string): string {
  const body = value.slice(1, -1);
  if (!body.startsWith("\\")) {
    if ([...body].length !== 1) {
      throw new Error(`Rust character literal '${value}' is not one Unicode scalar value.`);
    }
    return body;
  }
  if (body.startsWith("\\u{") && body.endsWith("}")) {
    const codePoint = Number.parseInt(body.slice(3, -1).split("_").join(""), 16);
    if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff ||
      codePoint >= 0xd800 && codePoint <= 0xdfff) {
      throw new Error(`Rust character literal '${value}' has an invalid Unicode scalar value.`);
    }
    return String.fromCodePoint(codePoint);
  }
  switch (body.slice(1)) {
    case "n": return "\n";
    case "r": return "\r";
    case "t": return "\t";
    case "0": return "\0";
    case "\\": return "\\";
    case "'": return "'";
    case "\"": return "\"";
    default: throw new Error(`Rust character literal '${value}' has an unsupported escape.`);
  }
}

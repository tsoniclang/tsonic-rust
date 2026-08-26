import {
  canonicalCompilerTypePathKey,
  canonicalPathKey,
  genericParameterMap,
  normalizeGenerics,
  normalizeRustCompilerBound,
  normalizeTraitReference,
  normalizeType,
  exactAssociatedTypeIdentity,
  substituteRustCompilerType,
  substituteRustCompilerGenerics,
  type RustCompilerNormalizationContext,
  type RustCompilerSubstitutions,
} from "../rustdoc-types.js";
import {
  compareText,
  hasInnerKind,
  isRecord,
  itemById,
  requireArray,
  requireInnerRecord,
  requireRecord,
  requireString,
  rustdocItemEffectiveStability,
  rustdocItemStability,
} from "../rustdoc-schema.js";
import {
  anonymousOwnedCompilerItemIdentity,
  canonicalCompilerItemIdentity,
  ownedCompilerItemIdentity,
  resolveRustdocItem,
} from "../rustdoc-items.js";
import {
  rustCompilerFunctionIsSourceAvailable,
  rustCompilerImplementationIdentityIsSourceAvailable,
} from "../source-availability.js";
import { associatedTypeKey, normalizeMemberType, substituteTraitReference } from "./associated-types.js";
import { normalizeFunction } from "./functions.js";
import type {
  RustCompilerAssociatedConstant,
  RustCompilerAssociatedType,
  RustCompilerConstExpression,
  RustCompilerDependency,
  RustCompilerEnumVariant,
  RustCompilerField,
  RustCompilerFunction,
  RustCompilerGenerics,
  RustCompilerImplementation,
  RustCompilerTraitReference,
  RustCompilerType,
  RustCompilerUnsupportedMember,
} from "../model.js";
import type { RustdocDocument } from "../rustdoc-schema.js";
import type { ResolvedRustdocItem, RustdocItemResolver } from "../rustdoc-items.js";

export function normalizeEnumVariants(
  document: RustdocDocument,
  enum_: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  context: RustCompilerNormalizationContext,
): {
  readonly values: readonly RustCompilerEnumVariant[];
  readonly unsupported: readonly RustCompilerUnsupportedMember[];
} {
  const values: RustCompilerEnumVariant[] = [];
  const unsupported: RustCompilerUnsupportedMember[] = [];
  for (const variantId of requireArray(enum_.variants, "Rust enum variants")) {
    const item = itemById(document, variantId);
    if (rustdocItemStability(item) === "unstable") continue;
    const name = requireString(item.name, "Rust enum variant name");
    try {
      const identity = ownedCompilerItemIdentity(dependency, context.owner, item);
      const variant = requireInnerRecord(item, "variant", `Rust enum variant '${name}'`);
      const fields = normalizeVariantFields(
        document,
        variant.kind,
        dependency,
        { ...context, owner: identity },
        name,
      );
      const discriminant = normalizeDiscriminant(variant.discriminant, identity);
      values.push(Object.freeze({
        identity,
        name,
        fields,
        ...(discriminant === undefined ? {} : { discriminant }),
      }));
    } catch (error) {
      unsupported.push(Object.freeze({
        kind: "variant",
        name,
        reason: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  return sortedResult(values, unsupported);
}

export function normalizeFields(
  document: RustdocDocument,
  struct: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  context: RustCompilerNormalizationContext,
): {
  readonly values: readonly RustCompilerField[];
  readonly unsupported: readonly RustCompilerUnsupportedMember[];
} {
  if (struct.kind === "unit") return { values: Object.freeze([]), unsupported: Object.freeze([]) };
  const kind = requireRecord(struct.kind, "Rust struct kind");
  if (Array.isArray(kind.tuple)) {
    return normalizePublicFields(document, kind.tuple, dependency, "struct", context, false);
  }
  const plain = requireRecord(kind.plain, "Rust named struct fields");
  return normalizePublicFields(
    document,
    requireArray(plain.fields, "Rust struct fields"),
    dependency,
    "struct",
    context,
    true,
  );
}

export function normalizePublicFields(
  document: RustdocDocument,
  fieldIds: readonly unknown[],
  dependency: RustCompilerDependency,
  ownerKind: "struct" | "union" | "variant",
  context: RustCompilerNormalizationContext,
  requirePublic: boolean,
): {
  readonly values: readonly RustCompilerField[];
  readonly unsupported: readonly RustCompilerUnsupportedMember[];
} {
  const fields: RustCompilerField[] = [];
  const unsupported: RustCompilerUnsupportedMember[] = [];
  for (let index = 0; index < fieldIds.length; index += 1) {
    const fieldId = fieldIds[index];
    if (fieldId === null) continue;
    const item = itemById(document, fieldId);
    if (rustdocItemStability(item) === "unstable") continue;
    if (requirePublic && item.visibility !== "public") continue;
    const diagnosticName = typeof item.name === "string" ? item.name : String(index);
    try {
      const inner = requireInnerRecord(item, "struct_field", `Rust ${ownerKind} field`);
      const identity = typeof item.name === "string"
        ? ownedCompilerItemIdentity(dependency, context.owner, item)
        : anonymousOwnedCompilerItemIdentity(dependency, context.owner, item, `${ownerKind}-field-${index}`);
      fields.push(Object.freeze({
        identity,
        name: typeof item.name === "string" ? item.name : String(index),
        type: normalizeType(document, inner, { ...context, position: `${ownerKind}-field-${index}` }),
      }));
    } catch (error) {
      unsupported.push(Object.freeze({
        kind: "field",
        name: diagnosticName,
        reason: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  return sortedResult(fields, unsupported);
}

export function normalizeTypeMembers(
  document: RustdocDocument,
  owner: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  declaredGenerics: RustCompilerGenerics,
  ownerIdentity: import("../model.js").RustCompilerItemIdentity,
  ownerCanonicalPath: readonly string[],
  resolveItem?: RustdocItemResolver,
): {
  readonly methods: readonly RustCompilerFunction[];
  readonly associatedConstants: readonly RustCompilerAssociatedConstant[];
  readonly associatedTypes: readonly RustCompilerAssociatedType[];
  readonly unsupported: readonly RustCompilerUnsupportedMember[];
  readonly implementations: readonly RustCompilerImplementation[];
} {
  const methods: RustCompilerFunction[] = [];
  const associatedConstants: RustCompilerAssociatedConstant[] = [];
  const associatedTypes: RustCompilerAssociatedType[] = [];
  const unsupported: RustCompilerUnsupportedMember[] = [];
  const implementations: RustCompilerImplementation[] = [];
  for (const implId of requireArray(owner.impls, "Rust type implementations")) {
    const implItem = itemById(document, implId);
    if (rustdocItemEffectiveStability(document, implItem) === "unstable") continue;
    const impl = requireInnerRecord(implItem, "impl", "Rust type implementation");
    const negative = impl.is_negative === true;
    try {
      const traitDeclaration = resolveImplementationTrait(
        document,
        dependency,
        impl,
        resolveItem,
      );
      if (traitDeclaration !== undefined &&
        rustdocItemEffectiveStability(traitDeclaration.document, traitDeclaration.item) === "unstable") continue;
      const implIdentity = anonymousOwnedCompilerItemIdentity(
        dependency,
        ownerIdentity,
        implItem,
        "impl",
      );
      const implGenerics = normalizeGenerics(document, requireRecord(impl.generics, "Rust impl generics"), {
        dependency,
        owner: implIdentity,
        ...(resolveItem === undefined ? {} : { resolveItem }),
      });
      const implContext: RustCompilerNormalizationContext = {
        dependency,
        owner: implIdentity,
        parameters: implementationNormalizationParameters(
          document,
          impl,
          implGenerics,
          declaredGenerics,
          ownerCanonicalPath,
        ),
        ...(resolveItem === undefined ? {} : { resolveItem }),
      };
      const target = normalizeType(document, impl.for, { ...implContext, position: "impl-target" });
      const rawTrait = isRecord(impl.trait)
        ? normalizeTraitReference(document, impl.trait, { ...implContext, selfType: target })
        : undefined;
      if (!rustCompilerImplementationIdentityIsSourceAvailable(
        document,
        dependency,
        target,
        rawTrait,
        resolveItem,
      )) continue;
      const normalizedImplementation = normalizeImplementationMembers(
        document,
        impl,
        dependency,
        implGenerics,
        implContext,
        rawTrait,
        implIdentity,
        target,
        traitDeclaration,
      );
      implementations.push(Object.freeze({
        identity: implIdentity,
        generics: implGenerics,
        target,
        ...(rawTrait === undefined ? {} : { trait: rawTrait }),
        polarity: negative ? "negative" : "positive",
        safety: impl.is_unsafe === true ? "unsafe" : "safe",
        methods: normalizedImplementation.methods,
        associatedConstants: normalizedImplementation.associatedConstants,
        associatedTypes: normalizedImplementation.associatedTypes,
        unsupportedMembers: normalizedImplementation.unsupported,
      }));
      if (negative || target.kind !== "path" ||
        canonicalCompilerTypePathKey(target) !== canonicalPathKey(ownerCanonicalPath)) continue;
      const substitutions = implementationSubstitutions(target, declaredGenerics);
      const enclosingGenerics = residualImplementationGenerics(implGenerics, substitutions);
      const trait = rawTrait === undefined ? undefined : substituteTraitReference(rawTrait, substitutions);
      const associatedBindings = normalizeAssociatedTypeBindings(
        document,
        impl,
        implContext,
        substitutions,
        trait,
        traitDeclaration,
      );
      for (const memberId of requireArray(impl.items, "Rust impl items")) {
        const item = itemById(document, memberId);
        if (!implementationMemberIsSourceAvailable(document, item, traitDeclaration)) continue;
        if (trait === undefined && item.visibility !== "public") continue;
        const name = typeof item.name === "string" ? item.name : `<member:${String(memberId)}>`;
        try {
          if (hasInnerKind(item, "function")) {
            const method = normalizeFunction(document, item, dependency, true, {
              outerGenerics: implGenerics,
              outerParameters: implContext.parameters,
              enclosingGenerics,
              substitutions,
              selfType: substituteRustCompilerType(target, substitutions),
              associatedTypeBindings: associatedBindings,
              memberOwner: implIdentity,
              ...(resolveItem === undefined ? {} : { resolveItem }),
              ...(trait === undefined ? {} : { traitDispatch: trait }),
            });
            if (rustCompilerFunctionIsSourceAvailable(document, dependency, method, resolveItem)) {
              methods.push(method);
            }
          } else if (hasInnerKind(item, "assoc_const")) {
            const constant = requireInnerRecord(item, "assoc_const", `Rust associated constant '${name}'`);
            associatedConstants.push(Object.freeze({
              identity: ownedCompilerItemIdentity(dependency, implIdentity, item),
              name: requireString(item.name, "Rust associated constant name"),
              type: normalizeMemberType(
                substituteRustCompilerType(
                  normalizeType(document, constant.type, { ...implContext, position: `associated-constant:${name}` }),
                  substitutions,
                ),
                associatedBindings,
                trait,
              ),
              ...(trait === undefined ? {} : { traitDispatch: trait }),
              generics: enclosingGenerics,
            }));
          } else if (hasInnerKind(item, "assoc_type")) {
            associatedTypes.push(normalizeAssociatedType(
              document,
              item,
              dependency,
              implContext,
              substitutions,
              implIdentity,
            ));
          }
        } catch (error) {
          unsupported.push(Object.freeze({
            kind: hasInnerKind(item, "assoc_const")
              ? "associated-constant"
              : hasInnerKind(item, "assoc_type")
                ? "associated-type"
                : "method",
            name,
            reason: error instanceof Error ? error.message : String(error),
          }));
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const memberId of requireArray(impl.items, "Rust impl items")) {
        const item = itemById(document, memberId);
        const traitDeclaration = resolveImplementationTrait(document, dependency, impl, resolveItem);
        if (!implementationMemberIsSourceAvailable(document, item, traitDeclaration)) continue;
        const kind = hasInnerKind(item, "assoc_const")
          ? "associated-constant" as const
          : hasInnerKind(item, "assoc_type")
            ? "associated-type" as const
            : "method" as const;
        unsupported.push(Object.freeze({
          kind,
          name: typeof item.name === "string" ? item.name : `<member:${String(memberId)}>`,
          reason,
        }));
      }
    }
  }
  return Object.freeze({
    methods: Object.freeze(methods.sort(compareIdentifiedNames)),
    associatedConstants: Object.freeze(associatedConstants.sort(compareIdentifiedNames)),
    associatedTypes: Object.freeze(associatedTypes.sort(compareIdentifiedNames)),
    unsupported: Object.freeze(unsupported.sort((left, right) =>
      compareText(`${left.kind}\0${left.name}`, `${right.kind}\0${right.name}`))),
    implementations: Object.freeze(implementations.sort((left, right) =>
      compareText(left.identity.itemId, right.identity.itemId))),
  });
}

export function normalizeTraitItems(
  document: RustdocDocument,
  trait: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  generics: RustCompilerGenerics,
  context: RustCompilerNormalizationContext,
  traitReference: RustCompilerTraitReference,
): ReturnType<typeof normalizeTypeMembers> {
  const methods: RustCompilerFunction[] = [];
  const associatedConstants: RustCompilerAssociatedConstant[] = [];
  const associatedTypes: RustCompilerAssociatedType[] = [];
  const unsupported: RustCompilerUnsupportedMember[] = [];
  for (const itemId of requireArray(trait.items, "Rust trait items")) {
    const item = itemById(document, itemId);
    if (rustdocItemStability(item) === "unstable") continue;
    const name = typeof item.name === "string" ? item.name : `<trait-item:${String(itemId)}>`;
    try {
      if (hasInnerKind(item, "function")) {
        const method = normalizeFunction(document, item, dependency, true, {
          outerGenerics: generics,
          outerParameters: context.parameters,
          enclosingGenerics: Object.freeze({
            parameters: Object.freeze([]),
            wherePredicates: Object.freeze([]),
          }),
          traitDispatch: traitReference,
          selfType: Object.freeze({ kind: "self", owner: traitReference.identity }),
          memberOwner: traitReference.identity,
          ...(context.resolveItem === undefined ? {} : { resolveItem: context.resolveItem }),
        });
        if (rustCompilerFunctionIsSourceAvailable(
          document,
          dependency,
          method,
          context.resolveItem,
        )) methods.push(method);
      } else if (hasInnerKind(item, "assoc_const")) {
        const constant = requireInnerRecord(item, "assoc_const", `Rust trait constant '${name}'`);
        associatedConstants.push(Object.freeze({
          identity: ownedCompilerItemIdentity(dependency, traitReference.identity, item),
          name: requireString(item.name, "Rust trait constant name"),
          type: normalizeType(document, constant.type, { ...context, position: `trait-constant:${name}` }),
          traitDispatch: traitReference,
          generics,
        }));
      } else if (hasInnerKind(item, "assoc_type")) {
        associatedTypes.push(normalizeAssociatedType(
          document,
          item,
          dependency,
          context,
          emptySubstitutions(),
          traitReference.identity,
        ));
      }
    } catch (error) {
      unsupported.push(Object.freeze({
        kind: hasInnerKind(item, "assoc_const")
          ? "associated-constant"
          : hasInnerKind(item, "assoc_type")
            ? "associated-type"
            : "method",
        name,
        reason: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  return Object.freeze({
    methods: Object.freeze(methods.sort(compareIdentifiedNames)),
    associatedConstants: Object.freeze(associatedConstants.sort(compareIdentifiedNames)),
    associatedTypes: Object.freeze(associatedTypes.sort(compareIdentifiedNames)),
    unsupported: Object.freeze(unsupported.sort((left, right) => compareText(left.name, right.name))),
    implementations: Object.freeze([]),
  });
}

function normalizeImplementationMembers(
  document: RustdocDocument,
  impl: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  generics: RustCompilerGenerics,
  context: RustCompilerNormalizationContext,
  trait: RustCompilerTraitReference | undefined,
  implementationIdentity: import("../model.js").RustCompilerItemIdentity,
  selfType: RustCompilerType,
  traitDeclaration: ResolvedRustdocItem | undefined,
): {
  readonly methods: readonly RustCompilerFunction[];
  readonly associatedConstants: readonly RustCompilerAssociatedConstant[];
  readonly associatedTypes: readonly RustCompilerAssociatedType[];
  readonly unsupported: readonly RustCompilerUnsupportedMember[];
} {
  const methods: RustCompilerFunction[] = [];
  const associatedConstants: RustCompilerAssociatedConstant[] = [];
  const associatedTypes: RustCompilerAssociatedType[] = [];
  const unsupported: RustCompilerUnsupportedMember[] = [];
  for (const memberId of requireArray(impl.items, "Rust implementation items")) {
    const item = itemById(document, memberId);
    if (!implementationMemberIsSourceAvailable(document, item, traitDeclaration)) continue;
    if (trait === undefined && item.visibility !== "public") continue;
    const name = typeof item.name === "string" ? item.name : `<member:${String(memberId)}>`;
    try {
      if (hasInnerKind(item, "function")) {
        const method = normalizeFunction(document, item, dependency, true, {
          outerGenerics: generics,
          outerParameters: context.parameters,
          selfType,
          memberOwner: implementationIdentity,
          ...(context.resolveItem === undefined ? {} : { resolveItem: context.resolveItem }),
          ...(trait === undefined ? {} : { traitDispatch: trait }),
        });
        if (rustCompilerFunctionIsSourceAvailable(
          document,
          dependency,
          method,
          context.resolveItem,
        )) methods.push(method);
      } else if (hasInnerKind(item, "assoc_const")) {
        const constant = requireInnerRecord(item, "assoc_const", `Rust associated constant '${name}'`);
        associatedConstants.push(Object.freeze({
          identity: ownedCompilerItemIdentity(dependency, implementationIdentity, item),
          name: requireString(item.name, "Rust associated constant name"),
          type: normalizeType(document, constant.type, {
            ...context,
            position: `implementation-associated-constant:${name}`,
          }),
          ...(trait === undefined ? {} : { traitDispatch: trait }),
          generics,
        }));
      } else if (hasInnerKind(item, "assoc_type")) {
        associatedTypes.push(normalizeAssociatedType(
          document,
          item,
          dependency,
          context,
          emptySubstitutions(),
          implementationIdentity,
        ));
      }
    } catch (error) {
      unsupported.push(Object.freeze({
        kind: hasInnerKind(item, "assoc_const")
          ? "associated-constant"
          : hasInnerKind(item, "assoc_type")
            ? "associated-type"
            : "method",
        name,
        reason: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  return Object.freeze({
    methods: Object.freeze(methods.sort(compareIdentifiedNames)),
    associatedConstants: Object.freeze(associatedConstants.sort(compareIdentifiedNames)),
    associatedTypes: Object.freeze(associatedTypes.sort(compareIdentifiedNames)),
    unsupported: Object.freeze(unsupported.sort((left, right) =>
      compareText(`${left.kind}\0${left.name}`, `${right.kind}\0${right.name}`))),
  });
}

function normalizeVariantFields(
  document: RustdocDocument,
  rawKind: unknown,
  dependency: RustCompilerDependency,
  context: RustCompilerNormalizationContext,
  variantName: string,
): RustCompilerEnumVariant["fields"] {
  if (rawKind === "plain") return Object.freeze({ kind: "unit" });
  const kind = requireRecord(rawKind, `Rust enum variant '${variantName}' kind`);
  if (Array.isArray(kind.tuple)) {
    const fields = normalizePublicFields(document, kind.tuple, dependency, "variant", context, false);
    if (fields.unsupported.length > 0) throw new Error(fields.unsupported.map((entry) => entry.reason).join("; "));
    return Object.freeze({ kind: "tuple", fields: fields.values });
  }
  const struct = requireRecord(kind.struct, `Rust struct variant '${variantName}'`);
  const fields = normalizePublicFields(
    document,
    requireArray(struct.fields, `Rust struct variant '${variantName}' fields`),
    dependency,
    "variant",
    context,
    false,
  );
  if (fields.unsupported.length > 0) throw new Error(fields.unsupported.map((entry) => entry.reason).join("; "));
  return Object.freeze({ kind: "struct", fields: fields.values });
}

function normalizeDiscriminant(
  raw: unknown,
  identity: import("../model.js").RustCompilerItemIdentity,
): RustCompilerConstExpression | undefined {
  if (raw === null || raw === undefined) return undefined;
  const discriminant = requireRecord(raw, "Rust enum discriminant");
  if (typeof discriminant.value === "string" && rustIntegerDiscriminantPattern.test(discriminant.value)) {
    return Object.freeze({ kind: "literal", literalKind: "integer", value: BigInt(discriminant.value.split("_").join("")) });
  }
  if (typeof discriminant.expr === "string" && rustIntegerDiscriminantPattern.test(discriminant.expr)) {
    return Object.freeze({ kind: "literal", literalKind: "integer", value: BigInt(discriminant.expr.split("_").join("")) });
  }
  throw new Error(`Rust enum discriminant '${identity.itemId}' is not structurally representable.`);
}

const rustIntegerDiscriminantPattern = /^(?:0|-?[1-9][0-9_]*)$/u;

function implementationSubstitutions(
  target: Extract<RustCompilerType, { readonly kind: "path" }>,
  declaredGenerics: RustCompilerGenerics,
): RustCompilerSubstitutions {
  if (target.arguments.length > declaredGenerics.parameters.length) {
    throw new Error("Rust implementation target has more generic arguments than its declaration.");
  }
  const types = new Map<string, RustCompilerType>();
  const lifetimes = new Map<string, import("../model.js").RustCompilerLifetime>();
  const consts = new Map<string, RustCompilerConstExpression>();
  for (let index = 0; index < target.arguments.length; index += 1) {
    const argument = target.arguments[index]!;
    const declared = declaredGenerics.parameters[index];
    if (declared === undefined || argument.kind !== declared.kind) {
      throw new Error(`Rust implementation generic argument ${index} does not match the declaration kind.`);
    }
    if (argument.kind === "type" && argument.value.kind === "type-parameter" &&
      declared.kind === "type") {
      types.set(argument.value.identity.itemId, Object.freeze({
        kind: "type-parameter",
        identity: declared.identity,
        displayName: declared.kind === "type" ? declared.displayName : `T${index}`,
      }));
    } else if (argument.kind === "lifetime" && argument.value.kind === "parameter" && declared.kind === "lifetime") {
      lifetimes.set(argument.value.identity.itemId, declared.identity);
    } else if (argument.kind === "const" && argument.value.kind === "parameter" && declared.kind === "const") {
      consts.set(argument.value.identity.itemId, Object.freeze({
        kind: "parameter",
        identity: declared.identity,
        displayName: declared.displayName,
      }));
    }
  }
  return Object.freeze({ types, lifetimes, consts });
}

function normalizeAssociatedTypeBindings(
  document: RustdocDocument,
  impl: Readonly<Record<string, unknown>>,
  context: RustCompilerNormalizationContext,
  substitutions: RustCompilerSubstitutions,
  trait: RustCompilerTraitReference | undefined,
  traitDeclaration?: ResolvedRustdocItem,
): ReadonlyMap<string, RustCompilerType> {
  const bindings = new Map<string, RustCompilerType>();
  if (trait === undefined) return bindings;
  for (const itemId of requireArray(impl.items, "Rust trait implementation items")) {
    const item = itemById(document, itemId);
    if (!implementationMemberIsSourceAvailable(document, item, traitDeclaration)) continue;
    if (!hasInnerKind(item, "assoc_type")) continue;
    const associated = requireInnerRecord(item, "assoc_type", "Rust associated type implementation");
    if (associated.type === null || associated.type === undefined) continue;
    const name = requireString(item.name, "Rust associated type implementation name");
    const identity = exactAssociatedTypeIdentity(
      document,
      trait.identity,
      name,
      context,
    );
    const type = substituteRustCompilerType(
      normalizeType(document, associated.type, { ...context, position: `associated-binding:${String(item.name)}` }),
      substitutions,
    );
    bindings.set(associatedTypeKey(trait, identity.itemId), type);
  }
  return bindings;
}

function resolveImplementationTrait(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  impl: Readonly<Record<string, unknown>>,
  resolveItem?: RustdocItemResolver,
): ResolvedRustdocItem | undefined {
  if (!isRecord(impl.trait)) return undefined;
  return resolveRustdocItem(document, dependency, impl.trait.id, resolveItem);
}

function implementationMemberIsSourceAvailable(
  document: RustdocDocument,
  item: Readonly<Record<string, unknown>>,
  traitDeclaration: ResolvedRustdocItem | undefined,
): boolean {
  if (rustdocItemEffectiveStability(document, item) === "unstable") return false;
  if (traitDeclaration === undefined) return true;
  const name = requireString(item.name, "Rust trait implementation member name");
  const kind = implementationMemberKind(item);
  const trait = requireInnerRecord(traitDeclaration.item, "trait", "Rust implementation trait");
  const matches = requireArray(trait.items, "Rust implementation trait items")
    .map((id) => itemById(traitDeclaration.document, id))
    .filter((candidate) => candidate.name === name && implementationMemberKind(candidate) === kind);
  if (matches.length !== 1) {
    throw new Error(`Rust trait implementation member '${name}' has ${matches.length} exact trait declarations.`);
  }
  return rustdocItemEffectiveStability(traitDeclaration.document, matches[0]!) !== "unstable";
}

function implementationMemberKind(
  item: Readonly<Record<string, unknown>>,
): "function" | "associated-constant" | "associated-type" | "other" {
  if (hasInnerKind(item, "function")) return "function";
  if (hasInnerKind(item, "assoc_const")) return "associated-constant";
  if (hasInnerKind(item, "assoc_type")) return "associated-type";
  return "other";
}


function normalizeAssociatedType(
  document: RustdocDocument,
  item: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  context: RustCompilerNormalizationContext,
  substitutions: RustCompilerSubstitutions,
  ownerIdentity?: import("../model.js").RustCompilerItemIdentity,
): RustCompilerAssociatedType {
  const name = requireString(item.name, "Rust associated type name");
  const identity = ownerIdentity === undefined
    ? canonicalCompilerItemIdentity(document, dependency, item)
    : ownedCompilerItemIdentity(dependency, ownerIdentity, item);
  const associated = requireInnerRecord(item, "assoc_type", `Rust associated type '${name}'`);
  const generics = normalizeGenerics(document, requireRecord(associated.generics, `${name}.generics`), {
    dependency,
    owner: identity,
    parameters: context.parameters,
    ...(context.resolveItem === undefined ? {} : { resolveItem: context.resolveItem }),
  });
  const normalizedContext = {
    ...context,
    owner: identity,
    parameters: new Map([
      ...context.parameters ?? [],
      ...genericParameterMap(generics),
    ]),
  };
  const bounds = requireArray(associated.bounds, `Rust associated type '${name}' bounds`).map((raw, index) =>
    normalizeRustCompilerBound(
      document,
      raw,
      { ...normalizedContext, position: `bound-${index}` },
    ));
  return Object.freeze({
    identity,
    name,
    generics,
    bounds: Object.freeze(bounds),
    ...(associated.type === null || associated.type === undefined
      ? {}
      : { defaultType: substituteRustCompilerType(normalizeType(document, associated.type, normalizedContext), substitutions) }),
  });
}

function emptySubstitutions(): RustCompilerSubstitutions {
  return Object.freeze({ types: new Map(), lifetimes: new Map(), consts: new Map() });
}

function residualImplementationGenerics(
  generics: RustCompilerGenerics,
  substitutions: RustCompilerSubstitutions,
): RustCompilerGenerics {
  return substituteRustCompilerGenerics(Object.freeze({
    parameters: Object.freeze(generics.parameters.filter((parameter) =>
      !implementationParameterIsSubstituted(parameter, substitutions))),
    wherePredicates: generics.wherePredicates,
  }), substitutions);
}

function implementationNormalizationParameters(
  document: RustdocDocument,
  impl: Readonly<Record<string, unknown>>,
  implementationGenerics: RustCompilerGenerics,
  declaredGenerics: RustCompilerGenerics,
  ownerCanonicalPath: readonly string[],
): ReadonlyMap<string, import("../model.js").RustCompilerGenericParameter> {
  const parameters = new Map(genericParameterMap(implementationGenerics));
  const target = requireRecord(impl.for, "Rust implementation target");
  if (!isRecord(target.resolved_path)) return parameters;
  const rawPath = document.paths[String(target.resolved_path.id)];
  if (!isRecord(rawPath) || !Array.isArray(rawPath.path) ||
    !rawPath.path.every((segment) => typeof segment === "string") ||
    canonicalPathKey(rawPath.path as string[]) !== canonicalPathKey(ownerCanonicalPath)) return parameters;
  const arguments_ = target.resolved_path.args;
  if (!isRecord(arguments_) || !isRecord(arguments_.angle_bracketed)) return parameters;
  const rawArguments = requireArray(
    arguments_.angle_bracketed.args,
    "Rust implementation target arguments",
  );
  if (rawArguments.length > declaredGenerics.parameters.length) {
    throw new Error("Rust implementation target has more arguments than its owner declaration.");
  }
  for (let index = 0; index < rawArguments.length; index += 1) {
    const declared = declaredGenerics.parameters[index];
    if (declared === undefined) continue;
    const name = implementationArgumentParameterName(rawArguments[index], declared.kind);
    if (name === undefined) continue;
    const existing = parameters.get(name);
    if (existing !== undefined) {
      if (existing.kind !== declared.kind) {
        throw new Error(`Rust implementation parameter '${name}' conflicts with owner slot ${index}.`);
      }
      continue;
    }
    parameters.set(name, declared);
  }
  return parameters;
}

function implementationArgumentParameterName(
  raw: unknown,
  kind: import("../model.js").RustCompilerGenericParameter["kind"],
): string | undefined {
  const argument = requireRecord(raw, "Rust implementation generic argument");
  if (kind === "lifetime") {
    return typeof argument.lifetime === "string" &&
      argument.lifetime !== "'static" && argument.lifetime !== "'_"
      ? argument.lifetime.replace(/^'/u, "")
      : undefined;
  }
  if (kind === "type" && isRecord(argument.type) &&
    typeof argument.type.generic === "string") {
    return argument.type.generic;
  }
  if (kind === "const" && isRecord(argument.const) &&
    typeof argument.const.expr === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(argument.const.expr)) {
    return argument.const.expr;
  }
  return undefined;
}

function implementationParameterIsSubstituted(
  parameter: import("../model.js").RustCompilerGenericParameter,
  substitutions: RustCompilerSubstitutions,
): boolean {
  if (parameter.kind === "type") return substitutions.types.has(parameter.identity.itemId);
  if (parameter.kind === "const") return substitutions.consts.has(parameter.identity.itemId);
  return parameter.identity.kind === "parameter" &&
    substitutions.lifetimes.has(parameter.identity.identity.itemId);
}

function compareIdentifiedNames(
  left: { readonly name: string; readonly identity: { readonly itemId: string } },
  right: { readonly name: string; readonly identity: { readonly itemId: string } },
): number {
  return compareText(`${left.name}\0${left.identity.itemId}`, `${right.name}\0${right.identity.itemId}`);
}

function sortedResult<T extends { readonly name: string }>(
  values: T[],
  unsupported: RustCompilerUnsupportedMember[],
): { readonly values: readonly T[]; readonly unsupported: readonly RustCompilerUnsupportedMember[] } {
  return Object.freeze({
    values: Object.freeze(values.sort((left, right) => compareText(left.name, right.name))),
    unsupported: Object.freeze(unsupported.sort((left, right) => compareText(left.name, right.name))),
  });
}

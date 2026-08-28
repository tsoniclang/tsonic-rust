import {
  compareText,
  hasInnerKind,
  isRecord,
  itemById,
  requireArray,
  requireInnerRecord,
  requireRecord,
  requireString,
} from "../rustdoc-schema.js";
import {
  childNormalizationContext,
  derivedNormalizationContext,
  directImplementationGenericParameterPositions,
  emptyRustCompilerSubstitutions,
  normalizeGenericParameters,
  normalizeTraitDispatch,
  normalizeType,
  normalizeTypeBounds,
  rustCompilerDerivedIdentity,
  rustCompilerNestedItemIdentity,
  substituteRustCompilerTrait,
} from "../rustdoc-types.js";
import {
  associatedTypeKey,
  normalizeMemberType,
  sourceImplementationRequirements,
} from "./associated-types.js";
import { canonicalItemId } from "../rustdoc-items.js";
import { normalizeFunction } from "./functions.js";
import type {
  RustCompilerAssociatedConstant,
  RustCompilerAssociatedType,
  RustCompilerConstArgument,
  RustCompilerDependency,
  RustCompilerEnumVariant,
  RustCompilerField,
  RustCompilerFunction,
  RustCompilerGenericParameter,
  RustCompilerItemIdentity,
  RustCompilerLifetime,
  RustCompilerTraitDispatch,
  RustCompilerType,
  RustCompilerTypeParameter,
  RustCompilerUnsupportedMember,
} from "../model.js";
import type { RustdocItemResolver } from "../rustdoc-items.js";
import type { RustdocDocument } from "../rustdoc-schema.js";
import type {
  RustCompilerNormalizationContext,
  RustCompilerSubstitutions,
} from "../rustdoc-types.js";

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
  for (const [variantIndex, variantId] of requireArray(enum_.variants, "Rust enum variants").entries()) {
    const item = itemById(document, variantId);
    const name = requireString(item.name, "Rust enum variant name");
    try {
      const variant = requireInnerRecord(item, "variant", `Rust enum variant '${name}'`);
      if (variant.kind === "plain") {
        values.push(Object.freeze({
          kind: "plain" as const,
          id: canonicalItemId(dependency, item),
          name,
          fields: Object.freeze([]),
        }));
        continue;
      }
      const kind = requireRecord(variant.kind, `Rust enum variant '${name}' kind`);
      if (Array.isArray(kind.tuple)) {
        const fields = kind.tuple.map((fieldId, fieldIndex) => {
          const field = itemById(document, fieldId);
          return normalizeMemberType(
            document,
            requireInnerRecord(field, "struct_field", `Rust enum variant '${name}' field`),
            childNormalizationContext(context, `variant:${variantIndex}:field:${fieldIndex}`),
            emptyRustCompilerSubstitutions,
            new Map(),
            undefined,
          );
        });
        values.push(Object.freeze({
          kind: "tuple" as const,
          id: canonicalItemId(dependency, item),
          name,
          fields: Object.freeze(fields),
        }));
        continue;
      }
      const struct = requireRecord(kind.struct, `Rust enum variant '${name}' struct payload`);
      if (struct.has_stripped_fields === true) {
        throw new Error(`Rust enum variant '${name}' has stripped struct fields.`);
      }
      const fields = requireArray(struct.fields, `Rust enum variant '${name}' struct fields`).map((fieldId, fieldIndex) => {
        const field = itemById(document, fieldId);
        return Object.freeze({
          id: canonicalItemId(dependency, field),
          name: requireString(field.name, `Rust enum variant '${name}' field name`),
          type: normalizeMemberType(
            document,
            requireInnerRecord(field, "struct_field", `Rust enum variant '${name}' field`),
            childNormalizationContext(context, `variant:${variantIndex}:field:${fieldIndex}`),
            emptyRustCompilerSubstitutions,
            new Map(),
            undefined,
          ),
        });
      });
      values.push(Object.freeze({
        kind: "struct" as const,
        id: canonicalItemId(dependency, item),
        name,
        fields: Object.freeze(fields),
      }));
    } catch (error) {
      unsupported.push(Object.freeze({
        kind: "variant",
        name,
        reason: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  return {
    values: Object.freeze(values.sort((left, right) => compareText(left.name, right.name))),
    unsupported: Object.freeze(unsupported.sort((left, right) => compareText(left.name, right.name))),
  };
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
  if (struct.kind === "unit") {
    return { values: Object.freeze([]), unsupported: Object.freeze([]) };
  }
  const kind = requireRecord(struct.kind, "Rust struct kind");
  const plain = isRecord(kind.plain) ? kind.plain : undefined;
  if (plain === undefined) {
    return { values: Object.freeze([]), unsupported: Object.freeze([]) };
  }
  return normalizePublicFields(
    document,
    requireArray(plain.fields, "Rust struct fields"),
    dependency,
    "struct",
    context,
  );
}

export function normalizePublicFields(
  document: RustdocDocument,
  fieldIds: readonly unknown[],
  dependency: RustCompilerDependency,
  ownerKind: "struct" | "union",
  context: RustCompilerNormalizationContext,
): {
  readonly values: readonly RustCompilerField[];
  readonly unsupported: readonly RustCompilerUnsupportedMember[];
} {
  const fields: RustCompilerField[] = [];
  const unsupported: RustCompilerUnsupportedMember[] = [];
  for (const [fieldIndex, id] of fieldIds.entries()) {
    const item = itemById(document, id);
    if (item.visibility !== "public") continue;
    const name = typeof item.name === "string" ? item.name : `<field:${String(id)}>`;
    try {
      const inner = requireInnerRecord(item, "struct_field", `Rust ${ownerKind} field`);
      fields.push(Object.freeze({
        id: canonicalItemId(dependency, item),
        name: requireString(item.name, "Rust field name"),
        type: normalizeMemberType(
          document,
          inner,
          childNormalizationContext(context, `field:${fieldIndex}`),
          emptyRustCompilerSubstitutions,
          new Map(),
          undefined,
        ),
      }));
    } catch (error) {
      unsupported.push(Object.freeze({
        kind: "field",
        name,
        reason: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  return {
    values: Object.freeze(fields.sort((left, right) => compareText(left.name, right.name))),
    unsupported: Object.freeze(unsupported.sort((left, right) => compareText(left.name, right.name))),
  };
}

export function normalizeTypeMembers(
  document: RustdocDocument,
  owner: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  declaredGenericParameters: readonly RustCompilerGenericParameter[],
  ownerIdentity: RustCompilerItemIdentity,
  resolveItem?: RustdocItemResolver,
): {
  readonly methods: readonly RustCompilerFunction[];
  readonly associatedConstants: readonly RustCompilerAssociatedConstant[];
  readonly unsupported: readonly RustCompilerUnsupportedMember[];
} {
  const methods: RustCompilerFunction[] = [];
  const associatedConstants: RustCompilerAssociatedConstant[] = [];
  const unsupported: RustCompilerUnsupportedMember[] = [];
  for (const implId of requireArray(owner.impls, "Rust type impls")) {
    const implItem = itemById(document, implId);
    const impl = requireInnerRecord(implItem, "impl", "Rust impl");
    if (impl.blanket_impl !== null || impl.is_negative === true || impl.is_synthetic === true) continue;
    const memberIds = requireArray(impl.items, "Rust impl items");
    try {
      const selected = normalizeImplementation(
        document,
        dependency,
        implItem,
        impl,
        declaredGenericParameters,
        ownerIdentity,
        resolveItem,
      );
      if (selected.kind === "not-public") continue;
      for (const memberId of memberIds) {
        const item = itemById(document, memberId);
        if (selected.traitDispatch === undefined && item.visibility !== "public") continue;
        const name = typeof item.name === "string" ? item.name : `<member:${String(memberId)}>`;
        if (hasInnerKind(item, "assoc_type")) continue;
        try {
          if (hasInnerKind(item, "function")) {
            methods.push(normalizeFunction(document, item, dependency, true, {
              inheritedGenericParameters: declaredGenericParameters,
              inheritedRequirements: selected.sourceRequirements,
              implementationBindings: selected.bindings,
              associatedTypeBindings: selected.associatedTypeBindings,
              ...(selected.traitDispatch === undefined ? {} : { traitDispatch: selected.traitDispatch }),
              selfOwner: ownerIdentity,
              declarationIdentity: rustCompilerNestedItemIdentity(
                dependency,
                item,
                selected.context.owner,
              ),
              ...(resolveItem === undefined ? {} : { resolveItem }),
            }));
          } else if (selected.traitDispatch !== undefined && hasInnerKind(item, "assoc_const")) {
            const constant = requireInnerRecord(item, "assoc_const", `Rust associated constant '${name}'`);
            associatedConstants.push(Object.freeze({
              id: canonicalItemId(dependency, item),
              name: requireString(item.name, "Rust associated constant name"),
              type: normalizeMemberType(
                document,
                constant.type,
                childNormalizationContext(selected.context, `associated-constant:${String(item.id)}`),
                selected.bindings,
                selected.associatedTypeBindings,
                selected.traitDispatch,
              ),
              traitDispatch: selected.traitDispatch,
              typeRequirements: selected.sourceRequirements,
            }));
          }
        } catch (error) {
          unsupported.push(unsupportedMember(item, name, error));
        }
      }
    } catch (error) {
      for (const memberId of memberIds) {
        const item = itemById(document, memberId);
        if (hasInnerKind(item, "function") || hasInnerKind(item, "assoc_const")) {
          unsupported.push(unsupportedMember(
            item,
            typeof item.name === "string" ? item.name : `<member:${String(memberId)}>`,
            error,
          ));
        }
      }
    }
  }
  return {
    methods: Object.freeze(methods.sort((left, right) => compareText(
      `${left.name}\0${left.identity.itemId}`,
      `${right.name}\0${right.identity.itemId}`,
    ))),
    associatedConstants: Object.freeze(associatedConstants.sort((left, right) => compareText(
      `${left.name}\0${left.id}`,
      `${right.name}\0${right.id}`,
    ))),
    unsupported: Object.freeze(unsupported.sort((left, right) => compareText(left.name, right.name))),
  };
}

export function normalizeTraitMembers(
  document: RustdocDocument,
  trait: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  declaredGenericParameters: readonly RustCompilerGenericParameter[],
  ownerIdentity: RustCompilerItemIdentity,
  traitDispatch: RustCompilerTraitDispatch,
  context: RustCompilerNormalizationContext,
  resolveItem?: RustdocItemResolver,
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
  for (const itemId of requireArray(trait.items, "Rust trait items")) {
    const item = itemById(document, itemId);
    const name = typeof item.name === "string"
      ? item.name
      : `<trait-member:${String(itemId)}>`;
    try {
      if (hasInnerKind(item, "function")) {
        methods.push(normalizeFunction(document, item, dependency, true, {
          inheritedGenericParameters: declaredGenericParameters,
          traitDispatch,
          selfOwner: ownerIdentity,
          declarationIdentity: rustCompilerNestedItemIdentity(
            dependency,
            item,
            context.owner,
          ),
          ...(resolveItem === undefined ? {} : { resolveItem }),
        }));
        continue;
      }
      if (hasInnerKind(item, "assoc_const")) {
        const constant = requireInnerRecord(
          item,
          "assoc_const",
          `Rust trait associated constant '${name}'`,
        );
        associatedConstants.push(Object.freeze({
          id: canonicalItemId(dependency, item),
          name: requireString(item.name, "Rust trait associated constant name"),
          type: normalizeType(
            document,
            constant.type,
            childNormalizationContext(context, `associated-constant:${name}`),
          ),
          traitDispatch,
          typeRequirements: Object.freeze([]),
        }));
        continue;
      }
      if (hasInnerKind(item, "assoc_type")) {
        const associated = requireInnerRecord(
          item,
          "assoc_type",
          `Rust trait associated type '${name}'`,
        );
        const associatedContext = derivedNormalizationContext(
          context.dependency,
          traitDispatch.identity,
          `associated:${name}`,
          {
            ...(context.selfOwner === undefined ? {} : { selfOwner: context.selfOwner }),
            ...(context.resolveItem === undefined ? {} : { resolveItem: context.resolveItem }),
          },
        );
        const identity = associatedContext.owner;
        const generics = normalizeGenericParameters(
          document,
          requireRecord(associated.generics, `${name}.generics`),
          associatedContext,
        );
        const bounds = normalizeTypeBounds(
          document,
          requireArray(associated.bounds, `${name}.bounds`),
          generics.context,
        );
        associatedTypes.push(Object.freeze({
          identity,
          name: requireString(item.name, "Rust trait associated type name"),
          genericParameters: generics.parameters,
          requirements: bounds.requirements,
          outlives: bounds.outlives,
          maybeSized: bounds.maybeSized,
          ownerRequirements: generics.selfRequirements,
          ownerOutlives: generics.selfOutlives,
          ownerMaybeSized: generics.selfMaybeSized,
          ...(associated.type === null || associated.type === undefined
            ? {}
            : {
                defaultType: normalizeType(
                  document,
                  associated.type,
                  childNormalizationContext(generics.context, "default"),
                ),
              }),
        }));
        continue;
      }
      throw new Error(`Rust trait member '${name}' has no supported provider representation.`);
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
  return {
    methods: Object.freeze(methods.sort((left, right) => compareText(
      `${left.name}\0${left.identity.itemId}`,
      `${right.name}\0${right.identity.itemId}`,
    ))),
    associatedConstants: Object.freeze(associatedConstants.sort((left, right) =>
      compareText(`${left.name}\0${left.id}`, `${right.name}\0${right.id}`))),
    associatedTypes: Object.freeze(associatedTypes.sort((left, right) =>
      compareText(`${left.name}\0${left.identity.itemId}`, `${right.name}\0${right.identity.itemId}`))),
    unsupported: Object.freeze(unsupported.sort((left, right) =>
      compareText(`${left.kind}\0${left.name}`, `${right.kind}\0${right.name}`))),
  };
}

function normalizeImplementation(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  implItem: Readonly<Record<string, unknown>>,
  impl: Readonly<Record<string, unknown>>,
  declaredGenericParameters: readonly RustCompilerGenericParameter[],
  ownerIdentity: RustCompilerItemIdentity,
  resolveItem?: RustdocItemResolver,
): {
  readonly kind: "selected";
  readonly context: RustCompilerNormalizationContext;
  readonly bindings: RustCompilerSubstitutions;
  readonly sourceRequirements: readonly RustCompilerTypeParameter[];
  readonly associatedTypeBindings: ReadonlyMap<string, RustCompilerType>;
  readonly traitDispatch?: RustCompilerTraitDispatch;
} | { readonly kind: "not-public" } {
  if (impl.trait !== null && !traitIsPublic(document, dependency, impl.trait, resolveItem)) {
    return Object.freeze({ kind: "not-public" });
  }
  const context = derivedNormalizationContext(
    dependency,
    ownerIdentity,
    `impl:${String(implItem.id)}`,
    { selfOwner: ownerIdentity, ...(resolveItem === undefined ? {} : { resolveItem }) },
  );
  const generics = normalizeGenericParameters(
    document,
    requireRecord(impl.generics, "Rust impl generics"),
    context,
  );
  const positions = directImplementationGenericParameterPositions(
    document,
    impl,
    generics.context,
    declaredGenericParameters,
    ownerIdentity,
  );
  if (positions === undefined) {
    throw new Error("Rust impl does not project exactly onto the source-visible generic declaration.");
  }
  const bindings = implementationSubstitutions(generics.parameters, positions, declaredGenericParameters);
  const implementationTypeParameters = generics.parameters.filter(
    (parameter): parameter is RustCompilerTypeParameter => parameter.kind === "type",
  );
  const sourceRequirements = sourceImplementationRequirements(
    document,
    dependency,
    impl,
    implementationTypeParameters,
    generics.context,
    declaredGenericParameters,
    ownerIdentity,
    resolveItem,
  );
  if (sourceRequirements === undefined) {
    throw new Error("Rust impl requirements cannot be projected onto the source-visible type arguments.");
  }
  const traitDispatch = impl.trait === null
    ? undefined
    : substituteRustCompilerTrait(
        normalizeTraitDispatch(document, impl.trait, generics.context),
        bindings,
      );
  const associatedTypeBindings = traitDispatch === undefined
    ? new Map<string, RustCompilerType>()
    : normalizeAssociatedTypeBindings(
        document,
        impl,
        generics.context,
        traitDispatch,
        bindings,
      );
  return Object.freeze({
    kind: "selected",
    context: generics.context,
    bindings,
    sourceRequirements,
    associatedTypeBindings,
    ...(traitDispatch === undefined ? {} : { traitDispatch }),
  });
}

function implementationSubstitutions(
  implementationParameters: readonly RustCompilerGenericParameter[],
  positions: ReadonlyMap<string, number>,
  declaredParameters: readonly RustCompilerGenericParameter[],
): RustCompilerSubstitutions {
  const types = new Map<string, RustCompilerType>();
  const lifetimes = new Map<string, RustCompilerLifetime>();
  const consts = new Map<string, RustCompilerConstArgument>();
  for (const parameter of implementationParameters) {
    const identity = genericParameterIdentity(parameter);
    const position = positions.get(identity);
    const declared = position === undefined ? undefined : declaredParameters[position];
    if (declared === undefined || declared.kind !== parameter.kind) {
      throw new Error("Rust impl generic parameter is not an exact projection of its owning declaration.");
    }
    if (parameter.kind === "lifetime" && declared.kind === "lifetime") {
      lifetimes.set(identity, declared.lifetime);
    } else if (parameter.kind === "type" && declared.kind === "type") {
      types.set(identity, Object.freeze({ kind: "generic", identity: declared.identity, name: declared.name }));
    } else if (parameter.kind === "const" && declared.kind === "const") {
      consts.set(identity, Object.freeze({ kind: "parameter", identity: declared.identity, name: declared.name }));
    }
  }
  return Object.freeze({ types, lifetimes, consts });
}

function normalizeAssociatedTypeBindings(
  document: RustdocDocument,
  impl: Readonly<Record<string, unknown>>,
  context: RustCompilerNormalizationContext,
  traitDispatch: RustCompilerTraitDispatch,
  implementationBindings: RustCompilerSubstitutions,
): ReadonlyMap<string, RustCompilerType> {
  const bindings = new Map<string, RustCompilerType>();
  for (const itemId of requireArray(impl.items, "Rust trait impl items")) {
    const item = itemById(document, itemId);
    if (!hasInnerKind(item, "assoc_type")) continue;
    const associated = requireInnerRecord(item, "assoc_type", "Rust associated type implementation");
    if (associated.type === null || associated.type === undefined) continue;
    const name = requireString(item.name, "Rust associated type name");
    const associatedIdentity = rustCompilerDerivedIdentity(traitDispatch.identity, `associated:${name}`);
    const key = associatedTypeKey(traitDispatch.identity.itemId, associatedIdentity.itemId);
    if (bindings.has(key)) {
      throw new Error(`Rust trait impl defines associated type '${name}' more than once.`);
    }
    bindings.set(key, normalizeMemberType(
      document,
      associated.type,
      childNormalizationContext(context, `associated-type:${name}`),
      implementationBindings,
      bindings,
      traitDispatch,
    ));
  }
  return bindings;
}

function traitIsPublic(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  raw: unknown,
  resolveItem?: RustdocItemResolver,
): boolean {
  const trait = requireRecord(raw, "Rust impl trait");
  const local = document.index[String(trait.id)];
  const selected = resolveItem?.(document, dependency, trait.id)?.item ??
    (isRecord(local) ? local : undefined);
  return selected === undefined || selected.visibility === "public";
}

function genericParameterIdentity(parameter: RustCompilerGenericParameter): string {
  return parameter.kind === "lifetime"
    ? parameter.lifetime.kind === "parameter"
      ? parameter.lifetime.identity.itemId
      : parameter.lifetime.identity
    : parameter.identity.itemId;
}

function unsupportedMember(
  item: Readonly<Record<string, unknown>>,
  name: string,
  error: unknown,
): RustCompilerUnsupportedMember {
  return Object.freeze({
    kind: hasInnerKind(item, "assoc_const") ? "associated-constant" : "method",
    name,
    reason: error instanceof Error ? error.message : String(error),
  });
}

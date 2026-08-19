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
  directImplementationTypeParameterPositions,
  normalizeType,
  normalizeTypeParameters,
  normalizeTraitDispatch,
  substituteRustCompilerType,
} from "../rustdoc-types.js";
import { associatedTypeKey, normalizeMemberType, sourceImplementationRequirements, substituteTraitDispatch } from "./associated-types.js";
import { canonicalItemId } from "../rustdoc-items.js";
import { normalizeFunction } from "./functions.js";
import type {
  RustCompilerAssociatedConstant,
  RustCompilerDependency,
  RustCompilerEnumVariant,
  RustCompilerField,
  RustCompilerFunction,
  RustCompilerType,
  RustCompilerTypeParameter,
  RustCompilerUnsupportedMember,
} from "../model.js";
import type { RustdocDocument } from "../rustdoc-schema.js";

export function normalizeEnumVariants(
  document: RustdocDocument,
  enum_: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
): {
  readonly values: readonly RustCompilerEnumVariant[];
  readonly unsupported: readonly RustCompilerUnsupportedMember[];
} {
  const values: RustCompilerEnumVariant[] = [];
  const unsupported: RustCompilerUnsupportedMember[] = [];
  for (const variantId of requireArray(enum_.variants, "Rust enum variants")) {
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
      if (!Array.isArray(kind.tuple)) {
        throw new Error(`Rust enum variant '${name}' has a struct payload with no canonical source-call contract.`);
      }
      const fields = kind.tuple.map((fieldId) => {
        const field = itemById(document, fieldId);
        return normalizeType(
          document,
          requireInnerRecord(field, "struct_field", `Rust enum variant '${name}' field`),
        );
      });
      values.push(Object.freeze({
        kind: "tuple" as const,
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
  );
}

export function normalizePublicFields(
  document: RustdocDocument,
  fieldIds: readonly unknown[],
  dependency: RustCompilerDependency,
  ownerKind: "struct" | "union",
): {
  readonly values: readonly RustCompilerField[];
  readonly unsupported: readonly RustCompilerUnsupportedMember[];
} {
  const fields: RustCompilerField[] = [];
  const unsupported: RustCompilerUnsupportedMember[] = [];
  for (const id of fieldIds) {
    const item = itemById(document, id);
    if (item.visibility !== "public") {
      continue;
    }
    const name = typeof item.name === "string" ? item.name : `<field:${String(id)}>`;
    try {
      const inner = requireInnerRecord(item, "struct_field", `Rust ${ownerKind} field`);
      fields.push(Object.freeze({
        id: canonicalItemId(dependency, item),
        name: requireString(item.name, "Rust field name"),
        type: normalizeType(document, inner),
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
  declaredTypeParameters: readonly RustCompilerTypeParameter[],
  ownerCanonicalPath: readonly string[],
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
    if (impl.blanket_impl !== null || impl.is_negative === true || impl.is_synthetic === true) {
      continue;
    }
    const traitSelection = impl.trait === null
      ? { kind: "inherent" as const }
      : selectPublicTraitDispatch(document, impl.trait);
    if (traitSelection.kind === "not-public") {
      continue;
    }
    if (traitSelection.kind === "unsupported") {
      for (const memberId of requireArray(impl.items, "Rust impl items")) {
        const item = itemById(document, memberId);
        if (hasInnerKind(item, "function") || hasInnerKind(item, "assoc_const")) {
          unsupported.push(Object.freeze({
            kind: hasInnerKind(item, "assoc_const") ? "associated-constant" : "method",
            name: typeof item.name === "string" ? item.name : `<member:${String(memberId)}>`,
            reason: traitSelection.reason,
          }));
        }
      }
      continue;
    }
    const traitDispatch = traitSelection.kind === "selected"
      ? traitSelection.dispatch
      : undefined;
    const implGenerics = requireRecord(impl.generics, "Rust impl generics");
    let implTypeParameters: readonly RustCompilerTypeParameter[];
    let implementationBindings: ReadonlyMap<string, RustCompilerType>;
    let sourceRequirements: readonly RustCompilerTypeParameter[];
    try {
      implTypeParameters = normalizeTypeParameters(document, implGenerics);
      const selectedRequirements = sourceImplementationRequirements(
        document,
        impl,
        implTypeParameters,
        declaredTypeParameters,
        ownerCanonicalPath,
      );
      const selectedBindings = implementationTypeBindings(
        document,
        impl,
        implTypeParameters,
        declaredTypeParameters,
        ownerCanonicalPath,
      );
      if (selectedRequirements === undefined || selectedBindings === undefined) {
        throw new Error("Rust impl requirements cannot be projected onto the source-visible type arguments.");
      }
      implementationBindings = selectedBindings;
      sourceRequirements = selectedRequirements;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const methodId of requireArray(impl.items, "Rust impl items")) {
        const item = itemById(document, methodId);
        if ((traitDispatch !== undefined || item.visibility === "public") && hasInnerKind(item, "function")) {
          unsupported.push(Object.freeze({
            kind: "method",
            name: typeof item.name === "string" ? item.name : `<method:${String(methodId)}>`,
            reason,
          }));
        } else if (traitDispatch !== undefined && hasInnerKind(item, "assoc_const")) {
          unsupported.push(Object.freeze({
            kind: "associated-constant",
            name: typeof item.name === "string" ? item.name : `<associated-constant:${String(methodId)}>`,
            reason,
          }));
        }
      }
      continue;
    }
    const associatedTypeBindings = traitDispatch === undefined
      ? new Map<string, RustCompilerType>()
      : normalizeAssociatedTypeBindings(
          document,
          impl,
          traitDispatch,
          implementationBindings,
        );
    for (const methodId of requireArray(impl.items, "Rust impl items")) {
      const item = itemById(document, methodId);
      if (traitDispatch === undefined && item.visibility !== "public") {
        continue;
      }
      const name = typeof item.name === "string" ? item.name : `<method:${String(methodId)}>`;
      if (hasInnerKind(item, "assoc_type")) {
        continue;
      }
      try {
        if (hasInnerKind(item, "function")) {
          methods.push(normalizeFunction(document, item, dependency, true, sourceRequirements, {
            implementationBindings,
            associatedTypeBindings,
            ...(traitDispatch === undefined ? {} : {
              traitDispatch: substituteTraitDispatch(traitDispatch, implementationBindings),
            }),
          }));
        } else if (traitDispatch !== undefined && hasInnerKind(item, "assoc_const")) {
          const constant = requireInnerRecord(item, "assoc_const", `Rust associated constant '${name}'`);
          associatedConstants.push(Object.freeze({
            id: canonicalItemId(dependency, item),
            name: requireString(item.name, "Rust associated constant name"),
            type: normalizeMemberType(
              document,
              constant.type,
              implementationBindings,
              associatedTypeBindings,
              traitDispatch,
            ),
            traitDispatch: substituteTraitDispatch(traitDispatch, implementationBindings),
            typeRequirements: sourceRequirements,
          }));
        }
      } catch (error) {
        unsupported.push(Object.freeze({
          kind: hasInnerKind(item, "assoc_const") ? "associated-constant" : "method",
          name,
          reason: error instanceof Error ? error.message : String(error),
        }));
      }
    }
  }
  return {
    methods: Object.freeze(methods.sort((left, right) =>
      compareText(`${left.name}\0${left.id}`, `${right.name}\0${right.id}`))),
    associatedConstants: Object.freeze(associatedConstants.sort((left, right) =>
      compareText(`${left.name}\0${left.id}`, `${right.name}\0${right.id}`))),
    unsupported: Object.freeze(unsupported.sort((left, right) => compareText(left.name, right.name))),
  };
}

function selectPublicTraitDispatch(
  document: RustdocDocument,
  raw: unknown,
):
  | { readonly kind: "selected"; readonly dispatch: ReturnType<typeof normalizeTraitDispatch> }
  | { readonly kind: "not-public" }
  | { readonly kind: "unsupported"; readonly reason: string } {
  const trait = requireRecord(raw, "Rust impl trait");
  const local = document.index[String(trait.id)];
  if (isRecord(local) && local.visibility !== "public") {
    return { kind: "not-public" };
  }
  try {
    return { kind: "selected", dispatch: normalizeTraitDispatch(document, trait) };
  } catch (error) {
    return {
      kind: "unsupported",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function implementationTypeBindings(
  document: RustdocDocument,
  impl: Readonly<Record<string, unknown>>,
  implementationParameters: readonly RustCompilerTypeParameter[],
  declaredTypeParameters: readonly RustCompilerTypeParameter[],
  ownerCanonicalPath: readonly string[],
): ReadonlyMap<string, RustCompilerType> | undefined {
  const positions = directImplementationTypeParameterPositions(
    document,
    impl,
    declaredTypeParameters,
    ownerCanonicalPath,
  );
  if (positions === undefined) {
    return undefined;
  }
  const bindings = new Map<string, RustCompilerType>();
  for (const parameter of implementationParameters) {
    const index = positions.get(parameter.name);
    const declared = index === undefined ? undefined : declaredTypeParameters[index];
    if (declared === undefined) {
      return undefined;
    }
    bindings.set(parameter.name, Object.freeze({ kind: "generic", name: declared.name }));
  }
  return bindings;
}
function normalizeAssociatedTypeBindings(
  document: RustdocDocument,
  impl: Readonly<Record<string, unknown>>,
  traitDispatch: ReturnType<typeof normalizeTraitDispatch>,
  implementationBindings: ReadonlyMap<string, RustCompilerType>,
): ReadonlyMap<string, RustCompilerType> {
  const bindings = new Map<string, RustCompilerType>();
  for (const itemId of requireArray(impl.items, "Rust trait impl items")) {
    const item = itemById(document, itemId);
    if (!hasInnerKind(item, "assoc_type")) {
      continue;
    }
    const associated = requireInnerRecord(item, "assoc_type", "Rust associated type implementation");
    if (associated.type === null || associated.type === undefined) {
      continue;
    }
    const name = requireString(item.name, "Rust associated type name");
    const key = associatedTypeKey(traitDispatch.path, name);
    if (bindings.has(key)) {
      throw new Error(`Rust trait impl defines associated type '${name}' more than once.`);
    }
    bindings.set(
      key,
      substituteRustCompilerType(normalizeType(document, associated.type), implementationBindings),
    );
  }
  return bindings;
}

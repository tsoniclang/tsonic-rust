import { hasInnerKind, itemById, requireArray, requireInnerRecord, requireRecord, requireString } from "../rustdoc-schema.js";
import { resolveLocalRustdocItem, type ResolvedRustdocItem, type RustdocItemResolver } from "../rustdoc-items.js";
import { createRustCompilerSubstitutions, normalizeGenericParameters, rootNormalizationContext } from "../rustdoc-types.js";
import type { RustCompilerDependency, RustCompilerGenericParameter, RustCompilerTraitDispatch } from "../model.js";
import type { RustCompilerSubstitutions } from "../rustdoc-types.js";
import type { RustdocDocument } from "../rustdoc-schema.js";

export interface RustDefaultMethod extends ResolvedRustdocItem {
  readonly inheritedGenericParameters: readonly RustCompilerGenericParameter[];
  readonly implementationBindings: RustCompilerSubstitutions;
}

export function selectedRustDefaultMethods(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  implementation: Readonly<Record<string, unknown>>,
  dispatch: RustCompilerTraitDispatch,
  implementationBindings: RustCompilerSubstitutions,
  resolveItem?: RustdocItemResolver,
): readonly RustDefaultMethod[] {
  const names = requireArray(implementation.provided_trait_methods, "Rust impl provided trait methods")
    .map(value => requireString(value, "Rust provided trait method name"));
  if (new Set(names).size !== names.length) throw new Error("Rust provided trait methods contain duplicate identities.");
  if (names.length === 0) return [];
  const trait = requireRecord(implementation.trait, "Rust impl trait");
  const selected = resolveLocalRustdocItem(document, dependency, trait.id, resolveItem);
  const body = requireInnerRecord(selected.item, "trait", "Rust implemented trait");
  const context = rootNormalizationContext(selected.document, selected.dependency, selected.item, resolveItem);
  const generics = normalizeGenericParameters(selected.document, requireRecord(body.generics, "Rust trait generics"), context);
  const arguments_ = createRustCompilerSubstitutions(generics.parameters, dispatch.genericArguments);
  const bindings: RustCompilerSubstitutions = Object.freeze({
    types: new Map([...implementationBindings.types, ...arguments_.types]),
    lifetimes: new Map([...implementationBindings.lifetimes, ...arguments_.lifetimes]),
    consts: new Map([...implementationBindings.consts, ...arguments_.consts]),
  });
  const overrides = new Set(requireArray(implementation.items, "Rust impl items")
    .map(id => itemById(document, id).name));
  const members = requireArray(body.items, "Rust trait items").map(id => itemById(selected.document, id));
  return names.flatMap(name => {
    const matches = members.filter(item => item.name === name && hasInnerKind(item, "function"));
    if (matches.length !== 1 || requireInnerRecord(matches[0]!, "function", "Rust trait default method").has_body !== true) {
      throw new Error(`Rust provided trait method '${name}' has no exact default implementation.`);
    }
    return overrides.has(name) ? [] : [Object.freeze({ ...selected, item: matches[0]!,
      inheritedGenericParameters: generics.parameters, implementationBindings: bindings })];
  });
}

import { resolveRustdocCanonicalItem } from "./rustdoc-items.js";
import { rustdocItemEffectiveStability } from "./rustdoc-schema.js";
import {
  visitRustCompilerTraitReferences,
  visitRustCompilerTypeReferences,
  type RustCompilerReferenceVisitor,
} from "./references.js";
import type {
  RustCompilerDependency,
  RustCompilerFunction,
  RustCompilerTraitReference,
  RustCompilerType,
} from "./model.js";
import type { RustdocItemResolver } from "./rustdoc-items.js";
import type { RustdocDocument } from "./rustdoc-schema.js";

const rustdocTypeKinds = Object.freeze([
  "struct",
  "enum",
  "union",
  "type_alias",
  "primitive",
  "trait",
]);
const rustdocTraitKinds = Object.freeze(["trait"]);

export function rustCompilerImplementationIdentityIsSourceAvailable(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  target: RustCompilerType,
  trait: RustCompilerTraitReference | undefined,
  resolveItem?: RustdocItemResolver,
): boolean {
  return rustCompilerReferencesAreSourceAvailable(document, dependency, resolveItem, (visitor) => {
    visitRustCompilerTypeReferences(target, visitor);
    if (trait !== undefined) visitRustCompilerTraitReferences(trait, visitor);
  });
}

export function rustCompilerFunctionIsSourceAvailable(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  fn: RustCompilerFunction,
  resolveItem?: RustdocItemResolver,
): boolean {
  return rustCompilerReferencesAreSourceAvailable(document, dependency, resolveItem, (visitor) => {
    if (fn.receiver !== undefined) visitRustCompilerTypeReferences(fn.receiver.type, visitor);
    fn.parameters.forEach((parameter) => visitRustCompilerTypeReferences(parameter.type, visitor));
    visitRustCompilerTypeReferences(fn.result, visitor);
    if (fn.traitDispatch !== undefined) visitRustCompilerTraitReferences(fn.traitDispatch, visitor);
  });
}

export function rustCompilerTraitIsSourceAvailable(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  trait: RustCompilerTraitReference,
  resolveItem?: RustdocItemResolver,
): boolean {
  return rustCompilerReferencesAreSourceAvailable(document, dependency, resolveItem, (visitor) => {
    visitRustCompilerTraitReferences(trait, visitor);
  });
}

export function rustCompilerReferencesAreSourceAvailable(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  resolveItem: RustdocItemResolver | undefined,
  visit: (visitor: RustCompilerReferenceVisitor) => void,
): boolean {
  let available = true;
  const inspect = (
    identity: import("./model.js").RustCompilerItemIdentity,
    kinds: readonly string[],
  ): void => {
    if (!available) return;
    const resolved = resolveRustdocCanonicalItem(
      document,
      dependency,
      identity.canonicalPath,
      kinds,
      resolveItem,
    );
    if (resolved !== undefined &&
      rustdocItemEffectiveStability(resolved.document, resolved.item) === "unstable") available = false;
  };
  visit(Object.freeze({
    type: (identity: import("./model.js").RustCompilerItemIdentity) =>
      inspect(identity, rustdocTypeKinds),
    trait: (identity: import("./model.js").RustCompilerItemIdentity) =>
      inspect(identity, rustdocTraitKinds),
  }));
  return available;
}

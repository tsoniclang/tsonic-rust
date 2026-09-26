import type { RustNativeBinding, RustNativeBindingResolution, RustNativeReexport, RustNativeScope, RustNativeVisibility } from "./scope-model.js";
import type { RustNativeDefinition, RustNativeSourceSpan } from "./evidence.js";
import { nativeDefinitionKey } from "./evidence.js";
import type { NativeGenericDecoder } from "./decode-generics.js";
import type { NativeTypeDecodeContext } from "./decode-type-context.js";
import { array, boolean, choice, record, shape, text, unique } from "./decode-values.js";

const namespaceKinds = Object.freeze({
  type: ["module", "struct", "union", "enum", "variant", "trait", "type-alias", "foreign-type", "trait-alias", "associated-type", "type-parameter"],
  value: ["function", "constant", "const-parameter", "static", "tuple-struct-constructor", "unit-struct-constructor",
    "tuple-variant-constructor", "unit-variant-constructor", "associated-function", "associated-constant"],
  macro: ["macro"],
});
const associatedKinds = ["associated-type", "associated-function", "associated-constant"];

export function createNativeScopeDecoder(context: NativeTypeDecodeContext, generics: NativeGenericDecoder,
  span: (value: unknown) => RustNativeSourceSpan | null) {
  const visibility = (value: unknown): RustNativeVisibility => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["public", "restricted"]);
    if (kind === "public") { shape(input, ["kind"]); return Object.freeze({ kind }); }
    shape(input, ["kind", "module"]);
    return Object.freeze({ kind, module: context.definition(input.module, ["module"]) });
  };
  const resolution = (value: unknown, namespace: RustNativeBinding["namespace"]): RustNativeBindingResolution => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["declaration", "primitive", "self-parameter", "self-alias", "self-constructor",
      "tool-module", "open-module", "builtin-attribute", "tool-attribute", "derive-helper", "forward-derive-helper"]);
    if (kind !== "declaration") {
      const expected = kind === "self-constructor" ? "value" :
        ["builtin-attribute", "tool-attribute", "derive-helper", "forward-derive-helper"].includes(kind) ? "macro" : "type";
      if (namespace !== expected) throw new Error("Native Rust binding has the wrong namespace.");
    }
    switch (kind) {
      case "declaration": shape(input, ["kind", "definition"]); return Object.freeze({ kind, definition: context.definition(input.definition, namespaceKinds[namespace]) });
      case "self-parameter": shape(input, ["kind", "definition"]); return Object.freeze({ kind, definition: context.definition(input.definition, ["trait"]) });
      case "self-constructor": shape(input, ["kind", "definition"]); return Object.freeze({ kind, definition: context.definition(input.definition, ["trait-implementation", "inherent-implementation"]) });
      case "self-alias": shape(input, ["kind", "definition", "traitImplementation"]); return Object.freeze({ kind,
        definition: context.definition(input.definition), traitImplementation: boolean(input.traitImplementation) });
      case "primitive": shape(input, ["kind", "name"]); return Object.freeze({ kind, name: choice(input.name,
        ["bool", "char", "str", "isize", "i8", "i16", "i32", "i64", "i128", "usize", "u8", "u16", "u32", "u64", "u128", "f16", "f32", "f64", "f128"]) });
      case "open-module": case "builtin-attribute": shape(input, ["kind", "name"]); return Object.freeze({ kind, name: text(input.name) });
      default: shape(input, ["kind"]); return Object.freeze({ kind });
    }
  };
  const reexport = (value: unknown): RustNativeReexport => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["single", "glob", "extern-crate", "macro-use", "macro-export"]);
    switch (kind) {
      case "single": case "glob": shape(input, ["kind", "definition"]); return Object.freeze({ kind, definition: context.definition(input.definition, ["use"]) });
      case "extern-crate": shape(input, ["kind", "definition"]); return Object.freeze({ kind, definition: context.definition(input.definition, ["extern-crate"]) });
      default: shape(input, ["kind"]); return Object.freeze({ kind });
    }
  };
  const binding = (value: unknown): RustNativeBinding => {
    context.reserve();
    const input = shape(value, ["name", "namespace", "source", "visibility", "resolution", "reexports"]);
    const namespace = choice(input.namespace, ["type", "value", "macro"]);
    const name = text(input.name);
    if (name.length === 0) throw new Error("Native Rust binding has an empty name.");
    return Object.freeze({ name, namespace, source: span(input.source), visibility: visibility(input.visibility),
      resolution: resolution(input.resolution, namespace), reexports: array(input.reexports, reexport) });
  };
  const scope = (value: unknown): RustNativeScope => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["named", "implementation"]);
    if (kind === "named") {
      shape(input, ["kind", "owner", "bindings", "ambiguities"]);
      const bindings = array(input.bindings, binding);
      const ambiguities = array(input.ambiguities, value => {
        context.reserve();
        const row = shape(value, ["main", "second"]);
        const main = binding(row.main);
        const second = binding(row.second);
        if (main.name !== second.name || main.namespace !== second.namespace) {
          throw new Error("Native Rust ambiguous bindings have different names or namespaces.");
        }
        return Object.freeze({ main, second });
      });
      return Object.freeze({ kind, owner: context.definition(input.owner, ["module", "trait", "enum"]), bindings, ambiguities });
    }
    shape(input, ["kind", "owner", "selfType", "trait", "members"]);
    let trait: Extract<RustNativeScope, { kind: "implementation" }>["trait"] = null;
    if (input.trait !== null) {
      const row = shape(input.trait, ["definition", "arguments", "polarity", "safety", "constness"]);
      trait = Object.freeze({ definition: context.definition(row.definition, ["trait"]), arguments: generics.arguments(row.arguments),
        polarity: choice(row.polarity, ["positive", "negative", "reservation"]), safety: choice(row.safety, ["safe", "unsafe"]),
        constness: choice(row.constness, ["comptime", "const", "ordinary"]) });
    }
    const members = array(input.members, value => {
      context.reserve();
      const row = shape(value, ["definition", "traitMember"]);
      return Object.freeze({ definition: context.definition(row.definition, associatedKinds),
        traitMember: row.traitMember === null ? null : context.definition(row.traitMember, associatedKinds) });
    });
    unique(members.map(member => nativeDefinitionKey(member.definition)), "implementation member");
    return Object.freeze({ kind, owner: context.definition(input.owner, trait === null ? ["inherent-implementation"] : ["trait-implementation"]),
      selfType: context.type(input.selfType), trait, members });
  };
  return { visibility, scope };
}

export function validateNativeScopeRelations(scopes: readonly RustNativeScope[], definitions: readonly RustNativeDefinition[],
  requireSpan: (span: RustNativeSourceSpan | null) => void): void {
  unique(scopes.map(scope => nativeDefinitionKey(scope.owner)), "scope owner");
  const declarations = new Map(definitions.map(definition => [nativeDefinitionKey(definition.id), definition]));
  for (const scope of scopes) {
    if (scope.kind === "named") {
      for (const binding of scope.bindings) requireSpan(binding.source);
      for (const ambiguity of scope.ambiguities) { requireSpan(ambiguity.main.source); requireSpan(ambiguity.second.source); }
      continue;
    }
    for (const member of scope.members) {
      const definition = declarations.get(nativeDefinitionKey(member.definition));
      if (definition?.parent === null || definition?.parent === undefined ||
        nativeDefinitionKey(definition.parent) !== nativeDefinitionKey(scope.owner)) {
        throw new Error("Native Rust implementation member has the wrong owner.");
      }
      if (member.traitMember === null) {
        if (scope.trait !== null) throw new Error("Native Rust trait implementation member has no trait correspondence.");
      } else {
        const selected = declarations.get(nativeDefinitionKey(member.traitMember));
        if (scope.trait === null || selected?.parent === null || selected?.parent === undefined ||
          nativeDefinitionKey(selected.parent) !== nativeDefinitionKey(scope.trait.definition) || selected.kind !== definition.kind) {
          throw new Error("Native Rust implementation has an invalid trait-member correspondence.");
        }
      }
    }
  }
}

import type { RustNativeAlias, RustNativeArgument, RustNativeClause, RustNativeExistential,
  RustNativeGenerics, RustNativeParameter } from "./type-model.js";
import type { NativeTypeDecodeContext } from "./decode-type-context.js";
import type { NativeRegionDecoder } from "./decode-regions.js";
import { array, boolean, choice, index, record, shape, text, unique } from "./decode-values.js";
import { nativeDefinitionKey } from "./evidence.js";

export function createNativeGenericDecoder(context: NativeTypeDecodeContext, regions: NativeRegionDecoder) {
  const argument = (value: unknown): RustNativeArgument => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["type", "constant", "lifetime"]);
    shape(input, kind === "lifetime" ? ["kind", "region"] : ["kind", "id"]);
    switch (kind) {
      case "type": return Object.freeze({ kind, id: context.type(input.id) });
      case "constant": return Object.freeze({ kind, id: context.constant(input.id) });
      case "lifetime": return Object.freeze({ kind, region: regions.region(input.region) });
    }
  };
  const term = (value: unknown): RustNativeArgument => {
    const result = argument(value);
    if (result.kind === "lifetime") throw new Error("Native Rust type/constant term cannot be a lifetime.");
    return result;
  };
  const arguments_ = (value: unknown): readonly RustNativeArgument[] => array(value, argument);
  const alias = (value: unknown): RustNativeAlias => {
    context.reserve();
    const input = shape(value, ["sort", "category", "definition", "arguments"]);
    const sort = choice(input.sort, ["type", "constant"]);
    if (sort === "type") {
      const category = choice(input.category, ["projection", "inherent", "opaque", "free"]);
      return Object.freeze({ sort, category, arguments: arguments_(input.arguments), definition: context.definition(input.definition,
        category === "opaque" ? ["opaque-type"] : category === "free" ? ["type-alias"] : ["associated-type"]) });
    }
    const category = choice(input.category, ["projection", "inherent", "free", "anonymous"]);
    return Object.freeze({ sort, category, arguments: arguments_(input.arguments), definition: context.definition(input.definition,
      category === "anonymous" ? ["anonymous-constant", "inline-constant"] : category === "free" ? ["constant"] : ["associated-constant"]) });
  };
  const existential = (value: unknown): RustNativeExistential => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["trait", "projection", "auto-trait"]);
    switch (kind) {
      case "trait": shape(input, ["kind", "definition", "arguments"]); return Object.freeze({ kind,
        definition: context.definition(input.definition, ["trait"]), arguments: arguments_(input.arguments) });
      case "projection": shape(input, ["kind", "definition", "arguments", "term"]); return Object.freeze({ kind,
        definition: context.definition(input.definition, ["associated-type", "associated-constant"]), arguments: arguments_(input.arguments), term: term(input.term) });
      case "auto-trait": shape(input, ["kind", "definition"]); return Object.freeze({ kind,
        definition: context.definition(input.definition, ["trait"]) });
    }
  };
  const clause = (value: unknown): RustNativeClause => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["trait", "region-outlives", "type-outlives", "projection", "constant-type", "well-formed",
      "constant-evaluatable", "host-effect", "unstable-feature"]);
    switch (kind) {
      case "trait": shape(input, ["kind", "definition", "arguments", "polarity"]); return Object.freeze({ kind,
        definition: context.definition(input.definition, ["trait"]), arguments: arguments_(input.arguments), polarity: choice(input.polarity, ["positive", "negative"]) });
      case "region-outlives": shape(input, ["kind", "longer", "shorter"]); return Object.freeze({ kind, longer: regions.region(input.longer), shorter: regions.region(input.shorter) });
      case "type-outlives": shape(input, ["kind", "type", "region"]); return Object.freeze({ kind, type: context.type(input.type), region: regions.region(input.region) });
      case "projection": {
        shape(input, ["kind", "alias", "term"]);
        const selectedAlias = alias(input.alias);
        const selectedTerm = term(input.term);
        if (selectedAlias.sort !== selectedTerm.kind) throw new Error("Native Rust projection has inconsistent type/constant sorts.");
        return Object.freeze({ kind, alias: selectedAlias, term: selectedTerm });
      }
      case "constant-type": shape(input, ["kind", "constant", "type"]); return Object.freeze({ kind, constant: context.constant(input.constant), type: context.type(input.type) });
      case "well-formed": shape(input, ["kind", "term"]); return Object.freeze({ kind, term: term(input.term) });
      case "constant-evaluatable": shape(input, ["kind", "constant"]); return Object.freeze({ kind, constant: context.constant(input.constant) });
      case "host-effect": shape(input, ["kind", "definition", "arguments", "constness"]); return Object.freeze({ kind,
        definition: context.definition(input.definition, ["trait"]), arguments: arguments_(input.arguments), constness: choice(input.constness, ["const", "maybe"]) });
      case "unstable-feature": shape(input, ["kind", "name"]); return Object.freeze({ kind, name: text(input.name) });
    }
  };
  const parameterKind = (value: unknown): RustNativeParameter["value"] => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["lifetime", "type", "constant"]);
    switch (kind) {
      case "lifetime": shape(input, ["kind"]); return Object.freeze({ kind });
      case "type": shape(input, ["kind", "synthetic", "default"]); return Object.freeze({ kind,
        synthetic: boolean(input.synthetic), default: input.default === null ? null : context.type(input.default) });
      case "constant": shape(input, ["kind", "type", "default"]); return Object.freeze({ kind,
        type: context.type(input.type), default: input.default === null ? null : context.constant(input.default) });
    }
  };
  const generics = (value: unknown): RustNativeGenerics | null => {
    if (value === null) return null;
    context.reserve();
    const input = shape(value, ["parent", "parentCount", "hasSelf", "parameters", "predicatesParent", "predicates"]);
    const parameters = array(input.parameters, value => {
      context.reserve();
      const input = shape(value, ["definition", "index", "name", "pureWrtDrop", "value"]);
      const selected = parameterKind(input.value);
      return Object.freeze({ definition: context.definition(input.definition, selected.kind === "lifetime" ? ["lifetime-parameter"] :
        selected.kind === "constant" ? ["const-parameter"] : ["type-parameter", "trait", "trait-alias"]),
        index: index(input.index), name: text(input.name), pureWrtDrop: boolean(input.pureWrtDrop), value: selected });
    });
    unique(parameters.map(parameter => nativeDefinitionKey(parameter.definition)), "generic parameter");
    return Object.freeze({ parent: input.parent === null ? null : context.definition(input.parent), parentCount: index(input.parentCount),
      hasSelf: boolean(input.hasSelf), parameters, predicatesParent: input.predicatesParent === null ? null : context.definition(input.predicatesParent),
      predicates: array(input.predicates, value => regions.binder(value, clause)) });
  };
  return { argument, arguments: arguments_, alias, existential, generics };
}

export type NativeGenericDecoder = ReturnType<typeof createNativeGenericDecoder>;

import type { RustNativeBinder, RustNativeBoundIndex, RustNativeBoundRegion, RustNativeBoundType,
  RustNativeLateRegion, RustNativeRegion, RustNativeVariable } from "./type-model.js";
import type { NativeTypeDecodeContext } from "./decode-type-context.js";
import { array, choice, index, record, shape, text } from "./decode-values.js";

export function createNativeRegionDecoder(context: NativeTypeDecodeContext) {
  const boundIndex = (value: unknown): RustNativeBoundIndex => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["bound", "canonical"]);
    shape(input, kind === "bound" ? ["kind", "depth"] : ["kind"]);
    return Object.freeze(kind === "bound" ? { kind, depth: index(input.depth) } : { kind });
  };
  const boundType = (value: unknown): RustNativeBoundType => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["anonymous", "named"]);
    shape(input, kind === "named" ? ["kind", "definition"] : ["kind"]);
    return Object.freeze(kind === "named" ? { kind, definition: context.definition(input.definition, ["type-parameter"]) } : { kind });
  };
  const boundRegion = (value: unknown): RustNativeBoundRegion => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["anonymous", "printed", "named", "closure-environment"]);
    switch (kind) {
      case "anonymous": case "closure-environment": shape(input, ["kind"]); return Object.freeze({ kind });
      case "printed": shape(input, ["kind", "name"]); return Object.freeze({ kind, name: text(input.name) });
      case "named": shape(input, ["kind", "definition"]); return Object.freeze({ kind, definition: context.definition(input.definition, ["lifetime-parameter"]) });
    }
  };
  const lateRegion = (value: unknown): RustNativeLateRegion => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["anonymous", "printed", "named", "closure-environment"]);
    switch (kind) {
      case "anonymous": shape(input, ["kind", "index"]); return Object.freeze({ kind, index: index(input.index) });
      case "printed": shape(input, ["kind", "index", "name"]); return Object.freeze({ kind, index: index(input.index), name: text(input.name) });
      case "named": shape(input, ["kind", "definition"]); return Object.freeze({ kind, definition: context.definition(input.definition, ["lifetime-parameter"]) });
      case "closure-environment": shape(input, ["kind"]); return Object.freeze({ kind });
    }
  };
  const region = (value: unknown): RustNativeRegion => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["early", "bound", "late", "static", "inference", "placeholder", "erased"]);
    switch (kind) {
      case "early": shape(input, ["kind", "index", "name"]); return Object.freeze({ kind, index: index(input.index), name: text(input.name) });
      case "bound": shape(input, ["kind", "binder", "variable", "declaration"]); return Object.freeze({ kind, binder: boundIndex(input.binder), variable: index(input.variable), declaration: boundRegion(input.declaration) });
      case "late": shape(input, ["kind", "scope", "declaration"]); return Object.freeze({ kind, scope: context.definition(input.scope), declaration: lateRegion(input.declaration) });
      case "static": case "erased": shape(input, ["kind"]); return Object.freeze({ kind });
      case "inference": shape(input, ["kind", "index"]); return Object.freeze({ kind, index: index(input.index) });
      case "placeholder": shape(input, ["kind", "universe", "variable", "declaration"]); return Object.freeze({ kind, universe: index(input.universe), variable: index(input.variable), declaration: boundRegion(input.declaration) });
    }
  };
  const variable = (value: unknown): RustNativeVariable => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["type", "lifetime", "constant"]);
    shape(input, kind === "constant" ? ["kind"] : ["kind", "declaration"]);
    switch (kind) {
      case "type": return Object.freeze({ kind, declaration: boundType(input.declaration) });
      case "lifetime": return Object.freeze({ kind, declaration: boundRegion(input.declaration) });
      case "constant": return Object.freeze({ kind });
    }
  };
  const binder = <Value>(value: unknown, decode: (value: unknown) => Value): RustNativeBinder<Value> => {
    context.reserve();
    const input = shape(value, ["variables", "value"]);
    return Object.freeze({ variables: array(input.variables, variable), value: decode(input.value) });
  };
  return { boundIndex, boundType, region, binder };
}

export type NativeRegionDecoder = ReturnType<typeof createNativeRegionDecoder>;

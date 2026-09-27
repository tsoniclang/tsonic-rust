import type { NativeTypeDecodeContext } from "./decode-type-context.js";
import type { RustNativeType, RustNativeTypePattern, RustNativeSignature } from "./type-model.js";
import type { NativeRegionDecoder } from "./decode-regions.js";
import type { NativeGenericDecoder } from "./decode-generics.js";
import { array, boolean, choice, index, record, shape, text } from "./decode-values.js";

export function createNativeTypeDecoder(context: NativeTypeDecodeContext, regions: NativeRegionDecoder, generics: NativeGenericDecoder) {
  const pattern = (value: unknown, depth = 0): RustNativeTypePattern => {
    context.depth(depth);
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["range", "or", "not-null"]);
    switch (kind) {
      case "range": shape(input, ["kind", "start", "end"]); return Object.freeze({ kind, start: context.constant(input.start), end: context.constant(input.end) });
      case "or": shape(input, ["kind", "patterns"]); return Object.freeze({ kind, patterns: array(input.patterns, entry => pattern(entry, depth + 1)) });
      case "not-null": shape(input, ["kind"]); return Object.freeze({ kind });
    }
  };
  const signature = (value: unknown): RustNativeSignature => {
    context.reserve();
    const input = shape(value, ["inputs", "output", "variadic", "unsafeCall", "abi"]);
    const abi = text(input.abi);
    if (abi.length === 0) throw new Error("Native Rust signature requires its exact ABI.");
    return Object.freeze({ inputs: array(input.inputs, context.type), output: context.type(input.output), variadic: boolean(input.variadic),
      unsafeCall: boolean(input.unsafeCall), abi });
  };
  return (value: unknown): RustNativeType => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["primitive", "adt", "foreign", "array", "pattern", "slice", "raw-pointer", "reference", "function",
      "function-pointer", "unsafe-binder", "dynamic", "closure", "coroutine-closure", "coroutine", "coroutine-witness", "tuple", "alias",
      "parameter", "bound", "placeholder", "inference"]);
    switch (kind) {
      case "primitive": shape(input, ["kind", "name"]); return Object.freeze({ kind, name: choice(input.name,
        ["bool", "char", "str", "never", "i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize", "f16", "f32", "f64", "f128"]) });
      case "adt": case "closure": case "coroutine-closure": case "coroutine": case "coroutine-witness":
        shape(input, ["kind", "definition", "arguments"]);
        return Object.freeze({ kind, definition: context.definition(input.definition,
          kind === "adt" ? ["struct", "enum", "union"] : ["closure", "coroutine-body"]), arguments: generics.arguments(input.arguments) });
      case "foreign": shape(input, ["kind", "definition"]); return Object.freeze({ kind, definition: context.definition(input.definition, ["foreign-type"]) });
      case "array": shape(input, ["kind", "element", "length"]); return Object.freeze({ kind, element: context.type(input.element), length: context.constant(input.length) });
      case "pattern": shape(input, ["kind", "base", "pattern"]); return Object.freeze({ kind, base: context.type(input.base), pattern: pattern(input.pattern) });
      case "slice": shape(input, ["kind", "element"]); return Object.freeze({ kind, element: context.type(input.element) });
      case "raw-pointer": shape(input, ["kind", "pointee", "mutable"]); return Object.freeze({ kind, pointee: context.type(input.pointee), mutable: boolean(input.mutable) });
      case "reference": shape(input, ["kind", "region", "pointee", "mutable"]); return Object.freeze({ kind, region: regions.region(input.region), pointee: context.type(input.pointee), mutable: boolean(input.mutable) });
      case "function": shape(input, ["kind", "definition", "arguments", "signature"]); return Object.freeze({ kind,
        definition: context.definition(input.definition, ["function", "associated-function", "tuple-struct-constructor", "unit-struct-constructor", "tuple-variant-constructor", "unit-variant-constructor"]),
        arguments: generics.arguments(input.arguments), signature: regions.binder(input.signature, signature) });
      case "function-pointer": shape(input, ["kind", "signature"]); return Object.freeze({ kind, signature: regions.binder(input.signature, signature) });
      case "unsafe-binder": shape(input, ["kind", "binder"]); return Object.freeze({ kind, binder: regions.binder(input.binder, context.type) });
      case "dynamic": shape(input, ["kind", "predicates", "region"]); return Object.freeze({ kind,
        predicates: array(input.predicates, value => regions.binder(value, generics.existential)), region: regions.region(input.region) });
      case "tuple": shape(input, ["kind", "elements"]); return Object.freeze({ kind, elements: array(input.elements, context.type) });
      case "alias": {
        shape(input, ["kind", "alias", "rigid"]);
        const alias = generics.alias(input.alias);
        if (alias.sort !== "type") throw new Error("Native Rust type alias has the wrong sort.");
        return Object.freeze({ kind, alias, rigid: boolean(input.rigid) });
      }
      case "parameter": shape(input, ["kind", "index", "name"]); return Object.freeze({ kind, index: index(input.index), name: text(input.name) });
      case "bound": shape(input, ["kind", "binder", "variable", "declaration"]); return Object.freeze({ kind,
        binder: regions.boundIndex(input.binder), variable: index(input.variable), declaration: regions.boundType(input.declaration) });
      case "placeholder": shape(input, ["kind", "universe", "variable", "declaration"]); return Object.freeze({ kind,
        universe: index(input.universe), variable: index(input.variable), declaration: regions.boundType(input.declaration) });
      case "inference": shape(input, ["kind", "category", "index"]); return Object.freeze({ kind,
        category: choice(input.category, ["type", "integer", "float", "fresh-type", "fresh-integer", "fresh-float"]), index: index(input.index) });
    }
  };
}

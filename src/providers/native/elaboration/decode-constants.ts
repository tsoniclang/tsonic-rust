import type { NativeTypeDecodeContext } from "./decode-type-context.js";
import type { NativeRegionDecoder } from "./decode-regions.js";
import type { NativeGenericDecoder } from "./decode-generics.js";
import type { RustNativeConstant, RustNativeArgument, RustNativeConstantOperation } from "./type-model.js";
import { rustNativeConstantOperations } from "./type-model.js";
import { array, boolean, choice, index, record, shape, text } from "./decode-values.js";

export function createNativeConstantDecoder(context: NativeTypeDecodeContext, regions: NativeRegionDecoder, generics: NativeGenericDecoder) {
  return (value: unknown): RustNativeConstant => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["parameter", "bound", "placeholder", "inference", "alias", "scalar", "aggregate", "expression"]);
    switch (kind) {
      case "parameter": shape(input, ["kind", "index", "name"]); return Object.freeze({ kind, index: index(input.index), name: text(input.name) });
      case "bound": shape(input, ["kind", "binder", "variable"]); return Object.freeze({ kind, binder: regions.boundIndex(input.binder), variable: index(input.variable) });
      case "placeholder": shape(input, ["kind", "universe", "variable"]); return Object.freeze({ kind, universe: index(input.universe), variable: index(input.variable) });
      case "inference": shape(input, ["kind", "category", "index"]); return Object.freeze({ kind, category: choice(input.category, ["constant", "fresh-constant"]), index: index(input.index) });
      case "alias": {
        shape(input, ["kind", "alias", "rigid"]);
        const alias = generics.alias(input.alias);
        if (alias.sort !== "constant") throw new Error("Native Rust constant alias has the wrong sort.");
        return Object.freeze({ kind, alias, rigid: boolean(input.rigid) });
      }
      case "scalar": {
        shape(input, ["kind", "type", "bytes", "bits"]);
        const bytes = index(input.bytes);
        const bits = text(input.bits);
        if (bytes === 0 || bytes > 16 || bits.length > 39 || !/^(?:0|[1-9][0-9]*)$/u.test(bits) || BigInt(bits) >= 1n << BigInt(bytes * 8)) {
          throw new Error("Native Rust constant has invalid exact scalar bits.");
        }
        return Object.freeze({ kind, type: context.type(input.type), bytes, bits });
      }
      case "aggregate": shape(input, ["kind", "type", "fields"]); return Object.freeze({ kind, type: context.type(input.type), fields: array(input.fields, context.constant) });
      case "expression": {
        shape(input, ["kind", "operation", "arguments"]);
        const operation = choice(input.operation, rustNativeConstantOperations);
        const arguments_ = generics.arguments(input.arguments);
        validateArguments(operation, arguments_);
        return Object.freeze({ kind, operation, arguments: arguments_ });
      }
    }
  };
}

function validateArguments(operation: RustNativeConstantOperation, arguments_: readonly RustNativeArgument[]): void {
  const kinds = arguments_.map(argument => argument.kind);
  const expected = operation === "call" ? undefined : operation === "as" || operation === "use" ? ["type", "constant", "type"] :
    operation === "not" || operation === "neg" || operation === "pointer-metadata" ? ["type", "constant"] : ["type", "type", "constant", "constant"];
  if (expected === undefined ? kinds.length < 2 || kinds[0] !== "type" || kinds.slice(1).some(kind => kind !== "constant") :
    kinds.length !== expected.length || kinds.some((kind, index) => kind !== expected[index])) {
    throw new Error("Native Rust constant expression has invalid argument sorts or arity.");
  }
}

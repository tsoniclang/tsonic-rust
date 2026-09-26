import type { RustNativeNodeId, RustNativeSourceSpan } from "./evidence.js";
import type { RustNativeAdjustment, RustNativeBindingMode, RustNativeOccurrence, RustNativeResolution } from "./occurrence-model.js";
import type { NativeTypeDecodeContext } from "./decode-type-context.js";
import type { NativeGenericDecoder } from "./decode-generics.js";
import { array, boolean, choice, record, shape } from "./decode-values.js";

export function createNativeOccurrenceDecoder(
  context: NativeTypeDecodeContext,
  generics: NativeGenericDecoder,
  readers: {
    readonly node: (value: unknown) => RustNativeNodeId;
    readonly span: (value: unknown) => RustNativeSourceSpan | null;
  },
): (value: unknown) => RustNativeOccurrence {
  const resolution = (value: unknown): RustNativeResolution | null => {
    if (value === null) return null;
    context.reserve();
    const input = shape(value, ["kind", "id"]);
    const kind = choice(input.kind, ["declaration", "binding"]);
    return Object.freeze(kind === "binding" ? { kind, id: readers.node(input.id) }
      : { kind, id: context.definition(input.id) });
  };
  const operation = (value: unknown): RustNativeAdjustment["operation"] => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["never-to-any", "builtin-deref", "pin-deref", "unsafe-function-pointer",
      "mutable-to-const-pointer", "array-to-pointer", "unsize", "overloaded-deref", "borrow-reference",
      "borrow-raw-pointer", "borrow-pin", "generic-reborrow", "reify-function-pointer", "closure-function-pointer"]);
    switch (kind) {
      case "overloaded-deref":
        shape(input, ["kind", "mutable", "method"]);
        return Object.freeze({ kind, mutable: boolean(input.mutable), method: context.definition(input.method, ["associated-function"]) });
      case "borrow-reference": {
        shape(input, ["kind", "mutable", "twoPhase"]);
        const mutable = boolean(input.mutable);
        const twoPhase = boolean(input.twoPhase);
        if (twoPhase && !mutable) throw new Error("Native Rust two-phase borrowing requires a mutable borrow.");
        return Object.freeze({ kind, mutable, twoPhase });
      }
      case "borrow-raw-pointer":
      case "borrow-pin":
      case "generic-reborrow":
        shape(input, ["kind", "mutable"]);
        return Object.freeze({ kind, mutable: boolean(input.mutable) });
      case "reify-function-pointer":
      case "closure-function-pointer":
        shape(input, ["kind", "unsafe"]);
        return Object.freeze({ kind, unsafe: boolean(input.unsafe) });
      default:
        shape(input, ["kind"]);
        return Object.freeze({ kind });
    }
  };
  const binding = (value: unknown): RustNativeBindingMode | null => {
    if (value === null) return null;
    context.reserve();
    const input = shape(value, ["mutable", "reference"]);
    const reference = input.reference === null ? null : shape(input.reference, ["mutable", "pinned"]);
    if (reference !== null) context.reserve();
    return Object.freeze({ mutable: boolean(input.mutable), reference: reference === null ? null : Object.freeze({
      mutable: boolean(reference.mutable), pinned: boolean(reference.pinned),
    }) });
  };
  return (value: unknown): RustNativeOccurrence => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["expression", "pattern"]);
    shape(input, ["kind", "id", "source", "type", "resolution", "adjustments",
      ...(kind === "expression" ? ["adjustedType", "arguments"] : ["binding"])]);
    const common = { id: readers.node(input.id), source: readers.span(input.source), type: context.type(input.type),
      resolution: resolution(input.resolution) };
    if (kind === "expression") {
      const adjustments = array(input.adjustments, value => {
        context.reserve();
        const input = shape(value, ["target", "operation"]);
        return Object.freeze({ target: context.type(input.target), operation: operation(input.operation) });
      });
      const adjustedType = context.type(input.adjustedType);
      if ((adjustments[adjustments.length - 1]?.target ?? common.type) !== adjustedType) {
        throw new Error("Native Rust expression has inconsistent final adjustment evidence.");
      }
      return Object.freeze({ ...common, kind, adjustedType, adjustments,
        arguments: input.arguments === null ? null : generics.arguments(input.arguments) });
    }
    const selectedBinding = binding(input.binding);
    if ((common.resolution?.kind === "binding") !== (selectedBinding !== null)) {
      throw new Error("Native Rust pattern has inconsistent binding evidence.");
    }
    return Object.freeze({ ...common, kind, binding: selectedBinding, adjustments: array(input.adjustments, value => {
      context.reserve();
      const input = shape(value, ["kind", "source"]);
      return Object.freeze({ kind: choice(input.kind, ["builtin-deref", "overloaded-deref", "pin-deref"]),
        source: context.type(input.source) });
    }) });
  };
}

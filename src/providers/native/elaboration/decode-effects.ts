import type { RustNativeAccess, RustNativeBodyEffects, RustNativeNodeId, RustNativeSourceSpan } from "./evidence.js";
import type { NativeTypeDecodeContext } from "./decode-type-context.js";
import { array, choice, index, record, shape } from "./decode-values.js";

export function createNativeEffectDecoder(
  context: NativeTypeDecodeContext,
  readers: {
    readonly node: (value: unknown) => RustNativeNodeId;
    readonly span: (value: unknown) => RustNativeSourceSpan | null;
  },
): (value: unknown) => RustNativeBodyEffects {
  const base = (value: unknown): RustNativeAccess["base"] => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["temporary", "static", "local", "capture"]);
    switch (kind) {
      case "temporary":
      case "static":
        shape(input, ["kind"]);
        return Object.freeze({ kind });
      case "local":
        shape(input, ["kind", "binding"]);
        return Object.freeze({ kind, binding: readers.node(input.binding) });
      case "capture":
        shape(input, ["kind", "binding", "closure"]);
        return Object.freeze({ kind, binding: readers.node(input.binding),
          closure: context.definition(input.closure, ["closure", "coroutine-body"]) });
    }
  };
  const projection = (value: unknown): RustNativeAccess["projections"][number] => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["dereference", "field", "index", "subslice", "opaque-cast", "unwrap-unsafe-binder"]);
    if (kind === "field") {
      shape(input, ["kind", "field", "variant"]);
      return Object.freeze({ kind, field: index(input.field), variant: index(input.variant) });
    }
    shape(input, ["kind"]);
    return Object.freeze({ kind });
  };
  const fakeRead = (value: unknown): RustNativeAccess["fakeRead"] => {
    if (value === null) return null;
    context.reserve();
    const input = shape(value, ["reason", "closure"]);
    const reason = choice(input.reason, ["match-guard", "matched-place", "guard-binding", "let", "index"]);
    if (input.closure !== null && reason !== "matched-place" && reason !== "let") {
      throw new Error("Native Rust fake-read reason cannot carry a closure identity.");
    }
    return Object.freeze({
      reason,
      closure: input.closure === null ? null : context.definition(input.closure, ["closure", "coroutine-body"]),
    });
  };
  return (value: unknown): RustNativeBodyEffects => {
    context.reserve();
    const input = shape(value, ["owner", "accesses"]);
    const owner = context.definition(input.owner);
    const accesses = array(input.accesses, (value): RustNativeAccess => {
      context.reserve();
      const input = shape(value, ["kind", "place", "diagnostic", "source", "base", "projections", "fakeRead"]);
      const kind = choice(input.kind, ["move", "use-cloned", "copy", "borrow-shared", "borrow-unique-shared",
        "borrow-mutable", "mutate", "bind", "fake-read"]);
      const fake = fakeRead(input.fakeRead);
      if ((kind === "fake-read") !== (fake !== null)) {
        throw new Error("Native Rust evidence has inconsistent fake-read evidence.");
      }
      return Object.freeze({ kind, place: readers.node(input.place), diagnostic: readers.node(input.diagnostic),
        source: readers.span(input.source), base: base(input.base), projections: array(input.projections, projection),
        fakeRead: fake });
    });
    return Object.freeze({ owner, accesses });
  };
}

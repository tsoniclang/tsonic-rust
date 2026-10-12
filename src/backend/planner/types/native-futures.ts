import type { RustGenericArgument, RustType } from "../../target-ast/nodes.js";

export type RustNativeFutureRepresentation =
  | { readonly kind: "ready" }
  | { readonly kind: "opaque"; readonly captures?: readonly RustGenericArgument[] };

export function rustNativeFutureType(
  output: RustType,
  representation: RustNativeFutureRepresentation,
): RustType {
  if (representation.kind === "ready") {
    return { kind: "named", path: "core::future::Ready", genericArguments: [{ kind: "type", type: output }] };
  }
  return { kind: "impl-trait", bounds: [{ kind: "trait-type", reference: { trait: {
    kind: "named", path: "core::future::Future", genericArguments: [
      { kind: "associated-equality", name: "Output", genericArguments: [], type: output },
    ],
  } } }], outlives: [],
  ...(representation.captures === undefined ? {} : { captures: representation.captures }) };
}

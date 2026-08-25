import { emptyRustAstGenerics } from "./nodes.js";
import type {
  RustGenericArgument,
  RustGenericParameter,
  RustGenerics,
  RustType,
  RustTypeBound,
  RustReceiver,
} from "./nodes.js";

export function rustTypeGenericArgument(type: RustType): RustGenericArgument {
  return { kind: "type", type };
}

export function rustTypeGenericArguments(types: readonly RustType[]): readonly RustGenericArgument[] {
  return types.map(rustTypeGenericArgument);
}

export function rustTypeParameter(
  name: string,
  bounds: readonly RustTypeBound[] = [],
): Extract<RustGenericParameter, { readonly kind: "type" }> {
  return { kind: "type", name, bounds };
}

export function rustGenerics(
  parameters: readonly RustGenericParameter[] = [],
  wherePredicates: RustGenerics["wherePredicates"] = [],
): RustGenerics {
  return parameters.length === 0 && wherePredicates.length === 0
    ? emptyRustAstGenerics
    : { parameters, wherePredicates };
}

export function rustReferenceReceiver(
  mutable: boolean,
  lifetime?: Extract<import("./nodes.js").RustLifetime, { readonly kind: "named" | "static" }>,
): RustReceiver {
  return {
    kind: "reference",
    mutable,
    ...(lifetime === undefined ? {} : { lifetime }),
  };
}

export function rustTypedReceiver(
  type: RustType,
  mutable = false,
): RustReceiver {
  return { kind: "typed", type, ...(mutable ? { mutable: true } : {}) };
}

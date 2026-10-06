import type { RustType } from "../../target-ast/nodes.js";

export function rustInvariantTypeMarker(parameters: readonly RustType[]): RustType {
  const environment: RustType = { kind: "tuple", elements: parameters };
  return { kind: "named", path: "core::marker::PhantomData", genericArguments: [{ kind: "type", type: {
    kind: "function-pointer", parameters: [environment], result: environment,
  } }] };
}

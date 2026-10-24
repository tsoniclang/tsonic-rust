import type { RustType } from "../../target-ast/syntax/nodes.js";

export function rustInvariantTypeMarker(parameters: readonly RustType[]): RustType {
  const environment: RustType = parameters.length === 1 ? parameters[0]! : { kind: "tuple", elements: parameters };
  return { kind: "named", path: "core::marker::PhantomData", genericArguments: [{ kind: "type", type: {
    kind: "function-pointer", parameters: [environment], result: environment,
  } }] };
}

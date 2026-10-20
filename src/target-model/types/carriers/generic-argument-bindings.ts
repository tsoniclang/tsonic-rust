import { rustLifetimeKey } from "../../lifetimes/index.js";
import type { RustLifetimeRef } from "../../lifetimes/index.js";
import type { RustTargetConstArgument, RustTargetGenericArgument, TargetTypeRef } from "../model.js";
import { rustTargetGenericArgumentEquals } from "../equality.js";
import type { RustTargetGenericBindings } from "./generic-inference.js";

export function bindRustGenericArguments(
  parameters: readonly RustTargetGenericArgument[],
  arguments_: readonly RustTargetGenericArgument[],
): RustTargetGenericBindings | undefined {
  if (parameters.length !== arguments_.length) return undefined;
  const types = new Map<string, TargetTypeRef>();
  const lifetimes = new Map<string, RustLifetimeRef>();
  const consts = new Map<string, RustTargetConstArgument>();
  const bound = new Map<string, RustTargetGenericArgument>();
  for (const [index, parameter] of parameters.entries()) {
    const argument = arguments_[index]!;
    let identity: string;
    if (parameter.kind === "type" && parameter.type.kind === "type-parameter" && argument.kind === "type") {
      identity = `type:${parameter.type.identity}`;
      types.set(parameter.type.identity, argument.type);
    } else if (parameter.kind === "lifetime" && argument.kind === "lifetime") {
      identity = `lifetime:${rustLifetimeKey(parameter.lifetime)}`;
      lifetimes.set(rustLifetimeKey(parameter.lifetime), argument.lifetime);
    } else if (parameter.kind === "const" && parameter.value.kind === "parameter" && argument.kind === "const") {
      identity = `const:${parameter.value.identity}`;
      consts.set(parameter.value.identity, argument.value);
    } else return undefined;
    const previous = bound.get(identity);
    if (previous !== undefined && !rustTargetGenericArgumentEquals(previous, argument)) return undefined;
    bound.set(identity, argument);
  }
  return Object.freeze({ types, lifetimes, consts });
}

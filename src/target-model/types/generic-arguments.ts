import type { RustLifetimeRef } from "../lifetimes/index.js";
import type {
  RustTargetConstArgument,
  RustTargetGenericArgument,
  RustTargetGenericParameter,
  TargetTypeRef,
} from "./model.js";
import type { RustTargetGenericBindings } from "./carriers/substitution.js";

export function rustTypeGenericArgument(type: TargetTypeRef): RustTargetGenericArgument {
  return Object.freeze({ kind: "type", type });
}

export function rustLifetimeGenericArgument(
  lifetime: RustLifetimeRef,
): RustTargetGenericArgument {
  return Object.freeze({ kind: "lifetime", lifetime });
}

export function rustConstGenericArgument(
  value: RustTargetConstArgument,
): RustTargetGenericArgument {
  return Object.freeze({ kind: "const", value });
}

export function rustTypeGenericArguments(
  types: readonly TargetTypeRef[],
): readonly RustTargetGenericArgument[] {
  return Object.freeze(types.map(rustTypeGenericArgument));
}

export function rustOnlyTypeGenericArguments(
  arguments_: readonly RustTargetGenericArgument[] | undefined,
): readonly TargetTypeRef[] | undefined {
  if (arguments_ === undefined) return Object.freeze([]);
  if (arguments_.some((argument) => argument.kind !== "type")) return undefined;
  return Object.freeze(arguments_.map((argument) =>
    (argument as Extract<RustTargetGenericArgument, { readonly kind: "type" }>).type));
}

export function rustTargetLifetimeArguments(
  arguments_: readonly RustTargetGenericArgument[] | undefined,
): readonly RustLifetimeRef[] {
  return Object.freeze((arguments_ ?? []).flatMap((argument) =>
    argument.kind === "lifetime" ? [argument.lifetime] : []));
}

export function rustTargetConstArguments(
  arguments_: readonly RustTargetGenericArgument[] | undefined,
): readonly RustTargetConstArgument[] {
  return Object.freeze((arguments_ ?? []).flatMap((argument) =>
    argument.kind === "const" ? [argument.value] : []));
}

export function rustTargetGenericTypeArguments(
  arguments_: readonly RustTargetGenericArgument[] | undefined,
): readonly TargetTypeRef[] {
  return Object.freeze((arguments_ ?? []).flatMap((argument) =>
    argument.kind === "type" ? [argument.type] : []));
}

export function rustTargetGenericBindingsForArguments(
  parameters: readonly RustTargetGenericParameter[],
  arguments_: readonly RustTargetGenericArgument[],
): RustTargetGenericBindings | undefined {
  if (parameters.length !== arguments_.length) return undefined;
  const types = new Map<string, TargetTypeRef>();
  const lifetimes = new Map<string, RustLifetimeRef>();
  const consts = new Map<string, RustTargetConstArgument>();
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index]!;
    const argument = arguments_[index]!;
    if (parameter.kind !== argument.kind) return undefined;
    switch (parameter.kind) {
      case "type":
        if (argument.kind !== "type" || types.has(parameter.sourceName)) return undefined;
        types.set(parameter.sourceName, argument.type);
        break;
      case "lifetime":
        if (argument.kind !== "lifetime" || lifetimes.has(parameter.targetIdentity)) return undefined;
        lifetimes.set(parameter.targetIdentity, argument.lifetime);
        break;
      case "const":
        if (argument.kind !== "const" || consts.has(parameter.targetIdentity)) return undefined;
        consts.set(parameter.targetIdentity, argument.value);
        break;
    }
  }
  return Object.freeze({ types, lifetimes, consts });
}

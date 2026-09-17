import { rustLifetimeKey } from "../../../target-model/lifetimes/index.js";
import type { RustProjectTypeDefinition } from "../../../policy/types/project-types.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
export function projectGenericSubstitutions(
  definition: RustProjectTypeDefinition,
  arguments_: readonly import("../../../target-model/types/model.js").RustTargetGenericArgument[] | undefined,
): {
  readonly types: ReadonlyMap<string, TargetTypeRef>;
  readonly lifetimes: ReadonlyMap<string, import("../../../target-model/lifetimes/index.js").RustLifetimeRef>;
} | undefined {
  const values = arguments_ ?? [];
  if (values.length !== definition.genericParameters.length) return undefined;
  const types = new Map<string, TargetTypeRef>();
  const lifetimes = new Map<string, import("../../../target-model/lifetimes/index.js").RustLifetimeRef>();
  for (const [index, parameter] of definition.genericParameters.entries()) {
    const argument = values[index];
    if (parameter.kind === "lifetime") {
      if (argument?.kind !== "lifetime") return undefined;
      lifetimes.set(rustLifetimeKey(parameter.lifetime), argument.lifetime);
      continue;
    }
    if (argument?.kind !== "type") return undefined;
    types.set(parameter.sourceName, argument.type);
  }
  return Object.freeze({ types, lifetimes });
}

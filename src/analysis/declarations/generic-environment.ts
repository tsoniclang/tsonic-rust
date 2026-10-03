import type { AstReader, Node } from "@tsonic/tsts";
import type { RustLifetimeIndex, RustSourceGenericParameterContract } from "../../target-model/lifetimes/index.js";
import { rustLifetimeKey } from "../../target-model/lifetimes/index.js";

export function resolveRustEnclosingGenericParameters(
  declaration: Node,
  identities: readonly string[],
  ast: AstReader,
  lifetimes: RustLifetimeIndex,
): readonly RustSourceGenericParameterContract[] | undefined {
  const requested = new Set(identities);
  if (requested.size === 0) return Object.freeze([]);
  if (requested.size > 65_536) return undefined;
  const available = new Map<string, RustSourceGenericParameterContract>();
  const visited = new Set<Node>();
  let rows = 0;
  for (let owner: Node | undefined = declaration; owner !== undefined; owner = ast.parent(owner)) {
    if (visited.has(owner) || visited.size >= 128) return undefined;
    visited.add(owner);
    for (const parameter of lifetimes.contractFor(owner)?.parameters ?? []) {
      if (++rows > 65_536) return undefined;
      const identity = parameter.kind === "type" ? parameter.identity : rustLifetimeKey(parameter.lifetime);
      if (!available.has(identity)) available.set(identity, parameter);
    }
    for (const identity of requested) {
      for (const lifetime of available.get(identity)?.outlives ?? []) {
        if (lifetime.kind === "parameter") requested.add(rustLifetimeKey(lifetime));
      }
      if (requested.size > 65_536) return undefined;
    }
    if ([...requested].every(identity => available.has(identity))) break;
  }
  const parameters = [...requested].map(identity => available.get(identity));
  return parameters.some(parameter => parameter === undefined) ? undefined
    : Object.freeze(parameters as RustSourceGenericParameterContract[]);
}

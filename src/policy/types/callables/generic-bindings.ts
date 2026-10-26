import { rustLifetimeKey } from "../../../target-model/lifetimes/index.js";
import type { RustTargetGenericArgument, RustTargetGenericParameter } from "../../../target-model/types/model.js";
import type { RustTargetGenericBindings } from "../../../target-model/types/carriers/generic-inference.js";
import { rustTargetGenericBindingsForArguments } from "../../../target-model/types/generic-arguments.js";

import { snapshotClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import { snapshotTargetReadonlyMap } from "@tsonic/target-api/analysis";

export function rustGenericCallablePhysicalBindings(
  parameters: readonly RustTargetGenericArgument[], arguments_: readonly RustTargetGenericArgument[],
): RustTargetGenericBindings | undefined {
  const selected: RustTargetGenericParameter[] = [];
  for (const argument of parameters) {
    if (argument.kind === "type" && argument.type.kind === "type-parameter")
      selected.push({ kind: "type", sourceName: argument.type.name, targetIdentity: argument.type.identity });
    else if (argument.kind === "lifetime" && (argument.lifetime.kind === "parameter" || argument.lifetime.kind === "bound"))
      selected.push({ kind: "lifetime", sourceName: argument.lifetime.name, targetIdentity: rustLifetimeKey(argument.lifetime) });
    else if (argument.kind === "const" && argument.value.kind === "parameter")
      selected.push({ kind: "const", sourceName: argument.value.name, targetIdentity: argument.value.identity });
    else return undefined;
  }
  return rustTargetGenericBindingsForArguments(selected, arguments_);
}

export function snapshotRustCallableBindings(bindings: RustTargetGenericBindings): RustTargetGenericBindings {
  return Object.freeze({ types: readonlyMap(bindings.types), lifetimes: readonlyMap(bindings.lifetimes),
    consts: readonlyMap(bindings.consts) });
}

function readonlyMap<Key, Value>(entries: ReadonlyMap<Key, Value>): ReadonlyMap<Key, Value> {
  return snapshotTargetReadonlyMap([...entries].map(([key, value]) => [key, snapshotClosedMetadata(value)] as const));
}

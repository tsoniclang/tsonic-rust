import { rustLifetimeKey } from "../../../target-model/lifetimes/index.js";
import type { RustTargetGenericArgument, RustTargetGenericParameter } from "../../../target-model/types/model.js";
import type { RustTargetGenericBindings } from "../../../target-model/types/carriers/generic-inference.js";
import { rustTargetGenericBindingsForArguments } from "../../../target-model/types/generic-arguments.js";

import { snapshotClosedMetadata } from "../../../target-model/metadata/closed-data.js";

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
  const values = new Map([...entries].map(([key, value]) => [key, snapshotClosedMetadata(value)]));
  const view: ReadonlyMap<Key, Value> = Object.freeze({
    size: values.size,
    get: (key: Key) => values.get(key),
    has: (key: Key) => values.has(key),
    entries: () => values.entries(),
    keys: () => values.keys(),
    values: () => values.values(),
    [Symbol.iterator]: () => values[Symbol.iterator](),
    [Symbol.toStringTag]: "ReadonlyMap",
    forEach(callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void, thisArg?: unknown) {
      values.forEach((value, key) => callback.call(thisArg, value, key, view));
    },
  });
  return view;
}

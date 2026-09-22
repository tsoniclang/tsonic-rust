import type { RustLifetimeRef, RustSourceGenericContract } from "../../target-model/lifetimes/index.js";
import { rustLifetimeKey, rustLifetimeOutlives, rustStaticLifetime } from "../../target-model/lifetimes/index.js";
import { rustTargetGenericReferences } from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function selectRustSuspendedStorageLifetime(
  carriers: readonly TargetTypeRef[],
  contract: RustSourceGenericContract | undefined,
): RustLifetimeRef | undefined {
  const candidates = new Map<string, RustLifetimeRef>();
  for (const carrier of carriers) {
    const references = rustTargetGenericReferences(carrier);
    if (references.hasUnnameableLifetime) return undefined;
    for (const lifetime of references.lifetimes) candidates.set(rustLifetimeKey(lifetime), lifetime);
    for (const name of references.typeNames) {
      const parameter = contract?.parameters.find(parameter => parameter.kind === "type" && parameter.targetName === name);
      for (const lifetime of parameter?.kind === "type" ? parameter.outlives : []) {
        if (lifetime.kind !== "static") candidates.set(rustLifetimeKey(lifetime), lifetime);
      }
    }
  }
  if (candidates.size === 0) return rustStaticLifetime;
  if (contract === undefined) return undefined;
  const selected = [...candidates.values()].filter(candidate =>
    [...candidates.values()].every(source => rustLifetimeOutlives(source, candidate, contract)));
  return selected.length === 1 ? selected[0] : undefined;
}

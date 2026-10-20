import type { RustLifetimeRef, RustSourceGenericContract } from "../../target-model/lifetimes/index.js";
import { rustLifetimeKey, rustStaticLifetime, rustPlaceholderLifetime } from "../../target-model/lifetimes/index.js";
import { rustLifetimeOutlives } from "../constraints/lifetime-outlives.js";
import { rustSingleElidedInput } from "../types/callables/lifetime-elision.js";
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
    for (const identity of references.typeIdentities) {
      const parameter = contract?.parameters.find(parameter => parameter.kind === "type" && parameter.identity === identity);
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

export function selectRustCallableStorageLifetime(
  parameters: readonly TargetTypeRef[],
  stored: readonly TargetTypeRef[],
  contract: RustSourceGenericContract | undefined,
): RustLifetimeRef | undefined {
  const selected = selectRustSuspendedStorageLifetime(stored, contract);
  if (selected !== undefined) return selected;
  return rustSingleElidedInput(parameters) !== undefined && stored.every(carrier => {
    const references = rustTargetGenericReferences(carrier);
    return references.callScopedElisions.length === 0 && references.lifetimes.length === 0;
  }) ? rustPlaceholderLifetime : undefined;
}

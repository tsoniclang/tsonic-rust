import type { TargetTypeRef } from "./model.js";

/**
 * A placeholder lifetime is inferred by rustc where it is written (for example the callable of a local
 * `(() => int32)[]` annotation or an authored `(value: number) => void` field type), so it takes the target's lifetime
 * at the same named generic position. The walk follows named generic arguments only; any other shape difference
 * leaves the source unchanged, so equality with the target still decides.
 */
export function rustCarrierWithTargetPlaceholderLifetimes(source: TargetTypeRef, target: TargetTypeRef): TargetTypeRef {
  if (source.kind !== "target-named" || target.kind !== "target-named" || source.id !== target.id) return source;
  const sourceArguments = source.genericArguments ?? [];
  const targetArguments = target.genericArguments ?? [];
  if (sourceArguments.length !== targetArguments.length || sourceArguments.length === 0) return source;
  let changed = false;
  const genericArguments = sourceArguments.map((argument, index) => {
    const selected = targetArguments[index]!;
    if (argument.kind === "lifetime" && selected.kind === "lifetime" && argument.lifetime.kind === "placeholder" &&
      selected.lifetime.kind !== "placeholder") {
      changed = true;
      return selected;
    }
    if (argument.kind === "type" && selected.kind === "type") {
      const type = rustCarrierWithTargetPlaceholderLifetimes(argument.type, selected.type);
      if (type !== argument.type) {
        changed = true;
        return { kind: "type" as const, type };
      }
    }
    return argument;
  });
  return changed ? { ...source, genericArguments } : source;
}

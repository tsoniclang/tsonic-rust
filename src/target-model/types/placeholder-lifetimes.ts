import type { TargetTypeRef } from "./model.js";
import type { RustLifetimeRef } from "../lifetimes/model.js";
import { rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "./carriers/source-types.js";

/**
 * A placeholder lifetime is inferred by rustc where it is written (for example the callable of a local
 * `(() => int32)[]` annotation or an authored `(value: number) => void` field type), so it takes the target's lifetime
 * at the same position. The walk follows named generic arguments and the fields and construction of structural objects
 * with the same owner and field names; any other shape difference leaves the source unchanged, so equality with the
 * target still decides. `accepts` limits which target lifetimes may fill a placeholder.
 */
export function rustCarrierWithTargetPlaceholderLifetimes(source: TargetTypeRef, target: TargetTypeRef,
  accepts: (lifetime: RustLifetimeRef) => boolean = () => true): TargetTypeRef {
  const sourceObject = rustStructuralObjectCarrierValue(source);
  const targetObject = rustStructuralObjectCarrierValue(target);
  if (sourceObject !== undefined && targetObject !== undefined) {
    if (sourceObject.ownerFileName !== targetObject.ownerFileName || sourceObject.representation !== targetObject.representation ||
      sourceObject.fields.length !== targetObject.fields.length ||
      sourceObject.fields.some((field, index) => field.sourceName !== targetObject.fields[index]!.sourceName) ||
      (sourceObject.construction === undefined) !== (targetObject.construction === undefined)) return source;
    let changed = false;
    const fields = sourceObject.fields.map((field, index) => {
      const type = rustCarrierWithTargetPlaceholderLifetimes(field.type, targetObject.fields[index]!.type, accepts);
      if (type === field.type) return field;
      changed = true;
      return { ...field, type };
    });
    const construction = sourceObject.construction === undefined || targetObject.construction === undefined ? sourceObject.construction
      : rustCarrierWithTargetPlaceholderLifetimes(sourceObject.construction, targetObject.construction, accepts);
    if (construction !== sourceObject.construction) changed = true;
    return changed
      ? rustStructuralObjectTargetType(sourceObject.ownerFileName, fields, sourceObject.representation, construction, sourceObject.bases)
      : source;
  }
  if (source.kind !== "target-named" || target.kind !== "target-named" || source.id !== target.id) return source;
  const sourceArguments = source.genericArguments ?? [];
  const targetArguments = target.genericArguments ?? [];
  if (sourceArguments.length !== targetArguments.length || sourceArguments.length === 0) return source;
  let changed = false;
  const genericArguments = sourceArguments.map((argument, index) => {
    const selected = targetArguments[index]!;
    if (argument.kind === "lifetime" && selected.kind === "lifetime" && argument.lifetime.kind === "placeholder" &&
      selected.lifetime.kind !== "placeholder" && accepts(selected.lifetime)) {
      changed = true;
      return selected;
    }
    if (argument.kind === "type" && selected.kind === "type") {
      const type = rustCarrierWithTargetPlaceholderLifetimes(argument.type, selected.type, accepts);
      if (type !== argument.type) {
        changed = true;
        return { kind: "type" as const, type };
      }
    }
    return argument;
  });
  return changed ? { ...source, genericArguments } : source;
}

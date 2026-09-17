import type { TargetTypeRef } from "../types/model.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";
import { rustOnlyTypeGenericArguments } from "../types/generic-arguments.js";
import { rustEmptyObjectTargetId, rustObjectIdentityTargetId, rustJsArrayTargetId, rustOptionTargetId } from "../types/carriers/source-types.js";

export function rustObjectIdentityErasureMatches(source: TargetTypeRef, target: TargetTypeRef): boolean {
  if (rustTargetTypeRefEquals(source, target)) return true;
  if (source.kind === "array" && target.kind === "array") {
    return source.rank === target.rank && rustObjectIdentityErasureMatches(source.element, target.element);
  }
  if (source.kind === "tuple" && target.kind === "tuple") {
    return source.elements.length === target.elements.length &&
      source.elements.every((element, index) => rustObjectIdentityErasureMatches(element, target.elements[index]!));
  }
  if (source.kind !== "target-named" || target.kind !== "target-named") return false;
  const sourceArguments = rustOnlyTypeGenericArguments(source.genericArguments);
  const targetArguments = rustOnlyTypeGenericArguments(target.genericArguments);
  if (source.id === rustEmptyObjectTargetId && target.id === rustObjectIdentityTargetId) {
    return sourceArguments?.length === 0 && targetArguments?.length === 0;
  }
  return source.id === target.id && (source.id === rustJsArrayTargetId || source.id === rustOptionTargetId) &&
    sourceArguments?.length === 1 && targetArguments?.length === 1 &&
    rustObjectIdentityErasureMatches(sourceArguments[0]!, targetArguments[0]!);
}

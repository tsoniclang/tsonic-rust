import type { RustTargetGenericArgument, TargetTypeRef } from "../types/model.js";
import { rustTargetGenericArgumentEquals, rustTargetTypeRefEquals } from "../types/equality.js";
import { rustLifetimesEqual } from "../lifetimes/index.js";
import { isRustAbsenceCarrier, isRustUnitCarrier } from "../types/carriers/js.js";
import { rustEmptyObjectTargetId, rustObjectIdentityTargetId } from "../types/carriers/source-types.js";

export function rustNativeRepresentationMatches(source: TargetTypeRef, target: TargetTypeRef): boolean {
  if (rustTargetTypeRefEquals(source, target)) return true;
  if (isRustAbsenceCarrier(source) && isRustUnitCarrier(target)) return true;
  if (source.kind === "array" && target.kind === "array") {
    return source.rank === target.rank && rustNativeRepresentationMatches(source.element, target.element);
  }
  if (source.kind === "tuple" && target.kind === "tuple") {
    return source.elements.length === target.elements.length &&
      source.elements.every((element, index) => rustNativeRepresentationMatches(element, target.elements[index]!));
  }
  if (source.kind !== "target-named" || target.kind !== "target-named") return false;
  if (source.sourceAbsence !== target.sourceAbsence) return false;
  const sourceArguments = source.genericArguments ?? [];
  const targetArguments = target.genericArguments ?? [];
  if (source.id === rustEmptyObjectTargetId && target.id === rustObjectIdentityTargetId) {
    return sourceArguments.length === 0 && targetArguments.length === 0;
  }
  return source.id === target.id && sourceArguments.length === targetArguments.length &&
    sourceArguments.every((argument, index) => nativeArgumentMatches(argument, targetArguments[index]!));
}

function nativeArgumentMatches(source: RustTargetGenericArgument, target: RustTargetGenericArgument): boolean {
  if (source.kind === "type") return target.kind === "type" && rustNativeRepresentationMatches(source.type, target.type);
  if (source.kind === "lifetime") {
    return target.kind === "lifetime" && (rustLifetimesEqual(source.lifetime, target.lifetime) ||
      target.lifetime.kind === "placeholder" && source.lifetime.kind !== "bound");
  }
  return rustTargetGenericArgumentEquals(source, target);
}

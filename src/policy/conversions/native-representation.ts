import type { RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetGenericArgumentEquals, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustLifetimesEqual } from "../../target-model/lifetimes/index.js";
import { isRustUnitCarrier } from "../../target-model/types/carriers/js.js";
import { isRustAbsenceCarrier } from "../../target-model/types/carriers/native.js";
import { rustEmptyObjectTargetId, rustObjectIdentityTargetId, rustProgramErrorTargetId, rustSourceUnionCarrierValue } from "../../target-model/types/carriers/source-types.js";

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
  const sourceUnion = rustSourceUnionCarrierValue(source);
  const targetUnion = rustSourceUnionCarrierValue(target);
  if (sourceUnion !== undefined || targetUnion !== undefined) {
    if (sourceUnion === undefined || targetUnion === undefined ||
      sourceUnion.origin !== targetUnion.origin || sourceUnion.fileName !== targetUnion.fileName ||
      sourceUnion.typeName !== targetUnion.typeName ||
      sourceUnion.genericArguments.length !== targetUnion.genericArguments.length ||
      !sourceUnion.genericArguments.every((argument, index) =>
        nativeArgumentMatches(argument, targetUnion.genericArguments[index]!)) ||
      sourceUnion.payloads.kind !== "physical" || targetUnion.payloads.kind !== "physical") return false;
    const sourcePayloads = sourceUnion.payloads.types;
    const targetPayloads = targetUnion.payloads.types;
    return sourcePayloads.length === targetPayloads.length && sourcePayloads.every((payload, index) =>
      rustNativeRepresentationMatches(payload, targetPayloads[index]!));
  }
  if (source.kind !== "target-named" || target.kind !== "target-named") return false;
  if (source.id === rustProgramErrorTargetId || target.id === rustProgramErrorTargetId) return false;
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
      target.lifetime.kind === "placeholder" && source.lifetime.kind !== "bound" ||
      source.lifetime.kind === "placeholder" && target.lifetime.kind === "call-scoped-elision");
  }
  return rustTargetGenericArgumentEquals(source, target);
}

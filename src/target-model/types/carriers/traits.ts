import { isRustBigIntCarrier, isRustJsStringCarrier, isRustNullCarrier, isRustStringCarrier, isRustUndefinedCarrier, isRustUnitCarrier } from "./js.js";
import { isRustIntegerCarrier, rustFutureTargetId, rustPrimitiveTypeName } from "./primitives.js";
import { rustBigIntTargetId, rustCallableTargetId, rustJsArrayTargetId, rustJsDateTargetId, rustJsErrorTargetId, rustJsMapTargetId, rustJsRegExpExecArrayTargetId, rustJsRegExpIndicesTargetId, rustJsRegExpMatchArrayTargetId, rustJsRegExpNamedGroupsTargetId, rustJsRegExpNamedIndicesTargetId, rustJsRegExpStringIteratorTargetId, rustJsRegExpTargetId, rustJsSetTargetId, rustJsStringTargetId, rustJsValueTargetId, rustLocationTargetId, rustNullTargetId, rustOptionTargetId, rustProgramErrorTargetId, rustRegExpExecArrayTargetId, rustRegExpIndicesTargetId, rustRegExpMatchArrayTargetId, rustRegExpNamedGroupsTargetId, rustRegExpNamedIndicesTargetId, rustRegExpStringIteratorTargetId, rustSourceTypeCarrierValue, rustSourceUnionCarrierValue, rustStringTargetId, rustStructuralObjectCarrierValue, rustUndefinedTargetId } from "./source-types.js";
import { rustFixedArrayCarrierValue, rustNamedTypeCarrierValue } from "./native.js";
import type { RustNamedTypeCarrierValue } from "./native.js";
import type { TargetTypeRef } from "../model.js";
import {
  rustOnlyTypeGenericArguments,
  rustTargetGenericTypeArguments,
} from "../generic-arguments.js";

export function isRustCopyCarrier(carrier: TargetTypeRef | undefined): boolean {
  if (carrier === undefined) {
    return false;
  }
  if (carrier.kind === "source-primitive" || carrier.kind === "function-pointer" ||
    carrier.kind === "pointer" || carrier.kind === "reference" && carrier.mutable === false) {
    return true;
  }
  if (carrier.kind === "tuple") {
    return carrier.elements.every(isRustCopyCarrier);
  }
  if (carrier.kind === "target-named") {
    if (carrier.id === rustOptionTargetId) {
      const [value] = rustOnlyTypeGenericArguments(carrier.genericArguments) ?? [];
      return value !== undefined && isRustCopyCarrier(value);
    }
    if (rustUnconditionallyCopyTargetIds.has(carrier.id)) {
      return true;
    }
  }
  const fixedArray = rustFixedArrayCarrierValue(carrier);
  if (fixedArray !== undefined) {
    return isRustCopyCarrier(fixedArray.element);
  }
  const namedType = rustNamedTypeCarrierValue(carrier);
  if (namedType !== undefined) {
    return rustNamedTypeSupportsTrait(namedType, "core::marker::Copy");
  }
  return rustSourceTypeCarrierValue(carrier)?.shape === "enum";
}

const rustUnconditionallyCopyTargetIds: ReadonlySet<string> = new Set([
  rustNullTargetId,
  rustUndefinedTargetId,
]);

export function isRustJsStrictEqualityCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && rustJsStrictEqualityTargetIds.has(carrier.id);
}

export function rustCarrierSupportsClone(carrier: TargetTypeRef | undefined): boolean {
  if (carrier === undefined || carrier.kind === "type-parameter" ||
    carrier.kind === "associated-type" ||
    carrier.kind === "opaque" || carrier.kind === "closure" ||
    carrier.kind === "slice" ||
    carrier.kind === "reference" && carrier.mutable) {
    return false;
  }
  if (carrier.kind === "source-primitive" || carrier.kind === "function-pointer" ||
    carrier.kind === "pointer" || carrier.kind === "reference") {
    return true;
  }
  if (carrier.kind === "array") {
    return rustCarrierSupportsClone(carrier.element);
  }
  if (carrier.kind === "tuple") {
    return carrier.elements.every(rustCarrierSupportsClone);
  }
  if (carrier.kind === "target-named") {
    if (carrier.id === rustOptionTargetId) {
      const [value] = rustOnlyTypeGenericArguments(carrier.genericArguments) ?? [];
      return value !== undefined && rustCarrierSupportsClone(value);
    }
    return rustUnconditionallyCloneTargetIds.has(carrier.id);
  }
  const fixedArray = rustFixedArrayCarrierValue(carrier);
  if (fixedArray !== undefined) {
    return rustCarrierSupportsClone(fixedArray.element);
  }
  const namedType = rustNamedTypeCarrierValue(carrier);
  if (namedType !== undefined) {
    return rustNamedTypeSupportsTrait(namedType, "core::clone::Clone");
  }
  const structuralObject = rustStructuralObjectCarrierValue(carrier);
  if (structuralObject !== undefined) {
    return structuralObject.fields.every((field) => rustCarrierSupportsClone(field.type));
  }
  const sourceUnion = rustSourceUnionCarrierValue(carrier);
  if (sourceUnion !== undefined) {
    return sourceUnion.variants.every((variant) => rustCarrierSupportsClone(variant.carrier));
  }
  return carrier.kind === "target-specific" &&
    carrier.target === "rust" && carrier.name === "source-type";
}

export function rustCarrierReferentMutationRequiresMutableBinding(
  carrier: TargetTypeRef | undefined,
): boolean {
  return rustStructuralObjectCarrierValue(carrier) === undefined &&
    rustSourceUnionCarrierValue(carrier) === undefined;
}

const rustEqHashTraitPaths: ReadonlySet<string> = new Set([
  "core::cmp::Eq",
  "core::hash::Hash",
]);

const rustStringTraitPaths: ReadonlySet<string> = new Set([
  "core::cmp::Eq",
  "core::hash::Hash",
]);

const rustUnconditionallyEqHashTargetIds: ReadonlySet<string> = new Set([
  rustStringTargetId,
  rustBigIntTargetId,
  rustNullTargetId,
  rustUndefinedTargetId,
]);

export function rustCarrierSupportsTrait(
  carrier: TargetTypeRef | undefined,
  traitPath: string,
  typeParameterSupports: (name: string, traitPath: string) => boolean = () => false,
): boolean {
  if (carrier === undefined) {
    return false;
  }
  if (carrier.kind === "type-parameter") {
    return typeParameterSupports(carrier.name, traitPath);
  }
  if (traitPath === "core::default::Default") {
    return rustCarrierSupportsDefault(carrier, typeParameterSupports);
  }
  if (traitPath === "core::clone::Clone") {
    return rustCarrierSupportsClone(carrier);
  }
  if (traitPath === "core::marker::Copy") {
    return isRustCopyCarrier(carrier);
  }
  if (carrier.kind === "target-named" && carrier.id === rustFutureTargetId) {
    return traitPath === "core::future::future::Future";
  }
  if (carrier.kind === "source-primitive") {
    return carrier.name !== "float32" && carrier.name !== "float64" &&
      rustEqHashTraitPaths.has(traitPath) &&
      (carrier.name === "bool" || carrier.name === "char" || isRustIntegerCarrier(carrier));
  }
  if (carrier.kind === "target-named" && rustUnconditionallyEqHashTargetIds.has(carrier.id)) {
    return rustStringTraitPaths.has(traitPath);
  }
  if (carrier.kind === "tuple") {
    return rustEqHashTraitPaths.has(traitPath) &&
      carrier.elements.every((element) => rustCarrierSupportsTrait(element, traitPath));
  }
  if (carrier.kind === "array") {
    return rustEqHashTraitPaths.has(traitPath) && rustCarrierSupportsTrait(carrier.element, traitPath);
  }
  if (carrier.kind === "slice") {
    return rustEqHashTraitPaths.has(traitPath) && rustCarrierSupportsTrait(carrier.element, traitPath);
  }
  const fixedArray = rustFixedArrayCarrierValue(carrier);
  if (fixedArray !== undefined) {
    return rustEqHashTraitPaths.has(traitPath) && rustCarrierSupportsTrait(fixedArray.element, traitPath);
  }
  if (carrier.kind === "target-named" && carrier.id === rustOptionTargetId) {
    const [element] = rustOnlyTypeGenericArguments(carrier.genericArguments) ?? [];
    return rustEqHashTraitPaths.has(traitPath) && element !== undefined &&
      rustCarrierSupportsTrait(element, traitPath);
  }
  const namedType = rustNamedTypeCarrierValue(carrier);
  if (namedType !== undefined) {
    return rustNamedTypeSupportsTrait(namedType, traitPath, typeParameterSupports);
  }
  return false;
}

function rustCarrierSupportsDefault(
  carrier: TargetTypeRef,
  typeParameterSupports: (name: string, traitPath: string) => boolean,
): boolean {
  if (carrier.kind === "type-parameter") {
    return typeParameterSupports(carrier.name, "core::default::Default");
  }
  if (carrier.kind === "source-primitive") {
    return rustPrimitiveTypeName(carrier.name) !== undefined;
  }
  if (carrier.kind === "array") {
    return true;
  }
  if (carrier.kind === "tuple") {
    return carrier.elements.length <= 12 && carrier.elements.every((element) =>
      rustCarrierSupportsTrait(
        element,
        "core::default::Default",
        typeParameterSupports,
      ));
  }
  if (carrier.kind === "target-named") {
    return carrier.id === rustOptionTargetId ||
      rustUnconditionallyDefaultTargetIds.has(carrier.id);
  }
  const fixedArray = rustFixedArrayCarrierValue(carrier);
  if (fixedArray !== undefined) {
    return rustCarrierSupportsTrait(
      fixedArray.element,
      "core::default::Default",
      typeParameterSupports,
    );
  }
  const namedType = rustNamedTypeCarrierValue(carrier);
  return namedType !== undefined && rustNamedTypeSupportsTrait(
    namedType,
    "core::default::Default",
    typeParameterSupports,
  );
}

export function rustNamedTypeSupportsTrait(
  namedType: RustNamedTypeCarrierValue,
  traitPath: string,
  typeParameterSupports: (name: string, traitPath: string) => boolean = () => false,
): boolean {
  const typeArguments = rustTargetGenericTypeArguments(namedType.genericArguments);
  return namedType.traits.implementations.some((implementation) =>
    implementation.traitPath === traitPath && implementation.requirements.every((requirement) => {
      const argument = typeArguments[requirement.typeArgumentIndex];
      return argument !== undefined && rustCarrierSupportsTrait(
        argument,
        requirement.traitPath,
        typeParameterSupports,
      );
    }));
}

export function rustCarrierSupportsJsEquality(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" || isRustStringCarrier(carrier) ||
    isRustJsStringCarrier(carrier) ||
    isRustBigIntCarrier(carrier) || isRustNullCarrier(carrier) ||
    isRustUndefinedCarrier(carrier) ||
    isRustJsStrictEqualityCarrier(carrier);
}

const rustJsStrictEqualityTargetIds: ReadonlySet<string> = new Set([
  rustNullTargetId,
  rustUndefinedTargetId,
  rustJsValueTargetId,
  rustJsArrayTargetId,
  rustJsMapTargetId,
  rustJsSetTargetId,
  rustJsDateTargetId,
  rustJsRegExpTargetId,
]);

const rustUnconditionallyCloneTargetIds: ReadonlySet<string> = new Set([
  rustStringTargetId,
  rustJsStringTargetId,
  rustBigIntTargetId,
  rustCallableTargetId,
  rustLocationTargetId,
  rustNullTargetId,
  rustUndefinedTargetId,
  rustJsValueTargetId,
  rustJsArrayTargetId,
  rustJsMapTargetId,
  rustJsSetTargetId,
  rustJsDateTargetId,
  rustJsRegExpTargetId,
  rustRegExpExecArrayTargetId,
  rustRegExpMatchArrayTargetId,
  rustRegExpIndicesTargetId,
  rustRegExpNamedGroupsTargetId,
  rustRegExpNamedIndicesTargetId,
  rustRegExpStringIteratorTargetId,
  rustJsRegExpExecArrayTargetId,
  rustJsRegExpMatchArrayTargetId,
  rustJsRegExpIndicesTargetId,
  rustJsRegExpNamedGroupsTargetId,
  rustJsRegExpNamedIndicesTargetId,
  rustJsRegExpStringIteratorTargetId,
  rustJsErrorTargetId,
  rustProgramErrorTargetId,
]);

const rustUnconditionallyDefaultTargetIds: ReadonlySet<string> = new Set([
  rustStringTargetId,
  rustJsStringTargetId,
  rustNullTargetId,
  rustUndefinedTargetId,
  rustJsArrayTargetId,
  rustJsMapTargetId,
  rustJsSetTargetId,
]);

export function isRustSourceStringConvertibleCarrier(carrier: TargetTypeRef | undefined): boolean {
  return isRustStringCarrier(carrier) || isRustUnitCarrier(carrier) ||
    isRustNullCarrier(carrier) || isRustUndefinedCarrier(carrier) ||
    isRustBigIntCarrier(carrier) ||
    (carrier?.kind === "target-named" && carrier.id === rustProgramErrorTargetId) ||
    (carrier?.kind === "source-primitive" && carrier.name !== "char");
}

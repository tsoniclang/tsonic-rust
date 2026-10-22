import { isRustMutableJsErrorCarrier, isRustSourceErrorCarrier, rustMutableJsErrorTargetId, rustSourceErrorTargetId, rustWritableSourceErrorTargetId, rustRetainedErrorTargetId, rustWritableRetainedErrorTargetId, isRustRetainedErrorCarrier } from "../../target-model/types/carriers/source-error.js";

import { rustJsArrayValueTargetId } from "../../target-model/types/carriers/array-values.js";
import { isRustIntegerCarrier, rustFutureTargetId, rustPrimitiveTypeName } from "../../target-model/types/carriers/primitives.js";
import { rustInfallibleTargetId, rustRawPointerTargetId } from "../../target-model/types/carriers/source-types.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import { rustClassConstructorInstance } from "../../target-model/types/carriers/class-constructors.js";

import { emptyRustTypeDefinitions, rustSourceUnionDefinitionIdentity, type RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustBigIntTargetId, rustCallableTargetId, rustJsArrayTargetId, rustJsDateTargetId, rustJsErrorTargetId, rustJsMapTargetId, rustJsRegExpExecArrayTargetId, rustJsRegExpIndicesTargetId, rustJsRegExpMatchArrayTargetId, rustJsRegExpNamedGroupsTargetId, rustJsRegExpNamedIndicesTargetId, rustJsRegExpStringIteratorTargetId, rustJsRegExpTargetId, rustJsSetTargetId, rustJsStringTargetId, rustJsValueTargetId, rustLocationTargetId, rustAbsenceTargetId, rustOptionTargetId, rustProgramErrorTargetId, rustRegExpExecArrayTargetId, rustRegExpIndicesTargetId, rustRegExpMatchArrayTargetId, rustRegExpNamedGroupsTargetId, rustRegExpNamedIndicesTargetId, rustRegExpStringIteratorTargetId, rustSourceTypeCarrierValue, rustSourceUnionCarrierValue, rustStringTargetId, rustStrTargetId, rustStructuralObjectCarrierValue, rustTsValueTargetId } from "../../target-model/types/carriers/source-types.js";
import { rustJsArrayEntriesTargetId } from "../../target-model/types/carriers/array-entries.js";
import { rustJsArrayBufferTargetId, rustJsDataViewTargetId, rustJsFloat32ArrayTargetId, rustJsFloat64ArrayTargetId, rustJsInt16ArrayTargetId, rustJsInt32ArrayTargetId, rustJsInt8ArrayTargetId, rustJsIntlCollatorTargetId, rustJsIntlDateTimeFormatTargetId, rustJsIntlNumberFormatTargetId, rustJsIntlNumberFormatPartTargetId, rustJsIntlGroupingTargetId, rustJsPromiseFulfilledResultTargetId, rustJsPromiseRejectedResultTargetId, rustJsPromiseSettledResultTargetId, rustJsPromiseTargetId, rustJsPromiseResolutionTargetId, rustJsSymbolTargetId, rustJsUint16ArrayTargetId, rustJsUint32ArrayTargetId, rustJsUint8ArrayTargetId, rustJsUint8ClampedArrayTargetId, rustJsWeakMapTargetId, rustJsWeakSetTargetId } from "../../target-model/types/carriers/source-types.js";
import { rustFixedArrayCarrierValue, rustNamedTargetType, rustNamedTypeCarrierValue, rustNativeTraitRef, rustNativeTraitRefEquals } from "../../target-model/types/carriers/native.js";
import { rustEmptyObjectTargetId, rustObjectIdentityTargetId, rustJsNumericTargetId, rustJsStringNumberTargetId } from "../../target-model/types/carriers/source-types.js";

import type { RustNamedTypeCarrierValue } from "../../target-model/types/carriers/native.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTargetTraitRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustCarrierSupportsAsRef } from "./as-ref.js";

import { rustRuntimeErrorTargetType } from "../../target-model/types/carriers/runtime-carriers.js";
import { rustProgramErrorOwner } from "../../target-model/types/carriers/program-errors.js";
import { rustOnlyTypeGenericArguments, rustTargetGenericTypeArguments } from "../../target-model/types/generic-arguments.js";

import { rustJsClosedValueCarrierTraitPath } from "../../target-model/types/carriers/traits.js";
export function isRustCopyCarrier(
  carrier: TargetTypeRef | undefined,
  selectedCopy: (carrier: TargetTypeRef) => boolean = () => false,
): boolean {
  if (carrier === undefined) {
    return false;
  }
  if (selectedCopy(carrier)) return true;
  if (carrier.kind === "source-primitive" || carrier.kind === "function-pointer" ||
    carrier.kind === "pointer" || carrier.kind === "reference" && carrier.mutable === false) {
    return true;
  }
  if (carrier.kind === "tuple") {
    return carrier.elements.every(element => isRustCopyCarrier(element, selectedCopy));
  }
  if (carrier.kind === "target-named") {
    if (carrier.id === rustOptionTargetId) {
      const [value] = rustOnlyTypeGenericArguments(carrier.genericArguments) ?? [];
      return value !== undefined && isRustCopyCarrier(value, selectedCopy);
    }
    if (rustUnconditionallyCopyTargetIds.has(carrier.id)) {
      return true;
    }
  }
  const fixedArray = rustFixedArrayCarrierValue(carrier);
  if (fixedArray !== undefined) {
    return isRustCopyCarrier(fixedArray.element, selectedCopy);
  }
  const structural = rustStructuralObjectCarrierValue(carrier);
  if (structural !== undefined) {
    return structural.representation === "value" && structural.fields.every(field => field.bound !== true && isRustCopyCarrier(field.type, selectedCopy));
  }
  const namedType = rustNamedTypeCarrierValue(carrier);
  if (namedType !== undefined) {
    return rustNamedTypeSupportsTrait(namedType, "core::marker::Copy");
  }
  return rustSourceTypeCarrierValue(carrier)?.shape === "enum";
}

const rustUnconditionallyCopyTargetIds: ReadonlySet<string> = new Set([
  rustAbsenceTargetId,
]);

export function rustCarrierSupportsClone(carrier: TargetTypeRef | undefined, definitions: RustTypeDefinitions = emptyRustTypeDefinitions): boolean {
  return supportsCloneWithContracts(carrier, () => false, () => false, definitions);
}

type RustAssociatedTypeSupport = (
  carrier: Extract<TargetTypeRef, { readonly kind: "associated-type" }>,
  traitPath: string,
) => boolean;

function supportsCloneWithContracts(
  carrier: TargetTypeRef | undefined,
  typeParameterSupports: (name: string, traitPath: string) => boolean,
  associatedTypeSupports: RustAssociatedTypeSupport,
  definitions: RustTypeDefinitions,
  active: Map<string, string> = new Map(),
): boolean {
  if (carrier?.kind === "type-parameter") return typeParameterSupports(carrier.identity, "core::clone::Clone");
  if (carrier?.kind === "associated-type") return associatedTypeSupports(carrier, "core::clone::Clone");
  const supports = (type: TargetTypeRef): boolean =>
    supportsCloneWithContracts(type, typeParameterSupports, associatedTypeSupports, definitions, active);
  if (rustGenericCallableValue(carrier) !== undefined || rustFrameCallableValue(carrier) !== undefined ||
    rustClassConstructorInstance(carrier) !== undefined) return true;
  if (carrier === undefined ||
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
    return supports(carrier.element);
  }
  if (carrier.kind === "tuple") {
    return carrier.elements.every(supports);
  }
  if (carrier.kind === "target-named") {
    if (carrier.id === rustOptionTargetId) {
      const [value] = rustOnlyTypeGenericArguments(carrier.genericArguments) ?? [];
      return value !== undefined && supports(value);
    }
    if (carrier.id === rustJsPromiseTargetId) {
      return true;
    }
    if (carrier.id === rustJsPromiseRejectedResultTargetId || carrier.id === rustJsPromiseSettledResultTargetId) {
      const arguments_ = rustOnlyTypeGenericArguments(carrier.genericArguments);
      return arguments_?.length === (carrier.id === rustJsPromiseRejectedResultTargetId ? 0 : 1) && arguments_.every(supports);
    }
    if (carrier.id === rustJsPromiseResolutionTargetId ||
      carrier.id === rustJsPromiseFulfilledResultTargetId) {
      const [value] = rustTargetGenericTypeArguments(carrier.genericArguments);
      return value !== undefined && supports(value);
    }
    return rustUnconditionallyCloneTargetIds.has(carrier.id);
  }
  const fixedArray = rustFixedArrayCarrierValue(carrier);
  if (fixedArray !== undefined) {
    return supports(fixedArray.element);
  }
  const namedType = rustNamedTypeCarrierValue(carrier);
  if (namedType !== undefined) {
    return rustNamedTypeSupportsTrait(namedType, "core::clone::Clone", typeParameterSupports, associatedTypeSupports, definitions, active);
  }
  const structuralObject = rustStructuralObjectCarrierValue(carrier);
  if (structuralObject !== undefined) {
    return structuralObject.fields.every((field) => supports(field.type));
  }
  const sourceUnion = rustSourceUnionCarrierValue(carrier);
  if (sourceUnion !== undefined) {
    const variants = definitions.sourceUnionVariants(carrier);
    if (variants === undefined) return false;
    const identity = rustSourceUnionDefinitionIdentity(carrier)!;
    const instantiation = closedMetadataKey(carrier);
    if (active.has(identity)) return active.get(identity) === instantiation;
    active.set(identity, instantiation);
    try { return variants.every(variant => supports(variant.carrier)); }
    finally { active.delete(identity); }
  }
  return carrier.kind === "target-specific" &&
    carrier.target === "rust" && carrier.name === "source-type";
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
  rustRawPointerTargetId,
  rustStringTargetId,
  rustStrTargetId,
  rustBigIntTargetId,
  rustAbsenceTargetId,
]);

export function rustCarrierSupportsTrait(
  carrier: TargetTypeRef | undefined,
  traitPath: string,
  typeParameterSupports: (name: string, traitPath: string) => boolean = () => false,
  associatedTypeSupports: RustAssociatedTypeSupport = () => false,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
  active: Map<string, string> = new Map(),
): boolean {
  if (carrier === undefined) {
    return false;
  }
  if (carrier.kind === "type-parameter") {
    return typeParameterSupports(carrier.identity, traitPath);
  }
  if (carrier.kind === "associated-type") return associatedTypeSupports(carrier, traitPath);
  if (traitPath === "core::default::Default") {
    return rustCarrierSupportsDefault(carrier, typeParameterSupports, associatedTypeSupports, definitions);
  }
  if (traitPath === "core::clone::Clone") {
    return supportsCloneWithContracts(carrier, typeParameterSupports, associatedTypeSupports, definitions, active);
  }
  if (carrier.kind === "target-named" && carrier.id === rustTsValueTargetId) {
    return traitPath === "core::cmp::PartialEq";
  }
  if (traitPath === rustJsClosedValueCarrierTraitPath && carrier.kind === "target-named" &&
    carrier.id === rustEmptyObjectTargetId && (carrier.genericArguments?.length ?? 0) === 0) {
    return true;
  }
  if (traitPath === "core::marker::Copy") {
    const supports = (type: TargetTypeRef): boolean =>
      rustCarrierSupportsTrait(type, traitPath, typeParameterSupports, associatedTypeSupports, definitions);
    const structural = rustStructuralObjectCarrierValue(carrier);
    if (structural !== undefined) return structural.representation === "value" && structural.fields.every(field => field.bound !== true && supports(field.type));
    if (carrier.kind === "tuple") return carrier.elements.every(supports);
    const fixedArray = rustFixedArrayCarrierValue(carrier);
    if (fixedArray !== undefined) return supports(fixedArray.element);
    if (carrier.kind === "target-named" && carrier.id === rustOptionTargetId) {
      const parameters = rustOnlyTypeGenericArguments(carrier.genericArguments);
      return parameters?.length === 1 && supports(parameters[0]!);
    }
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
      carrier.elements.every((element) => rustCarrierSupportsTrait(element, traitPath, typeParameterSupports, associatedTypeSupports, definitions));
  }
  if (carrier.kind === "array") {
    return rustEqHashTraitPaths.has(traitPath) && rustCarrierSupportsTrait(carrier.element, traitPath, typeParameterSupports, associatedTypeSupports, definitions);
  }
  if (carrier.kind === "slice") {
    return rustEqHashTraitPaths.has(traitPath) && rustCarrierSupportsTrait(carrier.element, traitPath, typeParameterSupports, associatedTypeSupports, definitions);
  }
  const fixedArray = rustFixedArrayCarrierValue(carrier);
  if (fixedArray !== undefined) {
    return rustEqHashTraitPaths.has(traitPath) && rustCarrierSupportsTrait(fixedArray.element, traitPath, typeParameterSupports, associatedTypeSupports, definitions);
  }
  if (carrier.kind === "target-named" && carrier.id === rustOptionTargetId) {
    const [element] = rustOnlyTypeGenericArguments(carrier.genericArguments) ?? [];
    return rustEqHashTraitPaths.has(traitPath) && element !== undefined &&
      rustCarrierSupportsTrait(element, traitPath, typeParameterSupports, associatedTypeSupports, definitions);
  }
  const namedType = rustNamedTypeCarrierValue(carrier);
  if (namedType !== undefined) {
    return rustNamedTypeSupportsTrait(namedType, traitPath, typeParameterSupports, associatedTypeSupports, definitions);
  }
  return false;
}

export function rustCarrierSatisfiesTraitRef(
  carrier: TargetTypeRef | undefined,
  trait: RustTargetTraitRef,
  typeParameterSupports: (name: string, traitPath: string) => boolean = () => false,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): boolean {
  const named = rustNamedTypeCarrierValue(carrier);
  if (named !== undefined && rustNamedTypeSatisfiesTraitRef(named, trait, typeParameterSupports, undefined, definitions)) {
    return true;
  }
  if (trait.lifetimeBinder !== undefined || trait.associatedConstraints.length > 0) {
    return false;
  }
  if (trait.genericArguments.length === 0) {
    return rustCarrierSupportsTrait(carrier, trait.path, typeParameterSupports, undefined, definitions);
  }
  const [argument] = trait.genericArguments;
  if (carrier !== undefined && trait.path === "core::convert::Into" &&
    trait.genericArguments.length === 1 && argument?.kind === "type" &&
    argument.type.kind === "target-named" && argument.type.id === rustRetainedErrorTargetId &&
    (argument.type.genericArguments?.length ?? 0) === 0) {
    const owner = rustProgramErrorOwner(carrier);
    // The runtime converts each of these into RetainedError (`From<...> for RetainedError`), Infallible included.
    return rustTargetTypeRefEquals(carrier, rustRuntimeErrorTargetType()) ||
      carrier.kind === "target-named" && carrier.id === rustInfallibleTargetId ||
      owner?.kind === "physical" && owner.domain === "runtime" ||
      carrier.kind === "target-named" && carrier.id === rustJsErrorTargetId &&
        (carrier.genericArguments?.length ?? 0) === 0 ||
      isRustMutableJsErrorCarrier(carrier) || isRustSourceErrorCarrier(carrier) || isRustRetainedErrorCarrier(carrier);
  }
  if (carrier !== undefined && trait.path === "core::convert::AsRef" &&
    trait.genericArguments.length === 1 && argument?.kind === "type") {
    return rustCarrierSupportsAsRef(carrier, argument.type);
  }
  return carrier !== undefined &&
    trait.path === "core::borrow::Borrow" &&
    trait.genericArguments.length === 1 &&
    argument?.kind === "type" &&
    (rustTargetTypeRefEquals(carrier, argument.type) ||
      carrier.kind === "target-named" && carrier.id === rustStringTargetId &&
      argument.type.kind === "target-named" && argument.type.id === rustStrTargetId);
}

function rustCarrierSupportsDefault(
  carrier: TargetTypeRef,
  typeParameterSupports: (name: string, traitPath: string) => boolean,
  associatedTypeSupports: RustAssociatedTypeSupport,
  definitions: RustTypeDefinitions,
): boolean {
  if (carrier.kind === "type-parameter") {
    return typeParameterSupports(carrier.identity, "core::default::Default");
  }
  const structural = rustStructuralObjectCarrierValue(carrier);
  if (structural !== undefined) {
    return structural.representation === "value" && structural.fields.every(field =>
      rustCarrierSupportsTrait(field.type, "core::default::Default", typeParameterSupports, associatedTypeSupports, definitions));
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
        associatedTypeSupports, definitions,
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
      associatedTypeSupports, definitions,
    );
  }
  const namedType = rustNamedTypeCarrierValue(carrier);
  return namedType !== undefined && rustNamedTypeSupportsTrait(
    namedType,
    "core::default::Default",
    typeParameterSupports,
    associatedTypeSupports, definitions,
  );
}

export function rustNamedTypeSupportsTrait(
  namedType: RustNamedTypeCarrierValue,
  traitPath: string,
  typeParameterSupports: (name: string, traitPath: string) => boolean = () => false,
  associatedTypeSupports: RustAssociatedTypeSupport = () => false,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
  active: Map<string, string> = new Map(),
): boolean {
  return rustNamedTypeSatisfiesTraitRef(namedType, rustNativeTraitRef(traitPath), typeParameterSupports,
    associatedTypeSupports, definitions, active);
}

function rustNamedTypeSatisfiesTraitRef(
  namedType: RustNamedTypeCarrierValue,
  trait: RustTargetTraitRef,
  typeParameterSupports: (name: string, traitPath: string) => boolean = () => false,
  associatedTypeSupports: RustAssociatedTypeSupport = () => false,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
  active: Map<string, string> = new Map(),
): boolean {
  const typeArguments = rustTargetGenericTypeArguments(namedType.genericArguments);
  const nativeDefault = (selected: RustTargetTraitRef): RustTargetTraitRef =>
    (selected.path === "core::cmp::PartialEq" || selected.path === "core::cmp::PartialOrd") &&
      selected.genericArguments.length === 0
      ? { ...selected, genericArguments: [{ kind: "type", type: rustNamedTargetType(
        namedType.id, namedType.path, namedType.genericArguments, namedType.genericDefaults) }] }
      : selected;
  const required = nativeDefault(trait);
  return namedType.traits.implementations.some((implementation) =>
    rustNativeTraitRefEquals(nativeDefault(implementation.trait), required) && implementation.requirements.every((requirement) => {
      const argument = typeArguments[requirement.typeArgumentIndex];
      if (argument === undefined) return false;
      return requirement.trait.genericArguments.length === 0 && requirement.trait.associatedConstraints.length === 0 &&
          requirement.trait.lifetimeBinder === undefined
        ? rustCarrierSupportsTrait(argument, requirement.trait.path, typeParameterSupports,
          associatedTypeSupports, definitions, active)
        : rustCarrierSatisfiesTraitRef(argument, requirement.trait, typeParameterSupports, definitions);
    }));
}

const rustUnconditionallyCloneTargetIds: ReadonlySet<string> = new Set([
  rustJsArrayValueTargetId,
  rustJsArrayEntriesTargetId,
  rustJsStringNumberTargetId,
  rustJsNumericTargetId,
  rustEmptyObjectTargetId,
  rustObjectIdentityTargetId,
  rustJsIntlGroupingTargetId,
  rustJsIntlNumberFormatPartTargetId,
  rustRawPointerTargetId,
  rustStringTargetId,
  rustJsStringTargetId,
  rustBigIntTargetId,
  rustCallableTargetId,
  rustLocationTargetId,
  rustAbsenceTargetId,
  rustTsValueTargetId,
  rustJsValueTargetId,
  rustJsArrayTargetId,
  rustJsMapTargetId,
  rustJsSetTargetId,
  rustJsDateTargetId,
  rustJsPromiseTargetId,
  rustJsSymbolTargetId,
  rustJsWeakMapTargetId,
  rustJsWeakSetTargetId,
  rustJsArrayBufferTargetId,
  rustJsDataViewTargetId,
  rustJsInt8ArrayTargetId,
  rustJsUint8ArrayTargetId,
  rustJsUint8ClampedArrayTargetId,
  rustJsInt16ArrayTargetId,
  rustJsUint16ArrayTargetId,
  rustJsInt32ArrayTargetId,
  rustJsUint32ArrayTargetId,
  rustJsFloat32ArrayTargetId,
  rustJsFloat64ArrayTargetId,
  rustJsIntlDateTimeFormatTargetId,
  rustJsIntlNumberFormatTargetId,
  rustJsIntlCollatorTargetId,
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
  rustSourceErrorTargetId,
  rustWritableSourceErrorTargetId,
  rustMutableJsErrorTargetId,
  rustRetainedErrorTargetId,
  rustWritableRetainedErrorTargetId,
]);

const rustUnconditionallyDefaultTargetIds: ReadonlySet<string> = new Set([
  rustJsArrayValueTargetId,
  rustStringTargetId,
  rustJsStringTargetId,
  rustAbsenceTargetId,
  rustTsValueTargetId,
  rustJsValueTargetId,
  rustJsArrayTargetId,
  rustJsMapTargetId,
  rustJsSetTargetId,
  rustJsWeakMapTargetId,
  rustJsWeakSetTargetId,
]);

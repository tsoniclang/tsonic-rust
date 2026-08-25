import type {
  RustBinder,
  RustBound,
  RustSemanticIdentity,
  RustTraitRef,
} from "../../semantics/index.js";
import { closedMetadataEquals } from "../../metadata/closed-data.js";
import {
  rustBuiltinIdentity,
  rustSemanticIdentitiesEqual,
  rustSemanticIdentityItemId,
} from "../../semantics/index.js";
import {
  rustPathTypeArguments,
  rustPathTypeMatches,
} from "../constructors.js";
import {
  rustTargetTypeRefEquals,
  rustTraitReferenceEquals,
} from "../equality.js";
import type { TargetTypeRef } from "../model.js";
import {
  isRustBigIntCarrier,
  isRustJsStringCarrier,
  isRustNullCarrier,
  isRustStringCarrier,
  isRustUndefinedCarrier,
  isRustUnitCarrier,
} from "./js.js";
import { rustPrimitiveTypeName } from "./primitives.js";
import {
  rustBigIntTargetId,
  rustBorrowedLocalAsyncCallableTargetId,
  rustBorrowedLocalCallableTargetId,
  rustBorrowedLocationTargetId,
  rustJsArrayTargetId,
  rustJsDateTargetId,
  rustJsErrorTargetId,
  rustJsMapTargetId,
  rustJsRegExpExecArrayTargetId,
  rustJsRegExpIndicesTargetId,
  rustJsRegExpMatchArrayTargetId,
  rustJsRegExpNamedGroupsTargetId,
  rustJsRegExpNamedIndicesTargetId,
  rustJsRegExpStringIteratorTargetId,
  rustJsRegExpTargetId,
  rustJsSetTargetId,
  rustJsStringTargetId,
  rustJsValueTargetId,
  rustOwnedLocalCallableTargetId,
  rustOwnedLocalAsyncCallableTargetId,
  rustOwnedLocationTargetId,
  rustNullTargetId,
  rustOptionTargetId,
  rustProgramErrorTargetId,
  rustRegExpExecArrayTargetId,
  rustRegExpIndicesTargetId,
  rustRegExpMatchArrayTargetId,
  rustRegExpNamedGroupsTargetId,
  rustRegExpNamedIndicesTargetId,
  rustRegExpStringIteratorTargetId,
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
  rustStringTargetId,
  rustStructuralObjectCarrierValue,
  rustThreadedCallableTargetId,
  rustThreadedAsyncCallableTargetId,
  rustUndefinedTargetId,
} from "./source-types.js";
import { rustNamedTypeCarrierValue } from "./native.js";
import type { RustNamedTypeCarrierValue } from "./native.js";

function builtinTrait(itemId: string): RustTraitRef {
  return Object.freeze({
    identity: rustBuiltinIdentity(itemId),
    displayPath: Object.freeze(itemId.split("::")),
    arguments: Object.freeze([]),
    associatedConstraints: Object.freeze([]),
  });
}

export const rustCopyTrait = builtinTrait("core::marker::Copy");
export const rustCloneTrait = builtinTrait("core::clone::Clone");
export const rustDefaultTrait = builtinTrait("core::default::Default");
export const rustDropTrait = builtinTrait("core::ops::Drop");
export const rustEqTrait = builtinTrait("core::cmp::Eq");
export const rustHashTrait = builtinTrait("core::hash::Hash");
export const rustToOwnedTrait = builtinTrait("alloc::borrow::ToOwned");
export const rustSendTrait = builtinTrait("core::marker::Send");
export const rustSyncTrait = builtinTrait("core::marker::Sync");
export const rustUnpinTrait = builtinTrait("core::marker::Unpin");
export const rustSizedTrait = builtinTrait("core::marker::Sized");
export const rustFnTrait = builtinTrait("core::ops::Fn");
export const rustFnMutTrait = builtinTrait("core::ops::FnMut");
export const rustFnOnceTrait = builtinTrait("core::ops::FnOnce");
export const rustFnOnceOutputIdentity = rustBuiltinIdentity("core::ops::FnOnce::Output");

const builtinTraitByCanonicalPath = new Map<string, RustTraitRef>([
  rustCopyTrait,
  rustCloneTrait,
  rustDefaultTrait,
  rustDropTrait,
  rustEqTrait,
  rustHashTrait,
  rustToOwnedTrait,
  rustSendTrait,
  rustSyncTrait,
  rustUnpinTrait,
  rustSizedTrait,
  rustFnTrait,
  rustFnMutTrait,
  rustFnOnceTrait,
].map((trait) => [trait.displayPath.join("::"), trait]));

export function rustBuiltinTraitForCanonicalPath(
  canonicalPath: readonly string[],
): RustTraitRef | undefined {
  return builtinTraitByCanonicalPath.get(canonicalPath.join("::"));
}

export type RustTypeParameterTraitResolver = (
  identity: RustSemanticIdentity,
  trait: RustTraitRef,
) => boolean;

const noTypeParameterTraits: RustTypeParameterTraitResolver = () => false;

export function isRustCopyCarrier(carrier: TargetTypeRef | undefined): boolean {
  return rustCarrierSupportsTrait(carrier, rustCopyTrait);
}

export function rustCarrierSupportsClone(carrier: TargetTypeRef | undefined): boolean {
  return rustCarrierSupportsTrait(carrier, rustCloneTrait);
}

export function rustCarrierSupportsTrait(
  carrier: TargetTypeRef | undefined,
  trait: RustTraitRef,
  typeParameterSupports: RustTypeParameterTraitResolver = noTypeParameterTraits,
): boolean {
  if (carrier === undefined) return false;
  if (carrier.kind === "type-parameter") {
    return typeParameterSupports(carrier.identity, trait);
  }
  if (isBuiltinTrait(trait, rustCopyTrait)) {
    return supportsCopy(carrier, typeParameterSupports);
  }
  if (isBuiltinTrait(trait, rustCloneTrait)) {
    return supportsClone(carrier, typeParameterSupports);
  }
  if (isBuiltinTrait(trait, rustDefaultTrait)) {
    return supportsDefault(carrier, typeParameterSupports);
  }
  if (isBuiltinTrait(trait, rustEqTrait) || isBuiltinTrait(trait, rustHashTrait)) {
    return supportsEqHash(carrier, trait, typeParameterSupports);
  }
  if (isBuiltinTrait(trait, rustDropTrait)) {
    const named = rustNamedTypeCarrierValue(carrier);
    return named !== undefined && rustNamedTypeSupportsTrait(
      named,
      trait,
      typeParameterSupports,
    );
  }
  if (isBuiltinTrait(trait, rustToOwnedTrait)) {
    return supportsToOwned(carrier, typeParameterSupports);
  }
  if (isBuiltinTraitIdentity(trait, rustFnTrait) ||
    isBuiltinTraitIdentity(trait, rustFnMutTrait) ||
    isBuiltinTraitIdentity(trait, rustFnOnceTrait)) {
    return supportsCallableTrait(carrier, trait);
  }
  if (isBuiltinTrait(trait, rustSendTrait) || isBuiltinTrait(trait, rustSyncTrait) ||
    isBuiltinTrait(trait, rustUnpinTrait)) {
    return supportsAutoTrait(carrier, trait, typeParameterSupports);
  }
  const named = rustNamedTypeCarrierValue(carrier);
  return named !== undefined && rustNamedTypeSupportsTrait(
    named,
    trait,
    typeParameterSupports,
  );
}

export function rustCarrierSupportsTraitBound(
  carrier: TargetTypeRef | undefined,
  bound: Extract<RustBound, { readonly kind: "trait" }>,
  typeParameterSupports: RustTypeParameterTraitResolver = noTypeParameterTraits,
): boolean {
  if (carrier === undefined || bound.binder === undefined) {
    return rustCarrierSupportsTrait(carrier, bound.trait, typeParameterSupports);
  }
  return (carrier.kind === "closure" || carrier.kind === "function-pointer") &&
    carrier.binder !== undefined &&
    callableBindersMatch(carrier.binder, bound.binder) &&
    supportsCallableTraitWithBinders(carrier, carrier.binder, bound.trait, bound.binder);
}

function supportsCallableTrait(
  carrier: TargetTypeRef,
  trait: RustTraitRef,
): boolean {
  const protocol = callableTraitProtocol(carrier);
  if (protocol === undefined || !callTraitSatisfies(protocol.callTrait, trait)) {
    return false;
  }
  const [arguments_] = trait.arguments;
  if (trait.arguments.length !== 1 || arguments_?.kind !== "type" ||
    arguments_.value.kind !== "tuple" ||
    arguments_.value.elements.length !== protocol.parameters.length ||
    !arguments_.value.elements.every((parameter, index) =>
      rustTargetTypeRefEquals(parameter, protocol.parameters[index]))) {
    return false;
  }
  const [output] = trait.associatedConstraints;
  return trait.associatedConstraints.length === 1 && output?.kind === "equality" &&
    output.arguments.length === 0 && rustTargetTypeRefEquals(output.type, protocol.result);
}

function supportsCallableTraitWithBinders(
  carrier: Extract<TargetTypeRef, { readonly kind: "closure" | "function-pointer" }>,
  carrierBinder: RustBinder,
  trait: RustTraitRef,
  traitBinder: RustBinder,
): boolean {
  if (carrier.kind === "function-pointer" &&
    (carrier.safety !== "safe" || carrier.variadic)) return false;
  const callTrait = carrier.kind === "closure" ? carrier.callTrait : "fn";
  if (!callTraitSatisfies(callTrait, trait)) return false;
  const [arguments_] = trait.arguments;
  const [output] = trait.associatedConstraints;
  return trait.arguments.length === 1 && arguments_?.kind === "type" &&
    arguments_.value.kind === "tuple" &&
    arguments_.value.elements.length === carrier.parameters.length &&
    arguments_.value.elements.every((parameter, index) =>
      boundSemanticValuesEqual(
        parameter,
        traitBinder,
        carrier.parameters[index],
        carrierBinder,
      )) &&
    trait.associatedConstraints.length === 1 && output?.kind === "equality" &&
    output.arguments.length === 0 &&
    boundSemanticValuesEqual(output.type, traitBinder, carrier.result, carrierBinder);
}

function callableBindersMatch(left: RustBinder, right: RustBinder): boolean {
  return left.lifetimes.length === right.lifetimes.length &&
    left.lifetimes.every((parameter, index) => {
      const other = right.lifetimes[index];
      return other !== undefined && parameter.bounds.length === other.bounds.length &&
        parameter.bounds.every((lifetime, boundIndex) =>
          boundSemanticValuesEqual(
            lifetime,
            left,
            other.bounds[boundIndex],
            right,
          ));
    });
}

function boundSemanticValuesEqual(
  left: unknown,
  leftBinder: RustBinder,
  right: unknown,
  rightBinder: RustBinder,
): boolean {
  return closedMetadataEquals(
    normalizeBoundSemanticValue(left, leftBinder),
    normalizeBoundSemanticValue(right, rightBinder),
  );
}

function normalizeBoundSemanticValue(value: unknown, binder: RustBinder): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeBoundSemanticValue(entry, binder));
  }
  if (value === null || typeof value !== "object") return value;
  const record = value as Readonly<Record<string, unknown>>;
  if (record.kind === "bound" && record.binderId === binder.id &&
    typeof record.parameterId === "string") {
    const index = binder.lifetimes.findIndex((parameter) =>
      parameter.identity.kind === "bound" &&
      parameter.identity.parameterId === record.parameterId);
    return index < 0
      ? value
      : Object.freeze({ kind: "bound", binderId: "canonical", parameterId: `${index}`, displayName: "_" });
  }
  return Object.freeze(Object.fromEntries(Object.entries(record).map(([key, entry]) =>
    [key, normalizeBoundSemanticValue(entry, binder)])));
}

function callableTraitProtocol(
  carrier: TargetTypeRef,
): {
  readonly callTrait: "fn" | "fn-mut" | "fn-once";
  readonly parameters: readonly TargetTypeRef[];
  readonly result: TargetTypeRef;
} | undefined {
  if (carrier.kind === "closure") {
    return carrier;
  }
  if (carrier.kind === "function-pointer" && carrier.safety === "safe" &&
    !carrier.variadic) {
    return {
      callTrait: "fn",
      parameters: carrier.parameters,
      result: carrier.result,
    };
  }
  return undefined;
}

function callTraitSatisfies(
  actual: "fn" | "fn-mut" | "fn-once",
  required: RustTraitRef,
): boolean {
  if (isBuiltinTraitIdentity(required, rustFnOnceTrait)) return true;
  if (isBuiltinTraitIdentity(required, rustFnMutTrait)) return actual !== "fn-once";
  return isBuiltinTraitIdentity(required, rustFnTrait) && actual === "fn";
}

function supportsToOwned(
  carrier: TargetTypeRef,
  typeParameterSupports: RustTypeParameterTraitResolver,
): boolean {
  if (carrier.kind === "str" || carrier.kind === "slice") return true;
  if (carrier.kind === "type-parameter") {
    return typeParameterSupports(carrier.identity, rustToOwnedTrait);
  }
  return supportsClone(carrier, typeParameterSupports);
}

function supportsAutoTrait(
  carrier: TargetTypeRef,
  trait: RustTraitRef,
  typeParameterSupports: RustTypeParameterTraitResolver,
): boolean {
  switch (carrier.kind) {
    case "source-primitive":
    case "primitive":
    case "never":
    case "unit":
    case "str":
    case "function-pointer":
      return true;
    case "reference":
      if (isBuiltinTrait(trait, rustUnpinTrait)) return true;
      if (isBuiltinTrait(trait, rustSendTrait)) {
        return rustCarrierSupportsTrait(
          carrier.target,
          carrier.mutable ? rustSendTrait : rustSyncTrait,
          typeParameterSupports,
        );
      }
      return rustCarrierSupportsTrait(carrier.target, rustSyncTrait, typeParameterSupports);
    case "raw-pointer":
      return isBuiltinTrait(trait, rustUnpinTrait);
    case "tuple":
      return carrier.elements.every((element) =>
        rustCarrierSupportsTrait(element, trait, typeParameterSupports));
    case "array":
    case "sequence":
    case "slice":
      return rustCarrierSupportsTrait(carrier.element, trait, typeParameterSupports);
    case "type-parameter":
      return typeParameterSupports(carrier.identity, trait);
    case "path": {
      const itemId = rustSemanticIdentityItemId(carrier.identity);
      if (itemId !== undefined && isBuiltinTrait(trait, rustUnpinTrait) &&
        rustRuntimeCallableTargetIds.has(itemId)) return true;
      if (itemId !== undefined &&
        (isBuiltinTrait(trait, rustSendTrait) || isBuiltinTrait(trait, rustSyncTrait)) &&
        rustThreadedRuntimeCallableTargetIds.has(itemId)) return true;
      const named = rustNamedTypeCarrierValue(carrier);
      return named !== undefined && rustNamedTypeSupportsTrait(
        named,
        trait,
        typeParameterSupports,
      );
    }
    case "source-carrier": {
      const structural = rustStructuralObjectCarrierValue(carrier);
      if (structural !== undefined) {
        return structural.fields.every((field) =>
          rustCarrierSupportsTrait(field.type, trait, typeParameterSupports));
      }
      const union = rustSourceUnionCarrierValue(carrier);
      return union !== undefined && union.variants.every((variant) =>
        rustCarrierSupportsTrait(variant.carrier, trait, typeParameterSupports));
    }
    case "self":
    case "inference-variable":
    case "closure":
    case "trait-object":
    case "opaque":
    case "associated-type":
      return false;
  }
}

function supportsCopy(
  carrier: TargetTypeRef,
  typeParameterSupports: RustTypeParameterTraitResolver,
): boolean {
  switch (carrier.kind) {
    case "source-primitive":
    case "primitive":
    case "never":
    case "unit":
    case "function-pointer":
    case "raw-pointer":
      return true;
    case "reference":
      return !carrier.mutable;
    case "tuple":
      return carrier.elements.every((element) => supportsCopy(element, typeParameterSupports));
    case "array":
      return supportsCopy(carrier.element, typeParameterSupports);
    case "type-parameter":
      return typeParameterSupports(carrier.identity, rustCopyTrait);
    case "inference-variable":
      return false;
    case "path": {
      const option = rustPathTypeMatches(carrier, rustOptionTargetId)
        ? rustPathTypeArguments(carrier)
        : undefined;
      if (option?.length === 1 && option[0] !== undefined) {
        return supportsCopy(option[0], typeParameterSupports);
      }
      const itemId = rustSemanticIdentityItemId(carrier.identity);
      if (itemId !== undefined && rustUnconditionallyCopyTargetIds.has(itemId)) return true;
      const named = rustNamedTypeCarrierValue(carrier);
      return named !== undefined && rustNamedTypeSupportsTrait(
        named,
        rustCopyTrait,
        typeParameterSupports,
      );
    }
    case "source-carrier":
      return rustSourceTypeCarrierValue(carrier)?.shape === "enum";
    case "self":
    case "str":
    case "sequence":
    case "slice":
    case "closure":
    case "trait-object":
    case "opaque":
    case "associated-type":
      return false;
  }
}

function supportsClone(
  carrier: TargetTypeRef,
  typeParameterSupports: RustTypeParameterTraitResolver,
): boolean {
  switch (carrier.kind) {
    case "source-primitive":
    case "primitive":
    case "never":
    case "unit":
    case "function-pointer":
    case "raw-pointer":
    case "reference":
      return true;
    case "tuple":
      return carrier.elements.every((element) => supportsClone(element, typeParameterSupports));
    case "array":
    case "sequence":
      return supportsClone(carrier.element, typeParameterSupports);
    case "type-parameter":
      return typeParameterSupports(carrier.identity, rustCloneTrait);
    case "inference-variable":
      return false;
    case "path": {
      const option = rustPathTypeMatches(carrier, rustOptionTargetId)
        ? rustPathTypeArguments(carrier)
        : undefined;
      if (option?.length === 1 && option[0] !== undefined) {
        return supportsClone(option[0], typeParameterSupports);
      }
      const itemId = rustSemanticIdentityItemId(carrier.identity);
      if (itemId !== undefined && rustUnconditionallyCloneTargetIds.has(itemId)) return true;
      const named = rustNamedTypeCarrierValue(carrier);
      return named !== undefined && rustNamedTypeSupportsTrait(
        named,
        rustCloneTrait,
        typeParameterSupports,
      );
    }
    case "source-carrier": {
      const structural = rustStructuralObjectCarrierValue(carrier);
      if (structural !== undefined) {
        return structural.fields.every((field) => supportsClone(field.type, typeParameterSupports));
      }
      const union = rustSourceUnionCarrierValue(carrier);
      if (union !== undefined) {
        return union.variants.every((variant) => supportsClone(variant.carrier, typeParameterSupports));
      }
      return rustSourceTypeCarrierValue(carrier) !== undefined;
    }
    case "self":
    case "str":
    case "slice":
    case "closure":
    case "trait-object":
    case "opaque":
    case "associated-type":
      return false;
  }
}

function supportsDefault(
  carrier: TargetTypeRef,
  typeParameterSupports: RustTypeParameterTraitResolver,
): boolean {
  switch (carrier.kind) {
    case "source-primitive":
      return rustPrimitiveTypeName(carrier.name) !== undefined;
    case "primitive":
    case "unit":
      return true;
    case "array":
      return supportsDefault(carrier.element, typeParameterSupports);
    case "tuple":
      return carrier.elements.length <= 12 && carrier.elements.every((element) =>
        supportsDefault(element, typeParameterSupports));
    case "type-parameter":
      return typeParameterSupports(carrier.identity, rustDefaultTrait);
    case "inference-variable":
      return false;
    case "path": {
      const itemId = rustSemanticIdentityItemId(carrier.identity);
      if (rustPathTypeMatches(carrier, rustOptionTargetId) ||
        itemId !== undefined && rustUnconditionallyDefaultTargetIds.has(itemId)) {
        return true;
      }
      const named = rustNamedTypeCarrierValue(carrier);
      return named !== undefined && rustNamedTypeSupportsTrait(
        named,
        rustDefaultTrait,
        typeParameterSupports,
      );
    }
    default:
      return false;
  }
}

function supportsEqHash(
  carrier: TargetTypeRef,
  trait: RustTraitRef,
  typeParameterSupports: RustTypeParameterTraitResolver,
): boolean {
  switch (carrier.kind) {
    case "source-primitive":
      return carrier.name !== "float16" && carrier.name !== "float32" &&
        carrier.name !== "float64" && carrier.name !== "decimal";
    case "primitive":
      return carrier.name !== "f16" && carrier.name !== "f32" && carrier.name !== "f64";
    case "unit":
    case "never":
      return true;
    case "tuple":
      return carrier.elements.every((element) =>
        rustCarrierSupportsTrait(element, trait, typeParameterSupports));
    case "array":
    case "slice":
      return rustCarrierSupportsTrait(carrier.element, trait, typeParameterSupports);
    case "type-parameter":
      return typeParameterSupports(carrier.identity, trait);
    case "inference-variable":
      return false;
    case "path": {
      const itemId = rustSemanticIdentityItemId(carrier.identity);
      if (itemId !== undefined && rustUnconditionallyEqHashTargetIds.has(itemId)) return true;
      const option = rustPathTypeMatches(carrier, rustOptionTargetId)
        ? rustPathTypeArguments(carrier)
        : undefined;
      if (option?.length === 1 && option[0] !== undefined) {
        return rustCarrierSupportsTrait(option[0], trait, typeParameterSupports);
      }
      const named = rustNamedTypeCarrierValue(carrier);
      return named !== undefined && rustNamedTypeSupportsTrait(
        named,
        trait,
        typeParameterSupports,
      );
    }
    default:
      return false;
  }
}

export function rustNamedTypeSupportsTrait(
  namedType: RustNamedTypeCarrierValue,
  trait: RustTraitRef,
  typeParameterSupports: RustTypeParameterTraitResolver = noTypeParameterTraits,
): boolean {
  return namedType.traits.implementations.some((implementation) =>
    rustTraitReferenceEquals(implementation.trait, trait) &&
    implementation.requirements.every((requirement) => {
      const argument = namedType.typeArguments[requirement.typeArgumentIndex];
      return argument !== undefined && rustCarrierSupportsTrait(
        argument,
        requirement.trait,
        typeParameterSupports,
      );
    }));
}

export function rustCarrierReferentMutationRequiresMutableBinding(
  carrier: TargetTypeRef | undefined,
): boolean {
  return rustStructuralObjectCarrierValue(carrier) === undefined &&
    rustSourceUnionCarrierValue(carrier) === undefined;
}

export function isRustJsStrictEqualityCarrier(carrier: TargetTypeRef | undefined): boolean {
  const itemId = carrier?.kind === "path"
    ? rustSemanticIdentityItemId(carrier.identity)
    : undefined;
  return itemId !== undefined && rustJsStrictEqualityTargetIds.has(itemId);
}

export function rustCarrierSupportsJsEquality(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" || isRustStringCarrier(carrier) ||
    isRustJsStringCarrier(carrier) || isRustBigIntCarrier(carrier) ||
    isRustNullCarrier(carrier) || isRustUndefinedCarrier(carrier) ||
    isRustJsStrictEqualityCarrier(carrier);
}

export function isRustSourceStringConvertibleCarrier(carrier: TargetTypeRef | undefined): boolean {
  return isRustStringCarrier(carrier) || isRustUnitCarrier(carrier) ||
    isRustNullCarrier(carrier) || isRustUndefinedCarrier(carrier) ||
    isRustBigIntCarrier(carrier) ||
    rustPathTypeMatches(carrier, rustProgramErrorTargetId) ||
    (carrier?.kind === "source-primitive" && carrier.name !== "char");
}

function isBuiltinTrait(actual: RustTraitRef, expected: RustTraitRef): boolean {
  return isBuiltinTraitIdentity(actual, expected) &&
    actual.arguments.length === 0 && actual.associatedConstraints.length === 0;
}

function isBuiltinTraitIdentity(actual: RustTraitRef, expected: RustTraitRef): boolean {
  return rustSemanticIdentitiesEqual(actual.identity, expected.identity);
}

const rustUnconditionallyCopyTargetIds = new Set([
  rustNullTargetId,
  rustUndefinedTargetId,
]);

const rustUnconditionallyEqHashTargetIds = new Set([
  rustStringTargetId,
  rustBigIntTargetId,
  rustNullTargetId,
  rustUndefinedTargetId,
]);

const rustJsStrictEqualityTargetIds = new Set([
  rustNullTargetId,
  rustUndefinedTargetId,
  rustJsValueTargetId,
  rustJsArrayTargetId,
  rustJsMapTargetId,
  rustJsSetTargetId,
  rustJsDateTargetId,
  rustJsRegExpTargetId,
]);

const rustUnconditionallyCloneTargetIds = new Set([
  rustStringTargetId,
  rustJsStringTargetId,
  rustBigIntTargetId,
  rustOwnedLocalCallableTargetId,
  rustOwnedLocalAsyncCallableTargetId,
  rustBorrowedLocalCallableTargetId,
  rustBorrowedLocalAsyncCallableTargetId,
  rustThreadedCallableTargetId,
  rustThreadedAsyncCallableTargetId,
  rustOwnedLocationTargetId,
  rustBorrowedLocationTargetId,
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

const rustRuntimeCallableTargetIds = new Set([
  rustOwnedLocalCallableTargetId,
  rustOwnedLocalAsyncCallableTargetId,
  rustBorrowedLocalCallableTargetId,
  rustBorrowedLocalAsyncCallableTargetId,
  rustThreadedCallableTargetId,
  rustThreadedAsyncCallableTargetId,
]);

const rustThreadedRuntimeCallableTargetIds = new Set([
  rustThreadedCallableTargetId,
  rustThreadedAsyncCallableTargetId,
]);

const rustUnconditionallyDefaultTargetIds = new Set([
  rustStringTargetId,
  rustJsStringTargetId,
  rustNullTargetId,
  rustUndefinedTargetId,
  rustJsArrayTargetId,
  rustJsMapTargetId,
  rustJsSetTargetId,
]);

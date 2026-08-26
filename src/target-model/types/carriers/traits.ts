import type {
  RustBinder,
  RustBound,
  RustSemanticIdentity,
  RustTraitRef,
} from "../../semantics/index.js";
import {
  rustBuiltinIdentity,
  rustSemanticIdentitiesEqual,
  rustSemanticIdentityKey,
} from "../../semantics/index.js";
import {
  rustBuiltinPathTypeMatches,
  rustPathTypeArguments,
} from "../constructors.js";
import {
  rustTargetTypeRefEquals,
  rustTraitReferenceEquals,
} from "../equality.js";
import type {
  RustNamedTypeTraitContract,
  RustNamedTypeTraitContractIndex,
  TargetTypeRef,
} from "../model.js";
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
import {
  rustNamedTypeCarrierValue,
  rustTupleElementCarriers,
} from "./native.js";
import type { RustNamedTypeCarrierValue } from "./native.js";
import {
  rustBoundSemanticValuesAlphaEquivalent,
  rustCallableBindersAlphaEquivalent,
} from "./callables.js";
import {
  rustGenericSubstitutionsForOpenArguments,
  substituteRustBound,
  substituteRustTraitRef,
} from "../generic-substitution.js";

function builtinTrait(itemId: string): RustTraitRef {
  return Object.freeze<RustTraitRef>({
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

interface RustTraitSupportResolution {
  readonly namedTypeContract: (
    identity: RustSemanticIdentity,
  ) => RustNamedTypeTraitContract | undefined;
  readonly typeParameterSupports: RustTypeParameterTraitResolver;
}

export interface RustTraitSupportQueries {
  isCopy(carrier: TargetTypeRef | undefined): boolean;
  supportsClone(carrier: TargetTypeRef | undefined): boolean;
  supportsTrait(
    carrier: TargetTypeRef | undefined,
    trait: RustTraitRef,
    typeParameterSupports?: RustTypeParameterTraitResolver,
  ): boolean;
  supportsTraitBound(
    carrier: TargetTypeRef | undefined,
    bound: Extract<RustBound, { readonly kind: "trait" }>,
    typeParameterSupports?: RustTypeParameterTraitResolver,
  ): boolean;
}

export function createRustTraitSupportQueries(
  namedTypeContracts: RustNamedTypeTraitContractIndex,
): RustTraitSupportQueries {
  const base = Object.freeze<RustTraitSupportResolution>({
    namedTypeContract: (identity) => namedTypeContracts.contractFor(identity),
    typeParameterSupports: noTypeParameterTraits,
  });
  const resolutionFor = (
    typeParameterSupports: RustTypeParameterTraitResolver | undefined,
  ): RustTraitSupportResolution => typeParameterSupports === undefined
    ? base
    : { ...base, typeParameterSupports };
  return Object.freeze<RustTraitSupportQueries>({
    isCopy(carrier) {
      return rustCarrierSupportsTrait(carrier, rustCopyTrait, base);
    },
    supportsClone(carrier) {
      return rustCarrierSupportsTrait(carrier, rustCloneTrait, base);
    },
    supportsTrait(carrier, trait, typeParameterSupports) {
      return rustCarrierSupportsTrait(
        carrier,
        trait,
        resolutionFor(typeParameterSupports),
      );
    },
    supportsTraitBound(carrier, bound, typeParameterSupports) {
      return rustCarrierSupportsTraitBound(
        carrier,
        bound,
        resolutionFor(typeParameterSupports),
      );
    },
  });
}

function rustCarrierSupportsTrait(
  carrier: TargetTypeRef | undefined,
  trait: RustTraitRef,
  resolution: RustTraitSupportResolution,
): boolean {
  if (carrier === undefined) return false;
  if (carrier.kind === "type-parameter") {
    return resolution.typeParameterSupports(carrier.identity, trait);
  }
  if (carrier.kind === "trait-object" &&
    rustTraitReferenceEquals(carrier.principal, trait)) return true;
  if (carrier.kind === "opaque" && carrier.bounds.some((bound) =>
    bound.kind === "trait" && bound.polarity === "required" &&
    bound.binder === undefined && rustTraitReferenceEquals(bound.trait, trait))) return true;
  if (isBuiltinTrait(trait, rustCopyTrait)) {
    return supportsCopy(carrier, resolution);
  }
  if (isBuiltinTrait(trait, rustCloneTrait)) {
    return supportsClone(carrier, resolution);
  }
  if (isBuiltinTrait(trait, rustDefaultTrait)) {
    return supportsDefault(carrier, resolution);
  }
  if (isBuiltinTrait(trait, rustEqTrait) || isBuiltinTrait(trait, rustHashTrait)) {
    return supportsEqHash(carrier, trait, resolution);
  }
  if (isBuiltinTrait(trait, rustDropTrait)) {
    const named = rustNamedTypeCarrierValue(carrier);
    return named !== undefined && rustNamedTypeSupportsTrait(
      named,
      trait,
      resolution,
    );
  }
  if (isBuiltinTrait(trait, rustToOwnedTrait)) {
    return supportsToOwned(carrier, resolution);
  }
  if (isBuiltinTraitIdentity(trait, rustFnTrait) ||
    isBuiltinTraitIdentity(trait, rustFnMutTrait) ||
    isBuiltinTraitIdentity(trait, rustFnOnceTrait)) {
    return supportsCallableTrait(carrier, trait);
  }
  if (isBuiltinTrait(trait, rustSendTrait) || isBuiltinTrait(trait, rustSyncTrait) ||
    isBuiltinTrait(trait, rustUnpinTrait)) {
    return supportsAutoTrait(carrier, trait, resolution);
  }
  const named = rustNamedTypeCarrierValue(carrier);
  return named !== undefined && rustNamedTypeSupportsTrait(
    named,
    trait,
    resolution,
  );
}

function rustCarrierSupportsTraitBound(
  carrier: TargetTypeRef | undefined,
  bound: Extract<RustBound, { readonly kind: "trait" }>,
  resolution: RustTraitSupportResolution,
): boolean {
  if (bound.polarity === "maybe") return true;
  if (bound.polarity !== "required") return false;
  if (carrier === undefined || bound.binder === undefined) {
    return rustCarrierSupportsTrait(carrier, bound.trait, resolution);
  }
  return (carrier.kind === "closure" || carrier.kind === "function-pointer") &&
    carrier.binder !== undefined &&
    rustCallableBindersAlphaEquivalent(carrier.binder, bound.binder) &&
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
  const parameters = arguments_?.kind === "type"
    ? rustTupleElementCarriers(arguments_.value)
    : undefined;
  if (trait.arguments.length !== 1 || arguments_?.kind !== "type" ||
    parameters === undefined || parameters.length !== protocol.parameters.length ||
    !parameters.every((parameter, index) =>
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
  const parameters = arguments_?.kind === "type"
    ? rustTupleElementCarriers(arguments_.value)
    : undefined;
  const [output] = trait.associatedConstraints;
  return trait.arguments.length === 1 && arguments_?.kind === "type" &&
    parameters !== undefined && parameters.length === carrier.parameters.length &&
    parameters.every((parameter, index) =>
      rustBoundSemanticValuesAlphaEquivalent(
        parameter,
        traitBinder,
        carrier.parameters[index]!,
        carrierBinder,
      )) &&
    trait.associatedConstraints.length === 1 && output?.kind === "equality" &&
    output.arguments.length === 0 &&
    rustBoundSemanticValuesAlphaEquivalent(
      output.type,
      traitBinder,
      carrier.result,
      carrierBinder,
    );
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
  resolution: RustTraitSupportResolution,
): boolean {
  if (carrier.kind === "str" || carrier.kind === "slice") return true;
  if (carrier.kind === "type-parameter") {
    return resolution.typeParameterSupports(carrier.identity, rustToOwnedTrait);
  }
  return supportsClone(carrier, resolution);
}

function supportsAutoTrait(
  carrier: TargetTypeRef,
  trait: RustTraitRef,
  resolution: RustTraitSupportResolution,
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
          resolution,
        );
      }
      return rustCarrierSupportsTrait(carrier.target, rustSyncTrait, resolution);
    case "raw-pointer":
      return isBuiltinTrait(trait, rustUnpinTrait);
    case "tuple":
      return carrier.elements.every((element) =>
        rustCarrierSupportsTrait(element, trait, resolution));
    case "array":
    case "sequence":
    case "slice":
      return rustCarrierSupportsTrait(carrier.element, trait, resolution);
    case "type-parameter":
      return resolution.typeParameterSupports(carrier.identity, trait);
    case "path": {
      const identityKey = rustBuiltinCarrierIdentityKey(carrier);
      if (identityKey !== undefined && isBuiltinTrait(trait, rustUnpinTrait) &&
        rustRuntimeCallableTypeKeys.has(identityKey)) return true;
      if (identityKey !== undefined &&
        (isBuiltinTrait(trait, rustSendTrait) || isBuiltinTrait(trait, rustSyncTrait)) &&
        rustThreadedRuntimeCallableTypeKeys.has(identityKey)) return true;
      const named = rustNamedTypeCarrierValue(carrier);
      return named !== undefined && rustNamedTypeSupportsTrait(
        named,
        trait,
        resolution,
      );
    }
    case "trait-object":
      return carrier.autoTraits.some((candidate) => rustTraitReferenceEquals(candidate, trait));
    case "opaque":
      return carrier.bounds.some((bound) => bound.kind === "trait" &&
        bound.polarity === "required" && bound.binder === undefined &&
        rustTraitReferenceEquals(bound.trait, trait));
    case "source-carrier": {
      const structural = rustStructuralObjectCarrierValue(carrier);
      if (structural !== undefined) {
        return structural.fields.every((field) =>
          rustCarrierSupportsTrait(field.type, trait, resolution));
      }
      const union = rustSourceUnionCarrierValue(carrier);
      return union !== undefined && union.variants.every((variant) =>
        rustCarrierSupportsTrait(variant.carrier, trait, resolution));
    }
    case "self":
    case "inference-variable":
    case "closure":
    case "associated-type":
      return false;
  }
}

function supportsCopy(
  carrier: TargetTypeRef,
  resolution: RustTraitSupportResolution,
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
      return carrier.elements.length <= 12 &&
        carrier.elements.every((element) => supportsCopy(element, resolution));
    case "array":
      return supportsCopy(carrier.element, resolution);
    case "type-parameter":
      return resolution.typeParameterSupports(carrier.identity, rustCopyTrait);
    case "inference-variable":
      return false;
    case "path": {
      const option = rustBuiltinPathTypeMatches(carrier, rustOptionTargetId, "rust")
        ? rustPathTypeArguments(carrier)
        : undefined;
      if (option?.length === 1 && option[0] !== undefined) {
        return supportsCopy(option[0], resolution);
      }
      const identityKey = rustBuiltinCarrierIdentityKey(carrier);
      if (identityKey !== undefined && rustUnconditionallyCopyTypeKeys.has(identityKey)) return true;
      const named = rustNamedTypeCarrierValue(carrier);
      return named !== undefined && rustNamedTypeSupportsTrait(
        named,
        rustCopyTrait,
        resolution,
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
  resolution: RustTraitSupportResolution,
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
      return carrier.elements.length <= 12 &&
        carrier.elements.every((element) => supportsClone(element, resolution));
    case "array":
    case "sequence":
      return supportsClone(carrier.element, resolution);
    case "type-parameter":
      return resolution.typeParameterSupports(carrier.identity, rustCloneTrait);
    case "inference-variable":
      return false;
    case "path": {
      const option = rustBuiltinPathTypeMatches(carrier, rustOptionTargetId, "rust")
        ? rustPathTypeArguments(carrier)
        : undefined;
      if (option?.length === 1 && option[0] !== undefined) {
        return supportsClone(option[0], resolution);
      }
      const identityKey = rustBuiltinCarrierIdentityKey(carrier);
      if (identityKey !== undefined && rustUnconditionallyCloneTypeKeys.has(identityKey)) return true;
      const named = rustNamedTypeCarrierValue(carrier);
      return named !== undefined && rustNamedTypeSupportsTrait(
        named,
        rustCloneTrait,
        resolution,
      );
    }
    case "source-carrier": {
      const structural = rustStructuralObjectCarrierValue(carrier);
      if (structural !== undefined) {
        return structural.fields.every((field) => supportsClone(field.type, resolution));
      }
      const union = rustSourceUnionCarrierValue(carrier);
      if (union !== undefined) {
        return union.variants.every((variant) => supportsClone(variant.carrier, resolution));
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
  resolution: RustTraitSupportResolution,
): boolean {
  switch (carrier.kind) {
    case "source-primitive":
      return rustPrimitiveTypeName(carrier.name) !== undefined;
    case "primitive":
    case "unit":
      return true;
    case "array":
      return carrier.length.kind === "literal" && carrier.length.literalKind === "integer" &&
        carrier.length.value >= 0n && carrier.length.value <= 32n &&
        supportsDefault(carrier.element, resolution);
    case "tuple":
      return carrier.elements.length <= 12 && carrier.elements.every((element) =>
        supportsDefault(element, resolution));
    case "type-parameter":
      return resolution.typeParameterSupports(carrier.identity, rustDefaultTrait);
    case "inference-variable":
      return false;
    case "path": {
      const identityKey = rustBuiltinCarrierIdentityKey(carrier);
      if (rustBuiltinPathTypeMatches(carrier, rustOptionTargetId, "rust") ||
        identityKey !== undefined && rustUnconditionallyDefaultTypeKeys.has(identityKey)) {
        return true;
      }
      const named = rustNamedTypeCarrierValue(carrier);
      return named !== undefined && rustNamedTypeSupportsTrait(
        named,
        rustDefaultTrait,
        resolution,
      );
    }
    default:
      return false;
  }
}

function supportsEqHash(
  carrier: TargetTypeRef,
  trait: RustTraitRef,
  resolution: RustTraitSupportResolution,
): boolean {
  switch (carrier.kind) {
    case "source-primitive":
      return carrier.name !== "float16" && carrier.name !== "float32" &&
        carrier.name !== "float64" && carrier.name !== "decimal";
    case "primitive":
      return carrier.name !== "f16" && carrier.name !== "f32" && carrier.name !== "f64";
    case "unit":
    case "never":
    case "str":
    case "function-pointer":
      return true;
    case "tuple":
      return carrier.elements.length <= 12 && carrier.elements.every((element) =>
        rustCarrierSupportsTrait(element, trait, resolution));
    case "array":
    case "sequence":
    case "slice":
      return rustCarrierSupportsTrait(carrier.element, trait, resolution);
    case "reference":
      return rustCarrierSupportsTrait(carrier.target, trait, resolution);
    case "type-parameter":
      return resolution.typeParameterSupports(carrier.identity, trait);
    case "inference-variable":
      return false;
    case "path": {
      const identityKey = rustBuiltinCarrierIdentityKey(carrier);
      if (identityKey !== undefined && rustUnconditionallyEqHashTypeKeys.has(identityKey)) return true;
      const option = rustBuiltinPathTypeMatches(carrier, rustOptionTargetId, "rust")
        ? rustPathTypeArguments(carrier)
        : undefined;
      if (option?.length === 1 && option[0] !== undefined) {
        return rustCarrierSupportsTrait(option[0], trait, resolution);
      }
      const named = rustNamedTypeCarrierValue(carrier);
      return named !== undefined && rustNamedTypeSupportsTrait(
        named,
        trait,
        resolution,
      );
    }
    default:
      return false;
  }
}

function rustNamedTypeSupportsTrait(
  namedType: RustNamedTypeCarrierValue,
  trait: RustTraitRef,
  resolution: RustTraitSupportResolution,
): boolean {
  const contract = resolution.namedTypeContract(namedType.identity);
  return contract !== undefined && contract.implementations.some((implementation) => {
    const parameters = implementation.genericBindings.map(({ parameter }) => parameter);
    const arguments_: import("../../semantics/index.js").RustGenericArgument[] = [];
    for (const { genericArgumentIndex } of implementation.genericBindings) {
      const argument = namedType.arguments[genericArgumentIndex];
      if (argument === undefined) return false;
      arguments_.push(argument);
    }
    const substitutions = rustGenericSubstitutionsForOpenArguments(
      parameters,
      arguments_,
    );
    return substitutions !== undefined &&
      rustTraitReferenceEquals(substituteRustTraitRef(implementation.trait, substitutions), trait) &&
      implementation.requirements.every((requirement) => {
        const argument = namedType.arguments[requirement.genericArgumentIndex];
        const bound = substituteRustBound(requirement.bound, substitutions);
        return argument?.kind === "type" && bound.kind === "trait" &&
          rustCarrierSupportsTraitBound(argument.value, bound, resolution);
      });
  });
}

export function rustCarrierReferentMutationRequiresMutableBinding(
  carrier: TargetTypeRef | undefined,
): boolean {
  return rustStructuralObjectCarrierValue(carrier) === undefined &&
    rustSourceUnionCarrierValue(carrier) === undefined;
}

export function isRustJsStrictEqualityCarrier(carrier: TargetTypeRef | undefined): boolean {
  const identityKey = rustBuiltinCarrierIdentityKey(carrier);
  return identityKey !== undefined && rustJsStrictEqualityTypeKeys.has(identityKey);
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
    rustBuiltinPathTypeMatches(carrier, rustProgramErrorTargetId, "tsonic-runtime") ||
    (carrier?.kind === "source-primitive" && carrier.name !== "char");
}

function isBuiltinTrait(actual: RustTraitRef, expected: RustTraitRef): boolean {
  return isBuiltinTraitIdentity(actual, expected) &&
    actual.arguments.length === 0 && actual.associatedConstraints.length === 0;
}

function isBuiltinTraitIdentity(actual: RustTraitRef, expected: RustTraitRef): boolean {
  return rustSemanticIdentitiesEqual(actual.identity, expected.identity);
}

function rustBuiltinCarrierIdentityKey(
  carrier: TargetTypeRef | undefined,
): string | undefined {
  return carrier?.kind === "path" && carrier.identity.kind === "builtin"
    ? rustSemanticIdentityKey(carrier.identity)
    : undefined;
}

function rustNativeTypeKey(itemId: string): string {
  return rustSemanticIdentityKey(rustBuiltinIdentity(itemId, "rust"));
}

function rustRuntimeTypeKey(itemId: string): string {
  return rustSemanticIdentityKey(rustBuiltinIdentity(itemId, "tsonic-runtime"));
}

const rustUnconditionallyCopyTypeKeys = new Set([
  rustRuntimeTypeKey(rustNullTargetId),
  rustRuntimeTypeKey(rustUndefinedTargetId),
]);

const rustUnconditionallyEqHashTypeKeys = new Set([
  rustNativeTypeKey(rustStringTargetId),
  rustRuntimeTypeKey(rustBigIntTargetId),
  rustRuntimeTypeKey(rustNullTargetId),
  rustRuntimeTypeKey(rustUndefinedTargetId),
]);

const rustJsStrictEqualityTypeKeys = new Set([
  rustRuntimeTypeKey(rustNullTargetId),
  rustRuntimeTypeKey(rustUndefinedTargetId),
  rustRuntimeTypeKey(rustJsValueTargetId),
  rustRuntimeTypeKey(rustJsArrayTargetId),
  rustRuntimeTypeKey(rustJsMapTargetId),
  rustRuntimeTypeKey(rustJsSetTargetId),
  rustRuntimeTypeKey(rustJsDateTargetId),
  rustRuntimeTypeKey(rustJsRegExpTargetId),
]);

const rustUnconditionallyCloneTypeKeys = new Set([
  rustNativeTypeKey(rustStringTargetId),
  ...[
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
  ].map(rustRuntimeTypeKey),
]);

const rustRuntimeCallableTypeKeys = new Set([
  rustOwnedLocalCallableTargetId,
  rustOwnedLocalAsyncCallableTargetId,
  rustBorrowedLocalCallableTargetId,
  rustBorrowedLocalAsyncCallableTargetId,
  rustThreadedCallableTargetId,
  rustThreadedAsyncCallableTargetId,
].map(rustRuntimeTypeKey));

const rustThreadedRuntimeCallableTypeKeys = new Set([
  rustThreadedCallableTargetId,
  rustThreadedAsyncCallableTargetId,
].map(rustRuntimeTypeKey));

const rustUnconditionallyDefaultTypeKeys = new Set([
  rustNativeTypeKey(rustStringTargetId),
  ...[
    rustJsStringTargetId,
    rustNullTargetId,
    rustUndefinedTargetId,
    rustJsArrayTargetId,
    rustJsMapTargetId,
    rustJsSetTargetId,
  ].map(rustRuntimeTypeKey),
]);

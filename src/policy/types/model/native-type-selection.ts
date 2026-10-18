import type {
  RustNamedTypeTraitRequirement,
  RustProgramErrorOwner,
  RustTargetAssociatedConstraint,
  RustTargetGenericArgument,
  RustTargetTraitRef,
  TargetTypeRef,
} from "../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import type { RustLifetimeBinder, RustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import { rustRuntimeErrorTargetType } from "../../../target-model/operations/error-boundary.js";
import type { Node } from "@tsonic/tsts";
import type { RustProjectTypeDefinition, RustProjectTypePolicy } from "../../../target-model/types/project-types.js";
import type { RustErrorRegionRecords, RustSourcePackageErrorBoundary } from "../../../target-model/records/error-regions.js";
import { rustGenericCallableStorageArguments } from "../../../target-model/types/carriers/generic-callable-storage.js";
import { rustSourceUnionPayloadArguments } from "../../../target-model/types/source-union-definitions.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import { isValidRustIdentifier } from "../../../target-model/names/identifiers.js";
import { bindRustCallableInputLifetimes } from "../../../target-model/types/carriers/callable-input-lifetimes.js";
import { rustCallablePhysicalSignature, type RustCallablePhysicalSignature } from "../../../target-model/conversions/callable-physical.js";
import { rustProgramErrorOwner } from "../../../target-model/types/carriers/program-errors.js";
import { rustProducerErrorReference, type RustProducerErrorReference } from "../../../target-model/types/carriers/producer-errors.js";
import { rustNativeErrorJoinIdentity, rustNativeErrorJoinReference, type RustNativeErrorJoinReference } from "../../../target-model/types/native-error-joins.js";
import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { rustFrameCallableValue } from "../../../target-model/types/carriers/frame-callables.js";
import { rustClassConstructorInstance } from "../../../target-model/types/carriers/class-constructors.js";
import { rustTargetGenericArgumentEquals } from "../../../target-model/types/equality.js";
import {
  isRustAbsenceCarrier,
  isRustNeverCarrier,
  isRustNativeFutureCarrier,
  rustBuiltInCarrierDefinitions,
  rustCallableInputTargetId,
  rustCallableTargetId,
  rustFixedArrayCarrierValue,
  rustFixedArrayTargetType,
  rustFutureTargetId,
  rustJsPromiseTargetId,
  rustNamedTargetType,
  rustNamedTypeCarrierValue,
  rustOnlyTypeGenericArguments,
  rustPrimitiveTypeName,
  rustProgramErrorTargetId,
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
  rustStringTargetId,
  rustStrTargetId,
  rustStrTargetType,
  rustStructuralObjectCarrierValue,
  rustUnitTargetType,
} from "../../../target-model/types/index.js";

export type RustNativeTypePosition = "general" | "parameter" | "return" | "inferred-call";

export interface RustNativeTypeSelectionInput {
  readonly typeDefinitions: RustTypeDefinitions;
  readonly typeParameterNames: ReadonlyMap<string, string> | undefined;
  readonly pathFor: (value: { readonly fileName: string; readonly typeName: string }) => string | undefined;
  readonly additionalArgumentsFor: (carrier: TargetTypeRef) => readonly RustTargetGenericArgument[] | undefined;
  readonly programErrorCarrier: (owner: RustProgramErrorOwner) => TargetTypeRef | undefined;
  readonly producerErrorCarrier: (reference: RustProducerErrorReference) => TargetTypeRef | undefined;
  readonly nativeErrorJoinCarrier: (reference: RustNativeErrorJoinReference) => TargetTypeRef | undefined;
  readonly structuralCarrier: (carrier: TargetTypeRef) => TargetTypeRef | undefined;
}

export type RustNativeTypeSelectionResult =
  | { readonly kind: "resolved"; readonly carrier: TargetTypeRef }
  | { readonly kind: "rejected"; readonly subject: TargetTypeRef; readonly reason: string };

export type RustLogicalNativeCallableAbi =
  | { readonly kind: "stored"; readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef;
      readonly error: TargetTypeRef; readonly lifetime: RustLifetimeRef; readonly runtimeResult: boolean }
  | { readonly kind: "input"; readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef;
      readonly error: TargetTypeRef; readonly binder: RustLifetimeBinder };

export function rustNativeCallableAbi(input: { readonly kind: "logical"; readonly carrier: TargetTypeRef }): RustLogicalNativeCallableAbi | undefined;
export function rustNativeCallableAbi(input: { readonly kind: "physical"; readonly carrier: TargetTypeRef }): RustCallablePhysicalSignature | undefined;
export function rustNativeCallableAbi(input: { readonly kind: "logical" | "physical"; readonly carrier: TargetTypeRef }):
  RustLogicalNativeCallableAbi | RustCallablePhysicalSignature | undefined {
  if (input === null || typeof input !== "object") return undefined;
  if (input.kind === "physical") return rustCallablePhysicalSignature(input.carrier);
  if (input.kind !== "logical") return undefined;
  const carrier = input.carrier;
  const type = carrier.kind === "reference" && !carrier.mutable && carrier.referent.kind === "target-named" &&
    carrier.referent.id === rustCallableInputTargetId ? carrier.referent : carrier;
  if (type.kind !== "target-named" || type.id !== rustCallableTargetId && type.id !== rustCallableInputTargetId) return undefined;
  const lifetime = type.id === rustCallableTargetId ? type.genericArguments?.[0] : undefined;
  if (type.id === rustCallableTargetId && lifetime?.kind !== "lifetime") return undefined;
  const arguments_ = rustOnlyTypeGenericArguments(lifetime === undefined ? type.genericArguments : type.genericArguments?.slice(1));
  const [parameters, result, error] = arguments_ ?? [];
  if (arguments_?.length !== (lifetime === undefined ? 2 : 3) || parameters?.kind !== "tuple" || result === undefined) return undefined;
  if (type.id === rustCallableInputTargetId) {
    const signature = bindRustCallableInputLifetimes(parameters.elements, result);
    return signature === undefined ? undefined : Object.freeze({ kind: "input", ...signature, error: rustRuntimeErrorTargetType() });
  }
  if (lifetime?.kind !== "lifetime" || error === undefined) return undefined;
  const runtimeResult = rustProgramErrorOwner(error)?.kind === "logical";
  return Object.freeze({ kind: "stored", parameters: parameters.elements, result, lifetime: lifetime.lifetime,
    error: runtimeResult ? rustRuntimeErrorTargetType() : error, runtimeResult });
}

export function selectRustNativeCallTypeCarrier(
  carrier: TargetTypeRef,
  input: RustNativeTypeSelectionInput,
): RustNativeTypeSelectionResult | { readonly kind: "inferred" } {
  if (carrier.kind === "target-named" && carrier.id === rustFutureTargetId) return isRustNativeFutureCarrier(carrier)
    ? { kind: "inferred" }
    : { kind: "rejected", subject: carrier, reason: "Native Future inference requires its exact single output carrier." };
  const selected = selectRustNativeTypeCarrier(carrier, input, "inferred-call");
  return selected.kind === "resolved" && nativeTypeContainsOpaque(selected.carrier) ? { kind: "inferred" } : selected;
}

export function rustNativeSourceTypePath(input: {
  readonly moduleName: string | undefined;
  readonly currentModuleName: string;
  readonly typeName: string | undefined;
  readonly nativeProtocol: boolean;
  readonly externalCrate: string | undefined;
  readonly currentCrate: string | undefined;
  readonly externalPublicPathFor: () => string | undefined;
}): string | undefined {
  if (input.moduleName === undefined || input.typeName === undefined) return undefined;
  const external = input.externalCrate !== undefined && input.externalCrate !== input.currentCrate;
  return input.nativeProtocol
    ? `${external ? input.externalCrate : "crate"}::${input.moduleName}::${input.typeName}`
    : external ? input.externalPublicPathFor()
      : input.moduleName === input.currentModuleName ? input.typeName : `crate::${input.moduleName}::${input.typeName}`;
}

export function rustNativeStructuralTypePath(input: {
  readonly targetName: string;
  readonly externalModuleName: string | undefined;
  readonly externalCrate: string | undefined;
  readonly currentCrate: string | undefined;
  readonly currentModuleName: string;
  readonly structuralShapesModuleName: string;
}): string {
  return input.externalModuleName !== undefined && input.externalCrate !== input.currentCrate
    ? `${input.externalModuleName}::${input.targetName}`
    : input.currentModuleName === input.structuralShapesModuleName ? input.targetName
      : `crate::${input.structuralShapesModuleName}::${input.targetName}`;
}

export function selectRustNativeTypeCarrier(
  carrier: TargetTypeRef,
  input: RustNativeTypeSelectionInput,
  position: RustNativeTypePosition,
): RustNativeTypeSelectionResult {
  const selected = selectRustNativeTypeRoot({ kind: "type", carrier }, input, position);
  return selected.kind === "rejected" ? selected : { kind: "resolved", carrier: selected.carrier };
}

export function selectRustNativeCallableTypeCarrier(
  container: TargetTypeRef,
  payload: TargetTypeRef,
  abi: Extract<RustLogicalNativeCallableAbi, { readonly kind: "stored" }>,
  input: RustNativeTypeSelectionInput,
  position: RustNativeTypePosition,
): Extract<RustNativeTypeSelectionResult, { readonly kind: "rejected" }>
  | { readonly kind: "resolved"; readonly carrier: TargetTypeRef; readonly payloadCarrier: TargetTypeRef } {
  if (abi.kind !== "stored") return { kind: "rejected", subject: container,
    reason: "A declared native field callable requires its selected stored invocation ABI." };
  const selected = selectRustNativeTypeRoot({ kind: "callable", carrier: container, payload, abi }, input, position);
  return selected.kind === "rejected" ? selected : selected.payloadCarrier === undefined
    ? { kind: "rejected", subject: container, reason: "A declared native field requires its exact prepared callable payload in the original container." }
    : { kind: "resolved", carrier: selected.carrier, payloadCarrier: selected.payloadCarrier };
}

function selectRustNativeTypeRoot(
  root: { readonly kind: "type"; readonly carrier: TargetTypeRef }
    | { readonly kind: "callable"; readonly carrier: TargetTypeRef; readonly payload: TargetTypeRef; readonly abi: RustLogicalNativeCallableAbi },
  input: RustNativeTypeSelectionInput,
  position: RustNativeTypePosition,
): Extract<RustNativeTypeSelectionResult, { readonly kind: "rejected" }>
  | { readonly kind: "resolved"; readonly carrier: TargetTypeRef; readonly payloadCarrier: TargetTypeRef | undefined } {
  const carrier = root.carrier;
  let payloadCarrier: TargetTypeRef | undefined;
  let rejection: Extract<RustNativeTypeSelectionResult, { readonly kind: "rejected" }> | undefined;
  const active = new Set<TargetTypeRef>();
  const resolvingProducerErrors = new Set<string>();
  const resolvingErrorJoins = new Set<string>();
  let producerErrorWork = 4096;
  const reject = (subject: TargetTypeRef, reason: string): undefined => {
    rejection ??= { kind: "rejected", subject, reason };
    return undefined;
  };
  const argumentsFor = (
    arguments_: readonly RustTargetGenericArgument[] | undefined,
    nativePosition: RustNativeTypePosition,
  ): readonly RustTargetGenericArgument[] | undefined => {
    const selected: RustTargetGenericArgument[] = [];
    for (const argument of arguments_ ?? []) {
      if (argument.kind !== "type") {
        selected.push(argument);
        continue;
      }
      const type = select(argument.type, nativePosition);
      if (type === undefined) return undefined;
      selected.push({ kind: "type", type });
    }
    return selected;
  };
  const traitFor = (trait: RustTargetTraitRef, nativePosition: RustNativeTypePosition): RustTargetTraitRef | undefined => {
    const path = trait.sourceItem === undefined ? trait.path : input.pathFor(trait.sourceItem);
    if (path === undefined) return reject(trait, "Native trait requires its exact selected source item path.");
    const genericArguments = argumentsFor(trait.genericArguments, "general");
    if (genericArguments === undefined) return undefined;
    const associatedConstraints: RustTargetAssociatedConstraint[] = [];
    for (const constraint of trait.associatedConstraints) {
      const arguments_ = argumentsFor(constraint.genericArguments, "general");
      if (arguments_ === undefined) return undefined;
      if (constraint.kind === "equality") {
        const type = select(constraint.type, nativePosition);
        if (type === undefined) return undefined;
        associatedConstraints.push({ ...constraint, genericArguments: arguments_, type });
      } else {
        const traits: RustTargetTraitRef[] = [];
        for (const bound of constraint.traits) {
          const selected = traitFor(bound, nativePosition);
          if (selected === undefined) return undefined;
          traits.push(selected);
        }
        associatedConstraints.push({ ...constraint, genericArguments: arguments_, traits });
      }
    }
    return { kind: "trait-ref", id: trait.id, path, genericArguments, associatedConstraints,
      ...(trait.lifetimeBinder === undefined ? {} : { lifetimeBinder: trait.lifetimeBinder }) };
  };
  const replacement = (source: TargetTypeRef, selected: TargetTypeRef | undefined,
    nativePosition: RustNativeTypePosition): TargetTypeRef | undefined => {
    if (selected === undefined) return reject(source, "Native type requires its completed physical representation and identity.");
    if (selected === source) return reject(source, "Native type representation did not resolve its source carrier.");
    return select(selected, nativePosition);
  };
  const select = (type: TargetTypeRef, nativePosition: RustNativeTypePosition): TargetTypeRef | undefined => {
    if (active.has(type)) return reject(type, "Native type representation contains an unresolved recursive selection.");
    active.add(type);
    try {
      if (root.kind === "callable" && type === root.payload) {
        const selected = callableFor(type, root.abi, nativePosition);
        if (selected !== undefined && payloadCarrier !== undefined && !rustTargetGenericArgumentEquals(
          { kind: "type", type: selected }, { kind: "type", type: payloadCarrier })) return reject(type,
          "One declared native callable payload requires one exact selected representation throughout its container.");
        payloadCarrier = selected;
        return selected;
      }
      const producer = rustProducerErrorReference(type);
      if (producer !== undefined) {
        const key = closedMetadataKey(producer);
        if (producerErrorWork-- <= 0 || resolvingProducerErrors.size >= 128 || resolvingProducerErrors.has(key)) {
          return reject(type, "Native producer error selection requires bounded acyclic physical evidence.");
        }
        resolvingProducerErrors.add(key);
        try { return replacement(type, input.producerErrorCarrier(producer), nativePosition); }
        finally { resolvingProducerErrors.delete(key); }
      }
      const joined = rustNativeErrorJoinReference(type);
      if (joined !== undefined) {
        const key = closedMetadataKey(joined);
        if (producerErrorWork-- <= 0 || resolvingErrorJoins.size >= 128 || resolvingErrorJoins.has(key)) {
          return reject(type, "Native error-join selection requires bounded acyclic physical evidence.");
        }
        resolvingErrorJoins.add(key);
        try { return replacement(type, input.nativeErrorJoinCarrier(joined), nativePosition); }
        finally { resolvingErrorJoins.delete(key); }
      }
      if (isRustNeverCarrier(type)) return nativePosition === "return" ? type
        : rustNamedTargetType("rust.core.Infallible", "core::convert::Infallible", [], [], undefined, [], undefined, []);
      if (isRustAbsenceCarrier(type)) return rustUnitTargetType();
      if (type.kind === "source-primitive") return rustPrimitiveTypeName(type.name) === undefined
        ? reject(type, "Source primitive has no selected native Rust type.") : type;
      if (type.kind === "target-named") {
        if (type.id === rustStringTargetId || type.id === rustStrTargetId) return type;
        if (type.id === rustCallableTargetId || type.id === rustCallableInputTargetId) {
          const signature = rustNativeCallableAbi({ kind: "logical", carrier: type });
          return signature === undefined ? reject(type, "Native callable requires its exact argument, result, error and lifetime contract.")
            : callableFor(type, signature, nativePosition);
        }
        if (type.id === rustProgramErrorTargetId) {
          const owner = rustProgramErrorOwner(type);
          return owner === undefined ? reject(type, "Program error requires its exact physical owner.")
            : replacement(type, input.programErrorCarrier(owner), nativePosition);
        }
        const path = rustBuiltInCarrierDefinitions[type.id]?.renderPath;
        if (path === undefined) return reject(type, "Target carrier has no canonical native type declaration.");
        const genericArguments = argumentsFor(type.id === rustJsPromiseTargetId
          ? type.genericArguments?.map(argument => argument.kind === "type" && isRustNeverCarrier(argument.type)
            ? { kind: "type", type: rustUnitTargetType() } : argument)
          : type.genericArguments, nativePosition);
        return genericArguments === undefined ? undefined : rustNamedTargetType(type.id, path, genericArguments, [], undefined, [], undefined, []);
      }
      if (type.kind === "type-parameter") {
        const selectedName = input.typeParameterNames?.get(type.identity);
        const name = selectedName ?? type.name;
        return isValidRustIdentifier(name) || name === "Self" && selectedName === "Self" ? { ...type, name }
          : reject(type, "Native type parameter requires its selected physical Rust identifier.");
      }
      if (type.kind === "reference") {
        const referent = !type.mutable && type.referent.kind === "target-named" && type.referent.id === rustStringTargetId
          ? rustStrTargetType() : select(type.referent, nativePosition);
        return referent === undefined ? undefined : { ...type, referent };
      }
      if (type.kind === "slice" || type.kind === "array") {
        const element = select(type.element, nativePosition);
        return element === undefined ? undefined : type.kind === "slice" ? { ...type, element }
          : rustNamedTargetType("rust.alloc.Vec", "Vec", [{ kind: "type", type: element }], [], undefined, [], undefined, []);
      }
      if (type.kind === "pointer") {
        if (type.mutability !== "const" && type.mutability !== "mut") return reject(type,
          "Native pointer requires its selected const or mutable form.");
        const pointee = select(type.pointee, nativePosition);
        return pointee === undefined ? undefined : { ...type, pointee };
      }
      if (type.kind === "function-pointer" || type.kind === "closure") {
        const args: TargetTypeRef[] = [];
        for (const argument of type.args) {
          const selected = select(argument, "general");
          if (selected === undefined) return undefined;
          args.push(selected);
        }
        const result = select(type.result, "return");
        return result === undefined ? undefined : { ...type, args, result };
      }
      if (type.kind === "tuple") {
        const elements: TargetTypeRef[] = [];
        for (const element of type.elements) {
          const selected = select(element, nativePosition);
          if (selected === undefined) return undefined;
          elements.push(selected);
        }
        return { kind: "tuple", elements };
      }
      const fixed = rustFixedArrayCarrierValue(type);
      if (fixed !== undefined) {
        const element = select(fixed.element, nativePosition);
        return element === undefined ? undefined : rustFixedArrayTargetType(element, fixed.length);
      }
      const named = rustNamedTypeCarrierValue(type);
      if (named !== undefined) {
        const genericArguments = argumentsFor(named.genericArguments, nativePosition);
        const genericDefaults = argumentsFor(named.genericDefaults, "general");
        if (genericArguments === undefined || genericDefaults === undefined) return undefined;
        const typeRequirements: RustNamedTypeTraitRequirement[] = [];
        for (const requirement of named.typeRequirements) {
          const trait = traitFor(requirement.trait, "general");
          if (trait === undefined) return undefined;
          typeRequirements.push({ ...requirement, trait });
        }
        let count = genericArguments.length;
        const defaultOffset = count - genericDefaults.length;
        while (count > defaultOffset && rustTargetGenericArgumentEquals(
          genericArguments[count - 1], genericDefaults[count - 1 - defaultOffset])) count -= 1;
        return rustNamedTargetType(named.id, named.path, genericArguments, genericDefaults, named.traits, named.upcasts,
          named.nativeErrorIdentity, typeRequirements, count);
      }
      if (rustStructuralObjectCarrierValue(type) !== undefined || rustGenericCallableValue(type) !== undefined ||
        rustFrameCallableValue(type) !== undefined || rustClassConstructorInstance(type) !== undefined) {
        return replacement(type, input.structuralCarrier(type), nativePosition);
      }
      const source = rustSourceTypeCarrierValue(type);
      if (source !== undefined) {
        const path = input.pathFor(source);
        const additional = input.additionalArgumentsFor(type);
        if (path === undefined || additional === undefined) return reject(type,
          "Source type requires its selected native path and complete generic storage arguments.");
        const genericArguments = argumentsFor([...source.genericArguments, ...additional], nativePosition);
        return genericArguments === undefined ? undefined
          : rustNamedTargetType(closedMetadataKey([source.fileName, source.typeName]), path, genericArguments, [], undefined, [], undefined, []);
      }
      const union = rustSourceUnionCarrierValue(type);
      if (union !== undefined) {
        if (union.origin === "generated") return replacement(type, input.structuralCarrier(type), nativePosition);
        const path = input.pathFor(union);
        const arguments_ = rustSourceUnionPayloadArguments(type, input.typeDefinitions);
        if (path === undefined || arguments_ === undefined) return reject(type,
          "Source union requires its selected native path and exact physical payload arguments.");
        const genericArguments = argumentsFor(arguments_, nativePosition);
        return genericArguments === undefined ? undefined
          : rustNamedTargetType(closedMetadataKey([union.origin, union.fileName, union.typeName]), path, genericArguments, [], undefined, [], undefined, []);
      }
      if (type.kind === "trait-ref") {
        if ((type.lifetimeBinder?.parameters.length ?? 0) !== 0) return reject(type,
          "A standalone native trait type cannot carry a higher-ranked binder.");
        return traitFor(type, nativePosition);
      }
      if (type.kind === "trait-object") {
        const principal = traitFor(type.principal, "general");
        const autoTraits: RustTargetTraitRef[] = [];
        for (const trait of type.autoTraits) {
          const selected = traitFor(trait, "general");
          if (selected === undefined) return undefined;
          autoTraits.push(selected);
        }
        return principal === undefined ? undefined : { ...type, principal, autoTraits };
      }
      if (type.kind === "impl-trait") {
        const bounds: RustTargetTraitRef[] = [];
        for (const bound of type.bounds) {
          const selected = traitFor(bound, nativePosition);
          if (selected === undefined) return undefined;
          bounds.push(selected);
        }
        const captures = type.captures === undefined ? undefined : argumentsFor(type.captures, "general");
        if (nativeArgumentsContainOpaque(captures)) return reject(type,
          "A native precise capture clause cannot contain an anonymous implementation type.");
        return type.captures !== undefined && captures === undefined ? undefined : {
          kind: "impl-trait", id: type.id, bounds, outlives: type.outlives,
          ...(nativePosition === "parameter" || captures === undefined ? {} : { captures }),
        };
      }
      if (type.kind === "associated-type") {
        const owner = select(type.owner, "general");
        const trait = type.trait === undefined ? undefined : traitFor(type.trait, "general");
        const genericArguments = argumentsFor(type.genericArguments, "general");
        if (owner === undefined || type.trait !== undefined && trait === undefined || genericArguments === undefined) return undefined;
        if ((trait?.lifetimeBinder?.parameters.length ?? 0) !== 0) return reject(type,
          "A qualified native associated type requires an unbound trait owner.");
        return { ...type, owner, ...(trait === undefined ? {} : { trait }), genericArguments };
      }
      return reject(type, "Carrier has no completed native Rust type representation.");
    } finally { active.delete(type); }
  };
  const callableFor = (type: TargetTypeRef, signature: RustLogicalNativeCallableAbi,
    nativePosition: RustNativeTypePosition): TargetTypeRef | undefined => {
    const selectedParameters = select({ kind: "tuple", elements: signature.parameters }, "general");
    const selectedResult = select(signature.result, "general");
    if (selectedParameters === undefined || selectedResult === undefined) return undefined;
    if (signature.kind === "input") {
      return { kind: "impl-trait", id: rustCallableInputTargetId, bounds: [{ kind: "trait-ref", id: rustCallableInputTargetId,
        path: "rt::CallableImplementation", genericArguments: [{ kind: "type", type: selectedParameters }],
        associatedConstraints: [{ kind: "equality", identity: `${rustCallableInputTargetId}.Output`, name: "Output",
          genericArguments: [], type: rustNamedTargetType("rust.runtime.TsonicResult", "rt::TsonicResult",
            [{ kind: "type", type: selectedResult }], [], undefined, [], undefined, []) }], lifetimeBinder: signature.binder }], outlives: [],
        ...(nativePosition === "parameter" ? {} : { captures: [] }) };
    }
    const selectedError = signature.runtimeResult ? undefined : select(signature.error, "general");
    if (!signature.runtimeResult && selectedError === undefined) return reject(type,
      "Stored native callable has no exact selected error representation.");
    const resultType = signature.runtimeResult ? rustNamedTargetType("rust.runtime.TsonicResult", "rt::TsonicResult",
      [{ kind: "type", type: selectedResult }], [], undefined, [], undefined, []) : rustNamedTargetType("rust.core.Result", "Result",
      [{ kind: "type", type: selectedResult }, { kind: "type", type: selectedError! }], [], undefined, [], undefined, []);
    return rustNamedTargetType(rustCallableTargetId, "rt::Callable", [{ kind: "lifetime", lifetime: signature.lifetime },
      { kind: "type", type: selectedParameters }, { kind: "type", type: resultType }], [], undefined, [], undefined, []);
  };
  const selected = select(carrier, position);
  if (selected === undefined) return rejection ?? { kind: "rejected", subject: carrier,
    reason: "Native type requires completed physical metadata." };
  if (!nativeTypeLegalInPosition(selected, position)) return { kind: "rejected", subject: carrier,
    reason: "Native opaque callable or impl Trait is not legal in this type position." };
  return { kind: "resolved", carrier: snapshotClosedMetadata(selected),
    payloadCarrier: payloadCarrier === undefined ? undefined : snapshotClosedMetadata(payloadCarrier) };
}

function nativeTypeLegalInPosition(type: TargetTypeRef, position: RustNativeTypePosition): boolean {
  if (position === "inferred-call" || !nativeTypeContainsOpaque(type)) return true;
  if (position === "general") return false;
  if (type.kind === "closure") return [...type.args, type.result].every(selected => !nativeTypeContainsOpaque(selected));
  if (type.kind === "impl-trait") return type.bounds.every(bound => nativeOpaqueBoundIsLegal(bound, position)) &&
    !nativeArgumentsContainOpaque(type.captures);
  const named = rustNamedTypeCarrierValue(type);
  if (named !== undefined) return named.genericArguments.every(argument =>
    argument.kind !== "type" || nativeTypeLegalInPosition(argument.type, position));
  switch (type.kind) {
    case "reference": return nativeTypeLegalInPosition(type.referent, position);
    case "pointer": return nativeTypeLegalInPosition(type.pointee, position);
    case "tuple": return type.elements.every(element => nativeTypeLegalInPosition(element, position));
    case "slice": return nativeTypeLegalInPosition(type.element, position);
    case "trait-ref": return !nativeArgumentsContainOpaque(type.genericArguments) &&
      !nativeConstraintsContainOpaque(type.associatedConstraints);
    default: {
      const fixed = rustFixedArrayCarrierValue(type);
      return fixed !== undefined && nativeTypeLegalInPosition(fixed.element, position);
    }
  }
}

function nativeOpaqueBoundIsLegal(trait: RustTargetTraitRef, position: "parameter" | "return"): boolean {
  return !nativeArgumentsContainOpaque(trait.genericArguments) && trait.associatedConstraints.every(constraint =>
    !nativeArgumentsContainOpaque(constraint.genericArguments) && (constraint.kind === "equality"
      ? nativeTypeLegalInPosition(constraint.type, position)
      : constraint.traits.every(bound => nativeOpaqueBoundIsLegal(bound, position))));
}

function nativeArgumentsContainOpaque(arguments_: readonly RustTargetGenericArgument[] | undefined): boolean {
  return (arguments_ ?? []).some(argument => argument.kind === "type" && nativeTypeContainsOpaque(argument.type));
}

function nativeConstraintsContainOpaque(constraints: readonly RustTargetAssociatedConstraint[]): boolean {
  return constraints.some(constraint => nativeArgumentsContainOpaque(constraint.genericArguments) ||
    (constraint.kind === "equality" ? nativeTypeContainsOpaque(constraint.type)
      : constraint.traits.some(nativeTypeContainsOpaque)));
}

function nativeTypeContainsOpaque(type: TargetTypeRef): boolean {
  if (type.kind === "closure" || type.kind === "impl-trait") return true;
  const named = rustNamedTypeCarrierValue(type);
  if (named !== undefined) return nativeArgumentsContainOpaque(named.genericArguments);
  const fixed = rustFixedArrayCarrierValue(type);
  if (fixed !== undefined) return nativeTypeContainsOpaque(fixed.element);
  switch (type.kind) {
    case "reference": return nativeTypeContainsOpaque(type.referent);
    case "pointer": return nativeTypeContainsOpaque(type.pointee);
    case "tuple": return type.elements.some(nativeTypeContainsOpaque);
    case "slice": return nativeTypeContainsOpaque(type.element);
    case "function-pointer": return type.args.some(nativeTypeContainsOpaque) || nativeTypeContainsOpaque(type.result);
    case "trait-ref": return nativeArgumentsContainOpaque(type.genericArguments) ||
      nativeConstraintsContainOpaque(type.associatedConstraints);
    case "trait-object": return nativeTypeContainsOpaque(type.principal) || type.autoTraits.some(nativeTypeContainsOpaque);
    case "associated-type": return nativeTypeContainsOpaque(type.owner) ||
      type.trait !== undefined && nativeTypeContainsOpaque(type.trait) || nativeArgumentsContainOpaque(type.genericArguments);
    default: return false;
  }
}

export interface RustNativeTypeInputContext {
  readonly moduleName: string;
  readonly crateName: string | undefined;
  readonly moduleNameByFileName: ReadonlyMap<string, string>;
  readonly externalCrateNameByFileName: ReadonlyMap<string, string>;
  readonly externalPublicPathFor: (fileName: string, targetName: string) => string | undefined;
  readonly nativeTypeItemFor: (fileName: string, sourceName: string) => {
    readonly fileName: string; readonly targetName: string; readonly nativeProtocol: boolean;
  } | undefined;
  readonly externalStructuralShapeModuleByFileName: ReadonlyMap<string, string>;
  readonly structuralShapesModuleName: string;
  readonly typeParameterNames: ReadonlyMap<string, string> | undefined;
  readonly typeDefinitions: RustTypeDefinitions;
  readonly projectTypes: Pick<RustProjectTypePolicy, "definitionForCarrier">;
  readonly objectRepresentations: {
    representationFor(definition: RustProjectTypeDefinition | undefined): {
      readonly kind: "value" | "shared-immutable" | "shared-mutable" | "closed-hierarchy" | "open-hierarchy";
    } | undefined;
  };
  readonly structuralShapes: {
    definitionForCarrier(carrier: TargetTypeRef): NativeStructuralDefinition | undefined;
    unionForCarrier(carrier: TargetTypeRef): Pick<NativeStructuralDefinition, "ownerFileName" | "targetName"> | undefined;
  };
  readonly callableValues: {
    readonly generic: { readonly physical: {
      definitionFor(carrier: TargetTypeRef): { readonly ownerFileName: string; readonly targetName: string } | undefined;
      argumentsFor(carrier: TargetTypeRef): readonly RustTargetGenericArgument[] | undefined;
    } };
    readonly frames: {
      definitionFor(carrier: TargetTypeRef): {
        readonly ownerFileName: string;
        readonly targetName: string;
        readonly environmentParameters: readonly TargetTypeRef[];
        readonly storage: { readonly kind: "standalone" | "object" };
        readonly activation: { readonly ownerDeclaration: Node };
      } | undefined;
      entryFor(carrier: TargetTypeRef): {
        readonly targetName: string;
        readonly environmentIndexes: readonly number[];
        readonly hasIndependent: boolean;
      } | undefined;
    };
  };
  readonly classValues: {
    forCarrier(carrier: TargetTypeRef): { readonly environment?: {
      readonly typeName: string;
      readonly genericParameterIndexes: readonly number[];
      readonly storage: "value" | "shared";
      readonly instancesUseEnvironment: boolean;
    } } | undefined;
    forDeclaration(declaration: Node): { readonly environment?: { readonly instancesUseEnvironment: boolean } } | undefined;
  };
  readonly errorRegions: Pick<RustErrorRegionRecords, "producerError" | "declarationsFor">;
  readonly additionalArgumentsFor: (carrier: TargetTypeRef, parameterIndexes?: readonly number[]) => readonly RustTargetGenericArgument[] | undefined;
  readonly programErrorBoundaryFor: (owner: RustProgramErrorOwner) => RustSourcePackageErrorBoundary | undefined;
}

interface NativeStructuralDefinition {
  readonly ownerFileName: string;
  readonly targetName: string;
  readonly dispatchName?: string;
  readonly genericArguments: readonly RustTargetGenericArgument[];
}

export function rustNativeTypeSelectionInput(context: RustNativeTypeInputContext): RustNativeTypeSelectionInput {
  return {
    typeDefinitions: context.typeDefinitions,
    typeParameterNames: context.typeParameterNames,
    pathFor: value => rustNativeSourceItemPath(value, context),
    additionalArgumentsFor: context.additionalArgumentsFor,
    programErrorCarrier: owner => {
      const boundary = context.programErrorBoundaryFor(owner);
      return boundary === undefined ? undefined : rustNamedTargetType(boundary.errorTypeIdentity, boundary.errorTypePath,
        [], [], undefined, [], boundary.errorTypeIdentity, []);
    },
    producerErrorCarrier: reference => context.errorRegions.producerError(reference),
    nativeErrorJoinCarrier: reference => {
      const name = context.errorRegions.declarationsFor(reference.fileName)
        .find(declaration => declaration.arity === reference.errors.length)?.name;
      const path = nativeItemPath(context, reference.fileName, name, true);
      const identity = rustNativeErrorJoinIdentity(reference.fileName, reference.errors.length);
      return path === undefined ? undefined : rustNamedTargetType(identity, path,
        reference.errors.map(type => ({ kind: "type", type })), [], undefined, [],
        identity, []);
    },
    structuralCarrier: carrier => {
      if (rustFrameCallableValue(carrier) !== undefined) return rustNativeFrameCallableCarriers(carrier, context)?.root;
      const instance = rustClassConstructorInstance(carrier);
      if (instance !== undefined) return rustNativeClassEnvironmentCarrier(instance, context, true);
      const generic = rustGenericCallableValue(carrier);
      if (generic !== undefined) {
        const physical = context.callableValues.generic.physical;
        const definition = physical.definitionFor(carrier);
        const arguments_ = physical.argumentsFor(carrier);
        const path = definition === undefined ? undefined
          : nativeItemPath(context, definition.ownerFileName, definition.targetName, true);
        return path === undefined || arguments_ === undefined ? undefined
          : rustNamedTargetType(closedMetadataKey(carrier), path,
            rustGenericCallableStorageArguments(generic.environment, arguments_), [], undefined, [], undefined, []);
      }
      const union = rustSourceUnionCarrierValue(carrier);
      const structural = union?.origin === "generated" ? undefined : context.structuralShapes.definitionForCarrier(carrier);
      const definition = union?.origin === "generated" ? context.structuralShapes.unionForCarrier(carrier) : structural;
      if (definition === undefined) return undefined;
      const arguments_ = union?.origin === "generated" ? rustSourceUnionPayloadArguments(carrier, context.typeDefinitions)
        : structural?.genericArguments;
      if (arguments_ === undefined) return undefined;
      const path = rustNativeStructuralTypePath({ targetName: definition.targetName,
        externalModuleName: context.externalStructuralShapeModuleByFileName.get(definition.ownerFileName),
        externalCrate: context.externalCrateNameByFileName.get(definition.ownerFileName), currentCrate: context.crateName,
        currentModuleName: context.moduleName, structuralShapesModuleName: context.structuralShapesModuleName });
      const state = rustNamedTargetType(closedMetadataKey(carrier), path, arguments_, [], undefined, [], undefined, []);
      return union?.origin === "generated" || rustStructuralObjectCarrierValue(carrier)?.representation === "value" ||
        structural?.dispatchName !== undefined ? state
        : rustNamedTargetType("rust.runtime.ObjectHandle", "rt::ObjectHandle", [{ kind: "type", type: state }], [], undefined, [], undefined, []);
    },
  };
}

export function rustNativeSourceItemPath(
  value: { readonly fileName: string; readonly typeName: string },
  context: Pick<RustNativeTypeInputContext, "moduleName" | "crateName" | "moduleNameByFileName" |
    "externalCrateNameByFileName" | "externalPublicPathFor" | "nativeTypeItemFor">,
): string | undefined {
  const selected = context.nativeTypeItemFor(value.fileName, value.typeName);
  return selected === undefined ? undefined : nativeItemPath(context, selected.fileName, selected.targetName, selected.nativeProtocol);
}

function nativeItemPath(
  context: Pick<RustNativeTypeInputContext, "moduleName" | "crateName" | "moduleNameByFileName" |
    "externalCrateNameByFileName" | "externalPublicPathFor">,
  fileName: string,
  typeName: string | undefined,
  nativeProtocol: boolean,
): string | undefined {
  return rustNativeSourceTypePath({ moduleName: context.moduleNameByFileName.get(fileName), currentModuleName: context.moduleName,
    typeName, nativeProtocol, externalCrate: context.externalCrateNameByFileName.get(fileName), currentCrate: context.crateName,
    externalPublicPathFor: () => typeName === undefined ? undefined : context.externalPublicPathFor(fileName, typeName) });
}

export function rustNativeProjectGeneratedCarrier(
  carrier: TargetTypeRef,
  targetName: string,
  context: RustNativeTypeInputContext,
): TargetTypeRef | undefined {
  const source = rustSourceTypeCarrierValue(carrier);
  const definition = context.projectTypes.definitionForCarrier(carrier);
  const path = source === undefined ? undefined : nativeItemPath(context, source.fileName, targetName, false);
  const arguments_ = context.additionalArgumentsFor(carrier);
  if (source === undefined || definition === undefined || path === undefined || arguments_ === undefined ||
    source.genericArguments.length !== definition.genericParameters.length ||
    definition.genericParameters.some((parameter, index) => source.genericArguments[index]?.kind !== parameter.kind) ||
    source.genericArguments.some(argument => argument.kind !== "type" && argument.kind !== "lifetime")) return undefined;
  return rustNamedTargetType(closedMetadataKey([source.fileName, targetName]), path, [...source.genericArguments, ...arguments_],
    [], undefined, [], undefined, []);
}

export function rustNativeClassEnvironmentCarrier(
  carrier: TargetTypeRef,
  context: RustNativeTypeInputContext,
  handle: boolean,
): TargetTypeRef | undefined {
  const environment = context.classValues.forCarrier(carrier)?.environment;
  const source = rustSourceTypeCarrierValue(carrier);
  if (environment === undefined || source === undefined) return undefined;
  const path = nativeItemPath(context, source.fileName, environment.typeName, false);
  const arguments_ = environment.genericParameterIndexes.map(index => source.genericArguments[index]);
  const additional = context.additionalArgumentsFor(carrier, environment.genericParameterIndexes);
  if (path === undefined || additional === undefined || arguments_.some(argument => argument === undefined)) return undefined;
  const selected: RustTargetGenericArgument[] = [];
  for (const argument of arguments_) {
    if (argument === undefined) return undefined;
    selected.push(argument);
  }
  const state = rustNamedTargetType(closedMetadataKey([source.fileName, environment.typeName]), path, [...selected, ...additional],
    [], undefined, [], undefined, []);
  return !handle || environment.storage === "value" ? state
    : rustNamedTargetType("rust.alloc.rc.Rc", "alloc::rc::Rc", [{ kind: "type", type: state }], [], undefined, [], undefined, []);
}

export function rustNativeObjectOwnerPaths(
  kind: "value" | "shared-immutable" | "shared-mutable" | "closed-hierarchy" | "open-hierarchy",
): { readonly owner: "rt::ObjectHandle" | "rt::ObjectRef";
  readonly state: "rt::ObjectHandleState" | "rt::ObjectRefState" } | undefined {
  switch (kind) {
    case "shared-immutable": return { owner: "rt::ObjectRef", state: "rt::ObjectRefState" };
    case "shared-mutable":
    case "closed-hierarchy":
    case "open-hierarchy": return { owner: "rt::ObjectHandle", state: "rt::ObjectHandleState" };
    case "value": return undefined;
  }
}

export function rustNativeFrameCallableEnvironment(
  carrier: TargetTypeRef,
  frames: RustNativeTypeInputContext["callableValues"]["frames"],
): { readonly definition: NonNullable<ReturnType<RustNativeTypeInputContext["callableValues"]["frames"]["definitionFor"]>>;
  readonly entry: NonNullable<ReturnType<RustNativeTypeInputContext["callableValues"]["frames"]["entryFor"]>>;
  readonly environment: readonly TargetTypeRef[] } | undefined {
  const value = rustFrameCallableValue(carrier);
  const definition = frames.definitionFor(carrier);
  const entry = frames.entryFor(carrier);
  if (value === undefined || definition === undefined || entry === undefined ||
    value.environment.length !== entry.environmentIndexes.length) return undefined;
  const environment: (TargetTypeRef | undefined)[] = Array.from({ length: definition.environmentParameters.length }, () => undefined);
  value.environment.forEach((type, index) => {
    const target = entry.environmentIndexes[index]!;
    if (target >= 0 && target < environment.length) environment[target] = type;
  });
  const selectedEnvironment: TargetTypeRef[] = [];
  for (const type of environment) {
    if (type === undefined) return undefined;
    selectedEnvironment.push(type);
  }
  return Object.freeze({ definition, entry, environment: Object.freeze(selectedEnvironment) });
}

export function rustNativeFrameCallableCarriers(
  carrier: TargetTypeRef,
  context: RustNativeTypeInputContext,
): { readonly frame: TargetTypeRef; readonly entry: TargetTypeRef; readonly root: TargetTypeRef } | undefined {
  const value = rustFrameCallableValue(carrier);
  const selected = rustNativeFrameCallableEnvironment(carrier, context.callableValues.frames);
  if (value === undefined || selected === undefined) return undefined;
  const { definition, entry, environment } = selected;
  const frame = rustNativeFrameDefinitionCarrier(definition, environment,
    value.owner.kind === "class" ? value.owner.instance : undefined, context);
  const entryPath = nativeItemPath(context, definition.ownerFileName, entry.targetName, true);
  if (frame === undefined || entryPath === undefined) return undefined;
  const arguments_: RustTargetGenericArgument[] = environment.map(type => ({ kind: "type", type }));
  const selectedEntry = rustNamedTargetType(closedMetadataKey([definition.ownerFileName, entry.targetName]), entryPath, arguments_,
    [], undefined, [], undefined, []);
  return { frame, entry: selectedEntry, root: rustNamedTargetType(
    entry.hasIndependent ? "rust.runtime.FrameCallableFamily" : "rust.runtime.FrameCallable",
    entry.hasIndependent ? "rt::FrameCallableFamily" : "rt::FrameCallable",
    [{ kind: "type", type: frame }, { kind: "type", type: selectedEntry }], [], undefined, [], undefined, []) };
}

export function rustNativeFrameDefinitionCarrier(
  definition: NonNullable<ReturnType<RustNativeTypeInputContext["callableValues"]["frames"]["definitionFor"]>>,
  environment: readonly TargetTypeRef[],
  ownerInstance: TargetTypeRef | undefined,
  context: RustNativeTypeInputContext,
): TargetTypeRef | undefined {
  if (environment.length !== definition.environmentParameters.length) return undefined;
  const path = nativeItemPath(context, definition.ownerFileName, definition.targetName, true);
  if (path === undefined) return undefined;
  if (definition.storage.kind === "standalone") return rustNamedTargetType(closedMetadataKey([definition.ownerFileName,
    definition.targetName]), path, environment.map(type => ({ kind: "type", type })), [], undefined, [], undefined, []);
  if (ownerInstance === undefined) return undefined;
  const owner = context.projectTypes.definitionForCarrier(ownerInstance);
  const representation = context.objectRepresentations.representationFor(owner);
  if (owner?.kind !== "class" || owner.declaration !== definition.activation.ownerDeclaration || representation === undefined) return undefined;
  const state = rustNativeProjectGeneratedCarrier(ownerInstance, owner.stateName, context);
  const selected = context.classValues.forDeclaration(owner.declaration)?.environment;
  const selectedEnvironment = selected?.instancesUseEnvironment !== true ? undefined
    : rustNativeClassEnvironmentCarrier(ownerInstance, context, true);
  const paths = rustNativeObjectOwnerPaths(representation.kind);
  if (state === undefined || paths === undefined || selected?.instancesUseEnvironment === true && selectedEnvironment === undefined) return undefined;
  return rustNamedTargetType(paths.state, paths.state, [{ kind: "type", type: state },
    ...(selectedEnvironment === undefined ? [] : [{ kind: "type" as const, type: selectedEnvironment }])],
    [], undefined, [], undefined, []);
}

export function selectRustNativeCallableEnvironment(
  environment: {
    readonly fileName: string;
    readonly stateName: string;
    readonly arguments: readonly RustTargetGenericArgument[];
    readonly typeRequirements: readonly RustNamedTypeTraitRequirement[];
    readonly storage: "value" | "shared" | "cyclic";
  },
  context: RustNativeTypeInputContext,
): { readonly kind: "resolved"; readonly stateCarrier: TargetTypeRef;
  readonly holderCarrier: TargetTypeRef; readonly constructor: string | null }
  | Extract<RustNativeTypeSelectionResult, { readonly kind: "rejected" }> {
  const subject: TargetTypeRef = { kind: "tuple", elements: environment.arguments.flatMap(argument =>
    argument.kind === "type" ? [argument.type] : []) };
  if (!Array.isArray(environment.typeRequirements) || environment.storage !== "value" &&
    environment.storage !== "shared" && environment.storage !== "cyclic") return { kind: "rejected", subject,
    reason: "A native callable environment requires its complete original requirements and selected storage disposition." };
  const path = nativeItemPath(context, environment.fileName, environment.stateName, true);
  if (path === undefined || !isValidRustIdentifier(environment.stateName)) return { kind: "rejected", subject,
    reason: "A native callable environment requires its exact original generated state and defining package path." };
  const selected = selectRustNativeTypeCarrier(rustNamedTargetType(
    closedMetadataKey([environment.fileName, environment.stateName]), path, environment.arguments,
    [], undefined, [], undefined, environment.typeRequirements), rustNativeTypeSelectionInput(context), "general");
  if (selected.kind === "rejected") return selected;
  const stateCarrier = selected.carrier;
  const holderCarrier = environment.storage === "value" ? stateCarrier
    : rustNamedTargetType("rust.alloc.rc.Rc", "alloc::rc::Rc", [{ kind: "type", type: stateCarrier }],
      [], undefined, [], undefined, []);
  return Object.freeze({ kind: "resolved", stateCarrier, holderCarrier,
    constructor: environment.storage === "value" ? null
      : environment.storage === "shared" ? "alloc::rc::Rc::new" : "alloc::rc::Rc::new_cyclic" });
}

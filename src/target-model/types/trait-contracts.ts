import {
  rustBoundSemanticKey,
  rustGenericArgumentSemanticKey,
  rustSemanticIdentityKey,
  rustTraitSemanticKey,
} from "../semantics/index.js";
import {
  isRustBoundValue,
  isRustGenericArgumentValue,
  isRustTraitReference,
} from "./equality.js";
import {
  rustBoundOpenGenericIdentityKeys,
  rustTraitOpenGenericIdentityKeys,
} from "./generic-reference-collection.js";
import {
  rustGenericParameterIdentity,
  rustGenericSubstitutionsForOpenArguments,
  substituteRustBound,
  substituteRustTraitRef,
} from "./generic-substitution.js";
import { rustBoundsAlphaEquivalent } from "./alpha-equivalence.js";
import type {
  RustNamedTypeTraitContractEntry,
  RustNamedTypeTraitContractIndex,
  RustNamedTypeTraitContract,
  RustNamedTypeTraitImplementation,
  RustNamedTypeTraitRequirement,
} from "./model.js";
import type { RustTraitRef } from "../semantics/index.js";
import { rustBuiltinIdentity } from "../semantics/index.js";
import {
  closedMetadataEquals,
  snapshotClosedMetadata,
} from "../metadata/closed-data.js";

export function createRustNamedTypeTraitContractIndex(
  entries: readonly RustNamedTypeTraitContractEntry[],
): RustNamedTypeTraitContractIndex {
  const byIdentity = new Map<string, RustNamedTypeTraitContractEntry>();
  for (const entry of entries) {
    if (!isRustNamedTypeTraitContract(entry.contract)) {
      throw new Error("Rust named-type trait evidence contains an invalid contract.");
    }
    const identityKey = rustSemanticIdentityKey(entry.typeIdentity);
    const existing = byIdentity.get(identityKey);
    if (existing !== undefined && !closedMetadataEquals(existing.contract, entry.contract)) {
      throw new Error(`Rust named type '${identityKey}' has conflicting trait contracts.`);
    }
    byIdentity.set(identityKey, snapshotClosedMetadata(entry));
  }
  const selected = Object.freeze([...byIdentity.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([, entry]) => entry));
  return Object.freeze<RustNamedTypeTraitContractIndex>({
    contractFor(typeIdentity) {
      return byIdentity.get(rustSemanticIdentityKey(typeIdentity))?.contract;
    },
    entries() {
      return selected;
    },
  });
}

export function isRustNamedTypeTraitContract(value: unknown): value is RustNamedTypeTraitContract {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["implementations"]) ||
    !Array.isArray(value.implementations)) return false;
  const implementations: RustNamedTypeTraitImplementation[] = [];
  let previousImplementationKey: string | undefined;
  for (const candidate of value.implementations) {
    if (!isRustTraitImplementation(candidate)) return false;
    const implementationKey = rustNamedTypeTraitImplementationSemanticKey(candidate);
    if (previousImplementationKey !== undefined && previousImplementationKey >= implementationKey) {
      return false;
    }
    previousImplementationKey = implementationKey;
    implementations.push(candidate);
  }
  return implementations
    .filter((implementation) => isExactRustTrait(implementation.trait, "core::marker::Copy"))
    .every((copyImplementation) => implementations.some((cloneImplementation) =>
      isExactRustTrait(cloneImplementation.trait, "core::clone::Clone") &&
      copyContractImpliesCloneContract(copyImplementation, cloneImplementation)));
}

function isRustTraitImplementation(
  value: unknown,
): value is RustNamedTypeTraitImplementation {
  if (!isPlainRecord(value) ||
    !hasExactKeys(value, ["genericBindings", "requirements", "trait"]) ||
    !isRustTraitReference(value.trait) ||
    !Array.isArray(value.genericBindings) ||
    !Array.isArray(value.requirements)) return false;

  const bindingByIndex = new Map<number, RustNamedTypeTraitImplementation["genericBindings"][number]>();
  const bindingIdentities = new Set<string>();
  let previousBindingKey: string | undefined;
  for (const candidate of value.genericBindings) {
    if (!isPlainRecord(candidate) ||
      !hasExactKeys(candidate, ["genericArgumentIndex", "parameter"]) ||
      typeof candidate.genericArgumentIndex !== "number" ||
      !Number.isSafeInteger(candidate.genericArgumentIndex) ||
      candidate.genericArgumentIndex < 0 ||
      !isRustGenericArgumentValue(candidate.parameter)) return false;
    const binding: RustNamedTypeTraitImplementation["genericBindings"][number] =
      Object.freeze({
        genericArgumentIndex: candidate.genericArgumentIndex,
        parameter: candidate.parameter,
      });
    const identity = rustGenericParameterIdentity(binding.parameter);
    if (identity === undefined || bindingByIndex.has(binding.genericArgumentIndex) ||
      bindingIdentities.has(identity.identityKey)) return false;
    bindingByIndex.set(binding.genericArgumentIndex, binding);
    bindingIdentities.add(identity.identityKey);
    const bindingKey = rustNamedTypeTraitGenericBindingSemanticKey(binding);
    if (previousBindingKey !== undefined && previousBindingKey >= bindingKey) return false;
    previousBindingKey = bindingKey;
  }

  if (!openIdentitiesAreBound(rustTraitOpenGenericIdentityKeys(value.trait), bindingIdentities)) {
    return false;
  }
  let previousRequirementKey: string | undefined;
  for (const candidate of value.requirements) {
    if (!isPlainRecord(candidate) ||
      !hasExactKeys(candidate, ["bound", "genericArgumentIndex"]) ||
      typeof candidate.genericArgumentIndex !== "number" ||
      !Number.isSafeInteger(candidate.genericArgumentIndex) ||
      candidate.genericArgumentIndex < 0 ||
      !isRustBoundValue(candidate.bound) || candidate.bound.kind !== "trait" ||
      candidate.bound.polarity !== "required") return false;
    const requirement: RustNamedTypeTraitRequirement = Object.freeze({
      genericArgumentIndex: candidate.genericArgumentIndex,
      bound: candidate.bound,
    });
    if (bindingByIndex.get(requirement.genericArgumentIndex)?.parameter.kind !== "type" ||
      !openIdentitiesAreBound(
        rustBoundOpenGenericIdentityKeys(requirement.bound),
        bindingIdentities,
      )) return false;
    const requirementKey = rustNamedTypeTraitRequirementSemanticKey(requirement);
    if (previousRequirementKey !== undefined && previousRequirementKey >= requirementKey) {
      return false;
    }
    previousRequirementKey = requirementKey;
  }
  return true;
}

function openIdentitiesAreBound(
  identities: readonly string[],
  bindingIdentities: ReadonlySet<string>,
): boolean {
  return identities.every((identity) => bindingIdentities.has(identity));
}

function copyContractImpliesCloneContract(
  copyImplementation: RustNamedTypeTraitImplementation,
  cloneImplementation: RustNamedTypeTraitImplementation,
): boolean {
  if (copyImplementation.genericBindings.length !== cloneImplementation.genericBindings.length) {
    return false;
  }
  const copyParameters = copyImplementation.genericBindings.map(({ parameter }) => parameter);
  const cloneParameters = cloneImplementation.genericBindings.map(({ parameter }) => parameter);
  for (let index = 0; index < copyImplementation.genericBindings.length; index += 1) {
    const copyBinding = copyImplementation.genericBindings[index]!;
    const cloneBinding = cloneImplementation.genericBindings[index]!;
    if (copyBinding.genericArgumentIndex !== cloneBinding.genericArgumentIndex ||
      copyBinding.parameter.kind !== cloneBinding.parameter.kind) return false;
  }
  const substitutions = rustGenericSubstitutionsForOpenArguments(cloneParameters, copyParameters);
  if (substitutions === undefined ||
    !isExactRustTrait(
      substituteRustTraitRef(cloneImplementation.trait, substitutions),
      "core::clone::Clone",
    )) return false;
  return cloneImplementation.requirements.every((cloneRequirement) => {
    const substituted = substituteRustBound(cloneRequirement.bound, substitutions);
    return substituted.kind === "trait" && copyImplementation.requirements.some((copyRequirement) =>
      copyRequirement.genericArgumentIndex === cloneRequirement.genericArgumentIndex &&
      traitBoundImplies(copyRequirement.bound, substituted));
  });
}

function traitBoundImplies(
  actual: RustNamedTypeTraitRequirement["bound"],
  required: RustNamedTypeTraitRequirement["bound"],
): boolean {
  if (rustBoundsAlphaEquivalent(actual, required)) return true;
  return isExactRustTrait(actual.trait, "core::marker::Copy") &&
    isExactRustTrait(required.trait, "core::clone::Clone") &&
    rustBoundsAlphaEquivalent({ ...actual, trait: required.trait }, required);
}

export function rustNamedTypeTraitRequirementSemanticKey(
  requirement: RustNamedTypeTraitRequirement,
): string {
  return [
    String(requirement.genericArgumentIndex).padStart(12, "0"),
    rustBoundSemanticKey(requirement.bound),
  ].join("\0");
}

export function rustNamedTypeTraitGenericBindingSemanticKey(
  binding: RustNamedTypeTraitImplementation["genericBindings"][number],
): string {
  return [
    String(binding.genericArgumentIndex).padStart(12, "0"),
    rustGenericArgumentSemanticKey(binding.parameter),
  ].join("\0");
}

export function rustNamedTypeTraitImplementationSemanticKey(
  implementation: RustNamedTypeTraitImplementation,
): string {
  return [
    rustTraitSemanticKey(implementation.trait),
    ...implementation.genericBindings.map(rustNamedTypeTraitGenericBindingSemanticKey),
    ...implementation.requirements.map(rustNamedTypeTraitRequirementSemanticKey),
  ].join("\0");
}

function isExactRustTrait(trait: RustTraitRef, path: string): boolean {
  return trait.arguments.length === 0 && trait.associatedConstraints.length === 0 &&
    rustSemanticIdentityKey(trait.identity) === rustSemanticIdentityKey(rustBuiltinIdentity(path));
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const selected = [...expected].sort();
  return actual.length === selected.length && actual.every((key, index) => key === selected[index]);
}

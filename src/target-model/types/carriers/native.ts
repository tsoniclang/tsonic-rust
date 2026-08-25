import type { SourcePrimitiveKind } from "@tsonic/tsts";
import type { RustSemanticIdentity, RustTraitRef } from "../../semantics/index.js";
import {
  rustBuiltinIdentity,
  rustSemanticIdentityKey,
  rustTraitSemanticKey,
} from "../../semantics/index.js";
import {
  rustBuiltinPathTargetType,
  rustFixedArrayType,
  rustInferredLifetime,
  rustPathTargetType,
  rustPathTypeArguments,
  rustReferenceTargetType,
  rustSequenceTargetType,
} from "../constructors.js";
import { isRustTargetTypeRef, isRustTraitReference } from "../equality.js";
import {
  rustBigIntTargetId,
  rustNullTargetId,
  rustStringTargetId,
  rustUndefinedTargetId,
} from "./source-types.js";
import type {
  RustNamedTypeTraitContract,
  RustNamedTypeTraitImplementation,
  RustNamedTypeTraitRequirement,
  TargetTypeRef,
} from "../model.js";

export function rustSourcePrimitiveTargetType(kind: SourcePrimitiveKind): TargetTypeRef {
  return Object.freeze({ kind: "source-primitive", name: kind });
}

export function rustStringTargetType(): TargetTypeRef {
  return rustBuiltinPathTargetType(rustStringTargetId, "String");
}

export function rustBorrowedStrTargetType(): TargetTypeRef {
  return rustReferenceTargetType(
    { kind: "str" },
    false,
    rustInferredLifetime("policy\0borrowed-str"),
  );
}

export function rustBigIntTargetType(): TargetTypeRef {
  return rustBuiltinPathTargetType(
    rustBigIntTargetId,
    "rt::BigInt",
    [],
    "tsonic-runtime",
  );
}

export function rustUnitTargetType(): TargetTypeRef {
  return Object.freeze({ kind: "unit" });
}

export function rustNeverTargetType(): TargetTypeRef {
  return Object.freeze({ kind: "never" });
}

export function rustUndefinedTargetType(): TargetTypeRef {
  return rustBuiltinPathTargetType(
    rustUndefinedTargetId,
    "rt::Undefined",
    [],
    "tsonic-runtime",
  );
}

export function rustNullTargetType(): TargetTypeRef {
  return rustBuiltinPathTargetType(
    rustNullTargetId,
    "rt::Null",
    [],
    "tsonic-runtime",
  );
}

export function rustVecTargetType(element: TargetTypeRef): TargetTypeRef {
  return rustSequenceTargetType(element);
}

export function rustTupleTargetType(elements: readonly TargetTypeRef[]): TargetTypeRef {
  const [first] = elements;
  if (elements.length >= 2 && first?.kind === "source-primitive" && elements.every((element) =>
    element.kind === "source-primitive" && element.name === first.name)) {
    return rustFixedArrayTargetType(first, elements.length);
  }
  return Object.freeze({ kind: "tuple", elements: Object.freeze([...elements]) });
}

export interface RustFixedArrayCarrierValue {
  readonly element: TargetTypeRef;
  readonly length: number;
}

export interface RustNamedTypeCarrierValue {
  readonly identity: RustSemanticIdentity;
  readonly path: string;
  readonly traits: RustNamedTypeTraitContract;
  readonly typeArguments: readonly TargetTypeRef[];
}

export const rustMoveOnlyNamedTypeTraits: RustNamedTypeTraitContract = Object.freeze({
  implementations: Object.freeze([]),
});

export function rustNamedTargetType(
  id: string,
  path: string,
  typeArguments: readonly TargetTypeRef[] = [],
  traits: RustNamedTypeTraitContract = rustMoveOnlyNamedTypeTraits,
  identity: RustSemanticIdentity = rustBuiltinIdentity(id),
): TargetTypeRef {
  if (!isRustNamedTypeTraitContract(traits) || traits.implementations.some((implementation) =>
    implementation.requirements.some((requirement) =>
      requirement.typeArgumentIndex >= typeArguments.length))) {
    throw new Error(`Rust named target type '${id}' has an invalid native trait contract for ${typeArguments.length} type arguments.`);
  }
  return rustPathTargetType({
    identity,
    displayPath: Object.freeze(path.split("::")),
    arguments: Object.freeze(typeArguments.map((value) => ({ kind: "type" as const, value }))),
    traitImplementations: traits.implementations,
  });
}

export function rustNamedTypeCarrierValue(
  carrier: TargetTypeRef | undefined,
): RustNamedTypeCarrierValue | undefined {
  if (carrier?.kind !== "path") return undefined;
  const typeArguments = rustPathTypeArguments(carrier);
  if (typeArguments === undefined) return undefined;
  return {
    identity: carrier.identity,
    path: carrier.displayPath.join("::"),
    traits: { implementations: carrier.traitImplementations },
    typeArguments,
  };
}

export function isRustNamedTypeTraitContract(value: unknown): value is RustNamedTypeTraitContract {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["implementations"])) return false;
  const implementations = value.implementations;
  if (!Array.isArray(implementations)) return false;
  let previousIdentity: string | undefined;
  for (const implementation of implementations) {
    if (!isPlainRecord(implementation) ||
      !hasExactKeys(implementation, ["requirements", "trait"]) ||
      !isRustTraitReference(implementation.trait) ||
      !Array.isArray(implementation.requirements)) {
      return false;
    }
    let previousRequirementIdentity: string | undefined;
    for (const requirement of implementation.requirements) {
      if (!isPlainRecord(requirement) ||
        !hasExactKeys(requirement, ["trait", "typeArgumentIndex"]) ||
        !Number.isSafeInteger(requirement.typeArgumentIndex) ||
        (requirement.typeArgumentIndex as number) < 0 ||
        !isRustTraitReference(requirement.trait)) {
        return false;
      }
      const requirementIdentity = rustNamedTypeTraitRequirementSemanticKey(
        requirement as unknown as RustNamedTypeTraitRequirement,
      );
      if (previousRequirementIdentity !== undefined &&
        previousRequirementIdentity >= requirementIdentity) {
        return false;
      }
      previousRequirementIdentity = requirementIdentity;
    }
    const implementationIdentity = rustNamedTypeTraitImplementationSemanticKey(
      implementation as unknown as RustNamedTypeTraitImplementation,
    );
    if (previousIdentity !== undefined && previousIdentity >= implementationIdentity) {
      return false;
    }
    previousIdentity = implementationIdentity;
  }
  const typedImplementations = implementations as readonly RustNamedTypeTraitImplementation[];
  return typedImplementations
    .filter((implementation) => isExactRustTrait(implementation.trait, "core::marker::Copy"))
    .every((copyImplementation) => typedImplementations.some((cloneImplementation) =>
      isExactRustTrait(cloneImplementation.trait, "core::clone::Clone") &&
      cloneImplementation.requirements.every((requirement) =>
        copyImplementation.requirements.some((candidate) =>
          candidate.typeArgumentIndex === requirement.typeArgumentIndex &&
          rustTraitImplies(candidate.trait, requirement.trait)))));
}

export function rustNamedTypeTraitRequirementSemanticKey(
  requirement: RustNamedTypeTraitRequirement,
): string {
  return [
    String(requirement.typeArgumentIndex).padStart(12, "0"),
    rustTraitSemanticKey(requirement.trait),
  ].join("\0");
}

export function rustNamedTypeTraitImplementationSemanticKey(
  implementation: RustNamedTypeTraitImplementation,
): string {
  return [
    rustTraitSemanticKey(implementation.trait),
    ...implementation.requirements.map(rustNamedTypeTraitRequirementSemanticKey),
  ].join("\0");
}

export function rustTraitReference(
  path: string,
  identity: RustSemanticIdentity = rustBuiltinIdentity(path),
): RustTraitRef {
  return Object.freeze({
    identity,
    displayPath: Object.freeze(path.split("::")),
    arguments: Object.freeze([]),
    associatedConstraints: Object.freeze([]),
  });
}

function rustTraitImplies(actual: RustTraitRef, required: RustTraitRef): boolean {
  return rustSemanticIdentityKey(actual.identity) === rustSemanticIdentityKey(required.identity) ||
    isExactRustTrait(actual, "core::marker::Copy") &&
      isExactRustTrait(required, "core::clone::Clone");
}

function isExactRustTrait(trait: RustTraitRef, path: string): boolean {
  return rustSemanticIdentityKey(trait.identity) ===
    rustSemanticIdentityKey(rustBuiltinIdentity(path));
}

export function rustFixedArrayTargetType(
  element: TargetTypeRef,
  length: number,
): TargetTypeRef {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error(`Rust fixed-array length must be a non-negative safe integer; received ${String(length)}.`);
  }
  return rustFixedArrayType(element, { kind: "literal", literalKind: "integer", value: BigInt(length) });
}

export function rustFixedArrayCarrierValue(
  carrier: TargetTypeRef | undefined,
): RustFixedArrayCarrierValue | undefined {
  if (carrier?.kind !== "array" || carrier.length.kind !== "literal" ||
    carrier.length.literalKind !== "integer" ||
    typeof carrier.length.value !== "bigint" || carrier.length.value < 0n ||
    carrier.length.value > BigInt(Number.MAX_SAFE_INTEGER) ||
    !isRustTargetTypeRef(carrier.element)) {
    return undefined;
  }
  return { element: carrier.element, length: Number(carrier.length.value) };
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

export type {
  RustNamedTypeTraitImplementation,
  RustNamedTypeTraitRequirement,
};

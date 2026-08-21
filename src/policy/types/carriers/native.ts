import { hasExactObjectKeys } from "./primitives.js";
import { isDenseDataArray } from "../../model/closed-data.js";
import { isRustTargetTypeRef } from "../equality.js";
import { rustBigIntTargetId, rustNamedTypeCarrierName, rustNeverCarrierName, rustNullTargetId, rustStringTargetId, rustUndefinedTargetId } from "./source-types.js";
import type { SourcePrimitiveKind } from "@tsonic/tsts";
import type {
  RustNamedTypeTraitContract,
  RustNamedTypeTraitImplementation,
  RustNamedTypeTraitRequirement,
  TargetTypeRef,
} from "../../../target-model/types/model.js";

export function rustSourcePrimitiveTargetType(kind: SourcePrimitiveKind): TargetTypeRef {
  return { kind: "source-primitive", name: kind };
}

export function rustStringTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustStringTargetId };
}

export function rustBorrowedStrTargetType(): TargetTypeRef {
  return {
    kind: "reference",
    referent: rustStringTargetType(),
    mutable: false,
  };
}

export function rustBigIntTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustBigIntTargetId };
}

export function rustUnitTargetType(): TargetTypeRef {
  return { kind: "tuple", elements: [] };
}

export function rustNeverTargetType(): TargetTypeRef {
  return { kind: "target-specific", target: "rust", name: rustNeverCarrierName };
}

export function rustUndefinedTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustUndefinedTargetId };
}

export function rustNullTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustNullTargetId };
}

export function rustVecTargetType(element: TargetTypeRef): TargetTypeRef {
  return { kind: "array", element };
}

export function rustTupleTargetType(elements: readonly TargetTypeRef[]): TargetTypeRef {
  const [first] = elements;
  if (elements.length >= 2 && first?.kind === "source-primitive" && elements.every((element) =>
    element.kind === "source-primitive" && element.name === first.name)) {
    return rustFixedArrayTargetType(first, elements.length);
  }
  return { kind: "tuple", elements };
}

export interface RustFixedArrayCarrierValue {
  readonly element: TargetTypeRef;
  readonly length: number;
}

export interface RustNamedTypeCarrierValue {
  readonly id: string;
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
): TargetTypeRef {
  return {
    kind: "target-specific",
    target: "rust",
    name: rustNamedTypeCarrierName,
    value: { id, path, traits, typeArguments },
  };
}

export function rustNamedTypeCarrierValue(carrier: TargetTypeRef | undefined): RustNamedTypeCarrierValue | undefined {
  if (carrier?.kind !== "target-specific" || carrier.target !== "rust" || carrier.name !== rustNamedTypeCarrierName) {
    return undefined;
  }
  const value = carrier.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 4 || keys[0] !== "id" || keys[1] !== "path" || keys[2] !== "traits" ||
    keys[3] !== "typeArguments") {
    return undefined;
  }
  const candidate = value as {
    readonly id?: unknown;
    readonly path?: unknown;
    readonly traits?: unknown;
    readonly typeArguments?: unknown;
  };
  if (typeof candidate.id !== "string" || candidate.id.length === 0 ||
    typeof candidate.path !== "string" || candidate.path.length === 0 ||
    !isRustNamedTypeTraitContract(candidate.traits) ||
    !isDenseDataArray(candidate.typeArguments) ||
    candidate.typeArguments.some((argument) => !isRustTargetTypeRef(argument))) {
    return undefined;
  }
  const typeArguments = candidate.typeArguments as readonly TargetTypeRef[];
  if (candidate.traits.implementations.some((implementation) =>
    implementation.requirements.some((requirement) => requirement.typeArgumentIndex >= typeArguments.length))) {
    return undefined;
  }
  return {
    id: candidate.id,
    path: candidate.path,
    traits: candidate.traits,
    typeArguments,
  };
}

export function isRustNamedTypeTraitContract(value: unknown): value is RustNamedTypeTraitContract {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 1 || keys[0] !== "implementations") {
    return false;
  }
  const candidate = value as { readonly implementations?: unknown };
  if (!isDenseDataArray(candidate.implementations)) {
    return false;
  }
  let previousIdentity: string | undefined;
  for (const implementation of candidate.implementations) {
    if (typeof implementation !== "object" || implementation === null || Array.isArray(implementation) ||
      !hasExactObjectKeys(implementation, ["requirements", "traitPath"])) {
      return false;
    }
    const selected = implementation as Partial<RustNamedTypeTraitImplementation>;
    if (!isRustTraitPath(selected.traitPath) || !isDenseDataArray(selected.requirements)) {
      return false;
    }
    let previousRequirementIdentity: string | undefined;
    for (const requirement of selected.requirements) {
      if (typeof requirement !== "object" || requirement === null || Array.isArray(requirement) ||
        !hasExactObjectKeys(requirement, ["traitPath", "typeArgumentIndex"])) {
        return false;
      }
      const condition = requirement as Partial<RustNamedTypeTraitRequirement>;
      if (!Number.isSafeInteger(condition.typeArgumentIndex) || condition.typeArgumentIndex! < 0 ||
        !isRustTraitPath(condition.traitPath)) {
        return false;
      }
      const identity = `${String(condition.typeArgumentIndex).padStart(12, "0")}\0${condition.traitPath}`;
      if (previousRequirementIdentity !== undefined && previousRequirementIdentity >= identity) {
        return false;
      }
      previousRequirementIdentity = identity;
    }
    const identity = `${selected.traitPath}\0${JSON.stringify(selected.requirements)}`;
    if (previousIdentity !== undefined && previousIdentity >= identity) {
      return false;
    }
    previousIdentity = identity;
  }
  const implementations = candidate.implementations as readonly RustNamedTypeTraitImplementation[];
  return implementations
    .filter((implementation) => implementation.traitPath === "core::marker::Copy")
    .every((copy) => implementations.some((clone) =>
      clone.traitPath === "core::clone::Clone" && clone.requirements.every((requirement) =>
        copy.requirements.some((candidate) =>
          candidate.typeArgumentIndex === requirement.typeArgumentIndex &&
          rustTraitPathImplies(candidate.traitPath, requirement.traitPath)))));
}

function rustTraitPathImplies(actual: string, required: string): boolean {
  return actual === required ||
    actual === "core::marker::Copy" && required === "core::clone::Clone";
}

function isRustTraitPath(value: unknown): value is string {
  return typeof value === "string" &&
    /^[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)+$/u.test(value);
}

export function rustFixedArrayTargetType(element: TargetTypeRef, length: number): TargetTypeRef {
  return {
    kind: "target-specific",
    target: "rust",
    name: "fixed-array",
    value: { element, length },
  };
}

export function rustFixedArrayCarrierValue(carrier: TargetTypeRef | undefined): RustFixedArrayCarrierValue | undefined {
  if (carrier?.kind !== "target-specific" || carrier.target !== "rust" || carrier.name !== "fixed-array") {
    return undefined;
  }
  const value = carrier.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "element" || keys[1] !== "length") {
    return undefined;
  }
  const length = (value as { readonly length?: unknown }).length;
  const element = (value as { readonly element?: unknown }).element;
  return Number.isSafeInteger(length) && (length as number) >= 0 && isRustTargetTypeRef(element)
    ? { element: element as TargetTypeRef, length: length as number }
    : undefined;
}

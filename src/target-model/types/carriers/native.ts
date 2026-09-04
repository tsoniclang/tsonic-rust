import {
  hasExactObjectKeys,
  isDenseDataArray,
} from "../../metadata/closed-data.js";
import { isRustTargetTypeRef } from "../equality.js";
import { rustBigIntTargetId, rustNamedTypeCarrierName, rustNeverCarrierName, rustNullTargetId, rustStringTargetId, rustStrTargetId, rustTsValueTargetId, rustUndefinedTargetId } from "./source-types.js";
import type { SourcePrimitiveKind } from "@tsonic/tsts";
import type {
  RustNamedTypeTraitContract,
  RustNamedTypeTraitImplementation,
  RustNamedTypeTraitRequirement,
  RustTargetConstArgument,
  RustTargetGenericArgument,
  TargetTypeRef,
} from "../model.js";
import { rustTargetGenericTypeArguments } from "../generic-arguments.js";
import { isRustLifetimeRef } from "../../lifetimes/index.js";

export function rustSourcePrimitiveTargetType(kind: SourcePrimitiveKind): TargetTypeRef {
  return { kind: "source-primitive", name: kind };
}

export function rustStringTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustStringTargetId };
}

export function rustStrTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustStrTargetId };
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

export function rustTsValueTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustTsValueTargetId };
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
  readonly length: RustTargetConstArgument;
}

export interface RustNamedTypeCarrierValue {
  readonly id: string;
  readonly path: string;
  readonly traits: RustNamedTypeTraitContract;
  readonly genericArguments: readonly RustTargetGenericArgument[];
  readonly genericDefaults: readonly RustTargetGenericArgument[];
}

export const rustMoveOnlyNamedTypeTraits: RustNamedTypeTraitContract = Object.freeze({
  implementations: Object.freeze([]),
});

export function rustNamedTargetType(
  id: string,
  path: string,
  genericArguments: readonly RustTargetGenericArgument[] = [],
  genericDefaults: readonly RustTargetGenericArgument[] = [],
  traits: RustNamedTypeTraitContract = rustMoveOnlyNamedTypeTraits,
): TargetTypeRef {
  return {
    kind: "target-specific",
    target: "rust",
    name: rustNamedTypeCarrierName,
    value: { id, path, traits, genericArguments, genericDefaults },
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
  if (keys.length !== 5 || keys[0] !== "genericArguments" || keys[1] !== "genericDefaults" ||
    keys[2] !== "id" || keys[3] !== "path" || keys[4] !== "traits") {
    return undefined;
  }
  const candidate = value as {
    readonly id?: unknown;
    readonly path?: unknown;
    readonly traits?: unknown;
    readonly genericArguments?: unknown;
    readonly genericDefaults?: unknown;
  };
  if (typeof candidate.id !== "string" || candidate.id.length === 0 ||
    typeof candidate.path !== "string" || candidate.path.length === 0 ||
    !isRustNamedTypeTraitContract(candidate.traits) ||
    !isDenseDataArray(candidate.genericArguments) ||
    candidate.genericArguments.some((argument) => !isRustNamedGenericArgument(argument)) ||
    !isDenseDataArray(candidate.genericDefaults) ||
    candidate.genericDefaults.some((argument) => !isRustNamedGenericArgument(argument))) {
    return undefined;
  }
  const genericArguments = candidate.genericArguments as readonly RustTargetGenericArgument[];
  const genericDefaults = candidate.genericDefaults as readonly RustTargetGenericArgument[];
  const defaultOffset = genericArguments.length - genericDefaults.length;
  if (defaultOffset < 0 || genericDefaults.some((argument, index) =>
    argument.kind !== genericArguments[defaultOffset + index]?.kind)) {
    return undefined;
  }
  const typeArguments = rustTargetGenericTypeArguments(genericArguments);
  if (candidate.traits.implementations.some((implementation) =>
    implementation.requirements.some((requirement) => requirement.typeArgumentIndex >= typeArguments.length))) {
    return undefined;
  }
  return {
    id: candidate.id,
    path: candidate.path,
    traits: candidate.traits,
    genericArguments,
    genericDefaults,
  };
}

function isRustNamedGenericArgument(value: unknown): value is RustTargetGenericArgument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<RustTargetGenericArgument>;
  const keys = Object.keys(value).sort();
  if (candidate.kind === "lifetime") {
    return keys.length === 2 && keys[0] === "kind" && keys[1] === "lifetime" &&
      isRustLifetimeRef(candidate.lifetime);
  }
  if (candidate.kind === "type") {
    return keys.length === 2 && keys[0] === "kind" && keys[1] === "type" &&
      isRustTargetTypeRef(candidate.type);
  }
  if (candidate.kind !== "const" || keys.length !== 2 || keys[0] !== "kind" ||
    keys[1] !== "value" || typeof candidate.value !== "object" ||
    candidate.value === null || Array.isArray(candidate.value)) {
    return false;
  }
  const constant = candidate.value as Record<string, unknown>;
  const constantKeys = Object.keys(constant).sort();
  if (constant.kind === "infer") return constantKeys.length === 1;
  if (constant.kind === "boolean") {
    return constantKeys.length === 2 && typeof constant.value === "boolean";
  }
  if (constant.kind === "integer") {
    return constantKeys.length === 2 && typeof constant.value === "string" &&
      /^-?(?:0|[1-9][0-9]*)$/u.test(constant.value);
  }
  if (constant.kind === "char") {
    return constantKeys.length === 2 && typeof constant.value === "string" &&
      [...constant.value].length === 1;
  }
  return constant.kind === "parameter" && constantKeys.length === 3 &&
    typeof constant.identity === "string" && constant.identity.length > 0 &&
    typeof constant.name === "string" && constant.name.length > 0;
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

export function rustFixedArrayTargetType(
  element: TargetTypeRef,
  length: number | RustTargetConstArgument,
): TargetTypeRef {
  return {
    kind: "target-specific",
    target: "rust",
    name: "fixed-array",
    value: {
      element,
      length: typeof length === "number"
        ? { kind: "integer", value: String(length) }
        : length,
    },
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
  return isRustTargetConstArgument(length) &&
      !(length.kind === "integer" && BigInt(length.value) < 0n) &&
      isRustTargetTypeRef(element)
    ? { element: element as TargetTypeRef, length }
    : undefined;
}

function isRustTargetConstArgument(value: unknown): value is RustTargetConstArgument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<RustTargetConstArgument>;
  const keys = Object.keys(value).sort();
  if (candidate.kind === "infer") return keys.length === 1 && keys[0] === "kind";
  if (candidate.kind === "boolean") {
    return keys.length === 2 && keys[0] === "kind" && keys[1] === "value" &&
      typeof candidate.value === "boolean";
  }
  if (candidate.kind === "integer") {
    return keys.length === 2 && keys[0] === "kind" && keys[1] === "value" &&
      typeof candidate.value === "string" && /^-?(?:0|[1-9][0-9]*)$/u.test(candidate.value);
  }
  if (candidate.kind === "char") {
    return keys.length === 2 && keys[0] === "kind" && keys[1] === "value" &&
      typeof candidate.value === "string" && [...candidate.value].length === 1;
  }
  return candidate.kind === "parameter" && keys.length === 3 &&
    keys[0] === "identity" && keys[1] === "kind" && keys[2] === "name" &&
    typeof candidate.identity === "string" && candidate.identity.length > 0 &&
    typeof candidate.name === "string" && candidate.name.length > 0;
}

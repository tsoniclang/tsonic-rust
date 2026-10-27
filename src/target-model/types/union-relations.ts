import type { TargetTypeRef } from "./model.js";
import type { RustTypeDefinitions } from "./source-union-definitions.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "./equality.js";
import { rustRuntimeUnionContract, type RustRuntimeUnionVariant } from "./carriers/runtime-unions.js";
import { hasExactObjectKeys, isClosedMetadata, isDenseDataArray } from "../metadata/closed-data.js";

import { rustSourceUnionCarrierValue } from "./carriers/source-types.js";
import { rustNativeErrorJoinReference } from "./native-error-joins.js";

export interface RustUnionPathStep {
  readonly union: TargetTypeRef;
  readonly variant: RustRuntimeUnionVariant;
}

export interface RustUnionLeaf {
  readonly carrier: TargetTypeRef;
  readonly path: readonly RustUnionPathStep[];
}

export interface RustUnionArmMapping {
  readonly carrier: TargetTypeRef;
  readonly source: readonly RustUnionPathStep[];
  readonly target: readonly RustUnionPathStep[];
}

export function isRustUnionArmMappings(value: unknown): value is readonly RustUnionArmMapping[] {
  if (!isClosedMetadata(value) || !isDenseDataArray(value) || value.length === 0) return false;
  return value.every(arm => arm !== null && typeof arm === "object" &&
    hasExactObjectKeys(arm, ["carrier", "source", "target"]) &&
    isRustTargetTypeRef((arm as RustUnionArmMapping).carrier) &&
    isRustUnionPath((arm as RustUnionArmMapping).source) && isRustUnionPath((arm as RustUnionArmMapping).target));
}

export function isRustUnionPath(value: unknown): value is readonly RustUnionPathStep[] {
  return isDenseDataArray(value) && value.length > 0 && value.every(step =>
    step !== null && typeof step === "object" && hasExactObjectKeys(step, ["union", "variant"]) &&
    isRustTargetTypeRef((step as RustUnionPathStep).union) && isVariant((step as RustUnionPathStep).variant));
}

function isVariant(value: unknown): value is RustRuntimeUnionVariant {
  if (value === null || typeof value !== "object") return false;
  const variant = value as RustRuntimeUnionVariant;
  return typeof variant.name === "string" && variant.name.length > 0 && (
    variant.kind === "payload" && hasExactObjectKeys(value, ["kind", "name"]) ||
    variant.kind === "constant" && hasExactObjectKeys(value, ["kind", "name", "value"]) && typeof variant.value === "boolean");
}

export function rustUnionAlternatives(carrier: TargetTypeRef, definitions: RustTypeDefinitions) {
  const errors = rustNativeErrorJoinReference(carrier);
  if (errors !== undefined) return errors.errors.map((error, index) => ({
    carrier: error, variant: { kind: "payload" as const, name: `Error${index}` },
  }));
  return definitions.sourceUnionVariants(carrier)?.map(variant => ({
    carrier: variant.carrier, variant: { kind: "payload" as const, name: variant.name },
  })) ?? rustRuntimeUnionContract(carrier)?.alternatives;
}

export function rustUnionLeaves(carrier: TargetTypeRef, definitions: RustTypeDefinitions):
  readonly RustUnionLeaf[] | undefined {
  return collectRustUnionPaths(carrier, definitions);
}

export function rustUnionPathsMatching(
  carrier: TargetTypeRef,
  definitions: RustTypeDefinitions,
  matches: (carrier: TargetTypeRef) => boolean,
): readonly RustUnionLeaf[] | undefined {
  return collectRustUnionPaths(carrier, definitions, matches);
}

export function collectRustUnionPaths(carrier: TargetTypeRef, definitions: RustTypeDefinitions, matches?: (carrier: TargetTypeRef) => boolean):
  readonly RustUnionLeaf[] | undefined {
  const leaves: RustUnionLeaf[] = [];
  let rows = 0;
  const visit = (current: TargetTypeRef, path: readonly RustUnionPathStep[]): boolean => {
    if (++rows > 4096 || path.length > 128) return false;
    if (path.some(step => rustTargetTypeRefEquals(step.union, current))) return false;
    if (path.length > 0 && matches?.(current) === true) {
      leaves.push(Object.freeze({ carrier: current, path }));
      return true;
    }
    const alternatives = rustUnionAlternatives(current, definitions);
    if (alternatives === undefined) {
      if (path.length === 0 || rustSourceUnionCarrierValue(current) !== undefined) return false;
      if (matches === undefined) leaves.push(Object.freeze({ carrier: current, path }));
      return true;
    }
    return alternatives.length > 0 && alternatives.every(arm =>
      visit(arm.carrier, Object.freeze([...path, Object.freeze({ union: current, variant: arm.variant })])));
  };
  return visit(carrier, []) ? Object.freeze(leaves) : undefined;
}

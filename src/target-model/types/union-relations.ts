import type { TargetTypeRef } from "./model.js";
import type { RustTypeDefinitions } from "./source-union-definitions.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "./equality.js";
import { rustRuntimeUnionContract, type RustRuntimeUnionVariant } from "./carriers/runtime-unions.js";
import { hasExactObjectKeys, isClosedMetadata, isDenseDataArray } from "../metadata/closed-data.js";
import { rustOptionElementCarrier } from "./carriers/optional.js";

export interface RustUnionPathStep {
  readonly union: TargetTypeRef;
  readonly variant: RustRuntimeUnionVariant;
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
    isPath((arm as RustUnionArmMapping).source) && isPath((arm as RustUnionArmMapping).target));
}

function isPath(value: unknown): value is readonly RustUnionPathStep[] {
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
  return definitions.sourceUnionVariants(carrier)?.map(variant => ({
    carrier: variant.carrier, variant: { kind: "payload" as const, name: variant.name },
  })) ?? rustRuntimeUnionContract(carrier)?.alternatives;
}

export function rustUnionLeaves(carrier: TargetTypeRef, definitions: RustTypeDefinitions):
  readonly { readonly carrier: TargetTypeRef; readonly path: readonly RustUnionPathStep[] }[] | undefined {
  const leaves: { readonly carrier: TargetTypeRef; readonly path: readonly RustUnionPathStep[] }[] = [];
  const visit = (current: TargetTypeRef, path: readonly RustUnionPathStep[]): boolean => {
    if (path.some(step => rustTargetTypeRefEquals(step.union, current))) return false;
    const alternatives = rustUnionAlternatives(current, definitions);
    if (alternatives === undefined) {
      if (path.length === 0) return false;
      leaves.push(Object.freeze({ carrier: current, path }));
      return true;
    }
    return alternatives.length > 0 && alternatives.every(arm =>
      visit(arm.carrier, Object.freeze([...path, Object.freeze({ union: current, variant: arm.variant })])));
  };
  return visit(carrier, []) ? Object.freeze(leaves) : undefined;
}

export function selectRustUnionProjection(source: TargetTypeRef, target: TargetTypeRef, definitions: RustTypeDefinitions) {
  const sourceElement = rustOptionElementCarrier(source);
  const targetElement = rustOptionElementCarrier(target);
  if (targetElement !== undefined && sourceElement === undefined) return undefined;
  const dispatchCarrier = sourceElement ?? source;
  const carrier = targetElement ?? target;
  const alternatives = rustUnionAlternatives(dispatchCarrier, definitions)?.filter(arm =>
    rustTargetTypeRefEquals(arm.carrier, carrier));
  return alternatives?.length !== 1 ? undefined : {
    dispatchCarrier, carrier, variant: alternatives[0]!.variant,
    sourceOptional: sourceElement !== undefined, targetOptional: targetElement !== undefined,
  };
}

export function selectRustUnionArmMapping(
  source: TargetTypeRef,
  target: TargetTypeRef,
  coverage: "source" | "target",
  definitions: RustTypeDefinitions,
): readonly RustUnionArmMapping[] | undefined {
  if (coverage !== "source" && coverage !== "target") return undefined;
  const sourceArms = rustUnionLeaves(source, definitions);
  const targetArms = rustUnionLeaves(target, definitions);
  if (sourceArms === undefined || targetArms === undefined) return undefined;
  const mappings: RustUnionArmMapping[] = [];
  const selectedTargets = new Set<readonly RustUnionPathStep[]>();
  for (const arm of sourceArms) {
    const matches = targetArms.filter(candidate => rustTargetTypeRefEquals(arm.carrier, candidate.carrier));
    if (matches.length > 1 || coverage === "source" && matches.length !== 1) return undefined;
    const selected = matches[0];
    if (selected === undefined) continue;
    const sourceVariant = arm.path[arm.path.length - 1]!.variant;
    const targetVariant = selected.path[selected.path.length - 1]!.variant;
    if (selectedTargets.has(selected.path) || targetVariant.kind === "constant" &&
      (sourceVariant.kind !== "constant" || sourceVariant.value !== targetVariant.value)) return undefined;
    selectedTargets.add(selected.path);
    mappings.push(Object.freeze({ carrier: arm.carrier, source: arm.path, target: selected.path }));
  }
  return mappings.length === 0 || coverage === "target" && selectedTargets.size !== targetArms.length
    ? undefined : Object.freeze(mappings);
}

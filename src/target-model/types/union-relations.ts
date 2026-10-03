import type { TargetTypeRef } from "./model.js";
import type { RustTypeDefinitions } from "./source-union-definitions.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "./equality.js";
import { rustRuntimeUnionContract, type RustRuntimeUnionVariant } from "./carriers/runtime-unions.js";
import { closedMetadataEquals, hasExactObjectKeys, isClosedMetadata, isDenseDataArray } from "../metadata/closed-data.js";
import { rustOptionElementCarrier } from "./carriers/optional.js";
import { rustClosedValuePayloadProjection } from "./carriers/closed-values.js";

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
  return definitions.sourceUnionVariants(carrier)?.map(variant => ({
    carrier: variant.carrier, variant: { kind: "payload" as const, name: variant.name },
  })) ?? rustRuntimeUnionContract(carrier)?.alternatives;
}

export function rustUnionInjectionVariant(source: TargetTypeRef, target: TargetTypeRef, definitions: RustTypeDefinitions):
  Extract<RustRuntimeUnionVariant, { readonly kind: "payload" }> | undefined {
  const variant = rustUnionInjectionPath(source, target, definitions)?.[0]?.variant;
  return variant?.kind === "payload" ? variant : undefined;
}

export function rustUnionInjectionPath(source: TargetTypeRef, target: TargetTypeRef, definitions: RustTypeDefinitions):
  readonly RustUnionPathStep[] | undefined {
  const paths = collectRustUnionPaths(target, definitions, current => rustTargetTypeRefEquals(current, source));
  return paths?.length === 1 && paths[0]!.path.every(step => step.variant.kind === "payload") ? paths[0]!.path : undefined;
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

function collectRustUnionPaths(carrier: TargetTypeRef, definitions: RustTypeDefinitions, matches?: (carrier: TargetTypeRef) => boolean):
  readonly RustUnionLeaf[] | undefined {
  const leaves: RustUnionLeaf[] = [];
  const visit = (current: TargetTypeRef, path: readonly RustUnionPathStep[]): boolean => {
    if (path.some(step => rustTargetTypeRefEquals(step.union, current))) return false;
    if (path.length > 0 && matches?.(current) === true) {
      leaves.push(Object.freeze({ carrier: current, path }));
      return true;
    }
    const alternatives = rustUnionAlternatives(current, definitions);
    if (alternatives === undefined) {
      if (path.length === 0) return false;
      if (matches === undefined) leaves.push(Object.freeze({ carrier: current, path }));
      return true;
    }
    return alternatives.length > 0 && alternatives.every(arm =>
      visit(arm.carrier, Object.freeze([...path, Object.freeze({ union: current, variant: arm.variant })])));
  };
  return visit(carrier, []) ? Object.freeze(leaves) : undefined;
}

export function rustUnionProjectionContract(source: TargetTypeRef, target: TargetTypeRef, definitions: RustTypeDefinitions) {
  const sourceElement = rustOptionElementCarrier(source);
  const targetElement = rustOptionElementCarrier(target);
  if (targetElement !== undefined && sourceElement === undefined) return undefined;
  const dispatchCarrier = sourceElement ?? source;
  const carrier = targetElement ?? target;
  const allAlternatives = rustUnionAlternatives(dispatchCarrier, definitions);
  const paths = collectRustUnionPaths(dispatchCarrier, definitions, current => rustTargetTypeRefEquals(current, carrier));
  const variant = allAlternatives === undefined ? rustClosedValuePayloadProjection(dispatchCarrier, carrier) : undefined;
  const path = variant === undefined ? paths?.length === 1 ? paths[0]!.path : undefined
    : Object.freeze([Object.freeze({ union: dispatchCarrier, variant })]);
  return path === undefined ? undefined : {
    dispatchCarrier, carrier, path, variant: path[path.length - 1]!.variant,
    sourceOptional: sourceElement !== undefined, targetOptional: targetElement !== undefined,
    exhaustive: path.every(step => rustUnionAlternatives(step.union, definitions)?.length === 1) &&
      (sourceElement === undefined || targetElement !== undefined),
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

export function rustUnionArmMappingsMatch(
  source: TargetTypeRef,
  target: TargetTypeRef,
  coverage: "source" | "target",
  definitions: RustTypeDefinitions,
  mappings: readonly RustUnionArmMapping[],
): boolean {
  const contract = selectRustUnionArmMapping(source, target, coverage, definitions);
  return contract !== undefined && closedMetadataEquals(contract, mappings);
}

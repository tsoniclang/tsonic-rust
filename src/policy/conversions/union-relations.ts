import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { type RustRuntimeUnionVariant } from "../../target-model/types/carriers/runtime-unions.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustClosedValuePayloadProjection } from "./closed-values.js";

import { collectRustUnionPaths, rustUnionAlternatives, rustUnionLeaves, type RustUnionPathStep, type RustUnionArmMapping } from "../../target-model/types/union-relations.js";
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
  relates?: (source: TargetTypeRef, target: TargetTypeRef) => boolean,
): readonly RustUnionArmMapping[] | undefined {
  if (coverage !== "source" && coverage !== "target") return undefined;
  const sourceArms = rustUnionLeaves(source, definitions);
  const targetArms = rustUnionLeaves(target, definitions);
  if (sourceArms === undefined || targetArms === undefined) return undefined;
  const mappings: RustUnionArmMapping[] = [];
  const selectedTargets = new Map<readonly RustUnionPathStep[], TargetTypeRef[]>();
  for (const arm of sourceArms) {
    let matches = targetArms.filter(candidate => rustTargetTypeRefEquals(arm.carrier, candidate.carrier));
    if (matches.length === 0 && relates !== undefined) {
      matches = targetArms.filter(candidate => relates(arm.carrier, candidate.carrier));
    }
    if (matches.length > 1 || coverage === "source" && matches.length !== 1) return undefined;
    const selected = matches[0];
    if (selected === undefined) continue;
    const sourceVariant = arm.path[arm.path.length - 1]!.variant;
    const targetVariant = selected.path[selected.path.length - 1]!.variant;
    const previousSource = selectedTargets.get(selected.path);
    if (previousSource !== undefined && (coverage === "target" || previousSource.some(carrier => rustTargetTypeRefEquals(carrier, arm.carrier))) ||
      targetVariant.kind === "constant" &&
      (sourceVariant.kind !== "constant" || sourceVariant.value !== targetVariant.value)) return undefined;
    if (previousSource === undefined) selectedTargets.set(selected.path, [arm.carrier]);
    else previousSource.push(arm.carrier);
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
  relates?: (source: TargetTypeRef, target: TargetTypeRef) => boolean,
): boolean {
  const contract = selectRustUnionArmMapping(source, target, coverage, definitions, relates);
  return contract !== undefined && closedMetadataEquals(contract, mappings);
}

export function composeRustUnionArmMappings(
  source: TargetTypeRef,
  intermediate: TargetTypeRef,
  target: TargetTypeRef,
  upstream: readonly RustUnionArmMapping[],
  downstream: readonly RustUnionArmMapping[],
  definitions: RustTypeDefinitions,
  relates?: (source: TargetTypeRef, target: TargetTypeRef) => boolean,
): readonly RustUnionArmMapping[] | undefined {
  const before = selectRustUnionArmMapping(source, intermediate, "target", definitions);
  const after = selectRustUnionArmMapping(intermediate, target, "source", definitions, relates);
  if (before === undefined || after === undefined || !closedMetadataEquals(before, upstream) ||
    !closedMetadataEquals(after, downstream)) return undefined;
  const result: RustUnionArmMapping[] = [];
  for (const mapping of after) {
    const matches = before.filter(candidate => closedMetadataEquals(candidate.target, mapping.source));
    const selected = matches.length === 1 ? matches[0] : undefined;
    if (selected === undefined || !rustTargetTypeRefEquals(selected.carrier, mapping.carrier)) return undefined;
    result.push(Object.freeze({ carrier: selected.carrier, source: selected.source, target: mapping.target }));
  }
  return result.length === before.length ? Object.freeze(result) : undefined;
}

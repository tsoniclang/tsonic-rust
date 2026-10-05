import type { Node, Type } from "@tsonic/tsts";
import type { RustOperationPolicyContext } from "../../policy/operations/contracts.js";
import type { RustSourcePolicyContext } from "../../policy/model/context.js";
import type { RustTargetTypeResolutionOptions } from "../../policy/types/resolution.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { resolveRustNativeFlowCarrier, selectRustNativeFlowMembers, selectRustNativeFlowTypeMembers } from "../../policy/types/resolution/native-flow-refinement.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustUnionLeaves } from "../../target-model/types/union-relations.js";
import { selectRustSourceTypeGuard } from "../../policy/operations/source-profiles/js/type-tests.js";
import { selectRustFlowReadProjection } from "../../policy/types/value-carrier-reconciliation.js";
import { recordRustFlowReadProjection } from "../facts/value-carrier-queries.js";
import { rustFlowReadProjectionFactKey } from "../facts/keys.js";
import { rustFlowReadProjectionMatches } from "../facts/flow-read-projections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { resolveRustInstanceType } from "../../policy/types/resolution/instance-tests.js";

export function selectRustGuardedValueCarrier(
  reference: Node,
  sourceCarrier: TargetTypeRef,
  context: RustOperationPolicyContext,
  options: RustTargetTypeResolutionOptions & { readonly projectTypes: RustProjectTypePolicy },
): TargetTypeRef | undefined {
  const existing = context.facts.getFact(reference, rustFlowReadProjectionFactKey);
  if (existing !== undefined) return rustTargetTypeRefEquals(existing.sourceCarrier, sourceCarrier) &&
    rustFlowReadProjectionMatches(existing, options.projectTypes, context.typeDefinitions) ? existing.selectedCarrier : undefined;
  const members = selectRustGuardedValueMembers(reference, sourceCarrier, context, options);
  const sourceType = context.currentSemantics.types.expressionType(reference);
  const leaves = rustUnionLeaves(sourceCarrier, context.typeDefinitions);
  const selected = members === undefined ? undefined : members.length === 1 ? members[0]?.carrier
    : sourceType === undefined || leaves === undefined || members.length >= leaves.length ? undefined
    : resolveRustNativeFlowCarrier(sourceType, members, context, options);
  if (selected === undefined) return undefined;
  const projection = selectRustFlowReadProjection(sourceCarrier, selected, options.projectTypes, context.typeDefinitions);
  if (projection.kind !== "projection") return undefined;
  recordRustFlowReadProjection(context.facts, reference, projection.fact);
  return selected;
}

export function selectRustGuardedValueMembers(
  reference: Node,
  sourceCarrier: TargetTypeRef,
  context: RustSourcePolicyContext,
  options: RustTargetTypeResolutionOptions & { readonly projectTypes: RustProjectTypePolicy },
): ReturnType<typeof rustUnionLeaves> {
  return selectRustNativeFlowMembers({ ...context, navigation: context.source.navigation,
    sourceFacts: context.source.sourceFacts }, reference, sourceCarrier, options.projectTypes, context.typeDefinitions,
    expression => selectRustSourceTypeGuard(context, expression, options.sourceProfiles),
    guard => resolveRustInstanceType(guard.declaration, guard.sourceConstructor, context, options));
}

export function selectRustGuardedSourceValueTypes(
  reference: Node,
  sourceType: Type,
  context: RustOperationPolicyContext,
  options: RustTargetTypeResolutionOptions & { readonly projectTypes: RustProjectTypePolicy },
): readonly Type[] | undefined {
  return selectRustNativeFlowTypeMembers({ ...context, navigation: context.source.navigation,
    sourceFacts: context.source.sourceFacts }, reference, sourceType,
    type => resolveRustTargetTypeRef(type, context, options), options.projectTypes, context.typeDefinitions,
    expression => selectRustSourceTypeGuard(context, expression, options.sourceProfiles),
    guard => resolveRustInstanceType(guard.declaration, guard.sourceConstructor, context, options));
}

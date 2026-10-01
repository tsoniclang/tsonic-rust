import type { Node } from "@tsonic/tsts";
import type { RustOperationPolicyContext } from "../../policy/operations/contracts.js";
import type { RustTargetTypeResolutionOptions } from "../../policy/types/resolution.js";
import type { RustProjectTypePolicy } from "../../policy/types/project-types.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { selectRustNativeFlowMembers } from "../../policy/types/resolution/native-flow-refinement.js";
import { rustUnionLeaves } from "../../target-model/types/union-relations.js";
import { selectRustArrayTypeGuard } from "../../policy/operations/source-profiles/js/type-tests.js";
import { selectRustFlowReadProjection } from "../../policy/types/value-carrier-reconciliation.js";
import { recordRustFlowReadProjection } from "../facts/value-carrier-queries.js";
import { rustFlowReadProjectionFactKey } from "../facts/keys.js";
import { rustFlowReadProjectionMatches } from "../facts/flow-read-projections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

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
  if (members !== undefined && members.length > 1) return sourceCarrier;
  const selected = members?.length === 1 ? members[0]?.carrier : undefined;
  if (selected === undefined) return undefined;
  const projection = selectRustFlowReadProjection(sourceCarrier, selected, options.projectTypes, context.typeDefinitions);
  if (projection.kind !== "projection") return undefined;
  recordRustFlowReadProjection(context.facts, reference, projection.fact);
  return selected;
}

export function selectRustGuardedValueMembers(
  reference: Node,
  sourceCarrier: TargetTypeRef,
  context: RustOperationPolicyContext,
  options: RustTargetTypeResolutionOptions & { readonly projectTypes: RustProjectTypePolicy },
): ReturnType<typeof rustUnionLeaves> {
  return selectRustNativeFlowMembers({ ...context, navigation: context.source.navigation,
    sourceFacts: context.source.sourceFacts }, reference, sourceCarrier, options.projectTypes, context.typeDefinitions,
    expression => selectRustArrayTypeGuard(context, context.semanticsFor(expression).operations.call(expression), options.sourceProfiles));
}

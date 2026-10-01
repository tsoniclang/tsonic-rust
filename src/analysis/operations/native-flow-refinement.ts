import type { Node } from "@tsonic/tsts";
import type { RustOperationPolicyContext } from "../../policy/operations/contracts.js";
import type { RustTargetTypeResolutionOptions } from "../../policy/types/resolution.js";
import type { RustProjectTypePolicy } from "../../policy/types/project-types.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { selectRustNativeFlowRefinement } from "../../policy/types/resolution/native-flow-refinement.js";
import { selectRustArrayTypeGuard } from "../../policy/operations/source-profiles/js/type-tests.js";
import { selectRustFlowReadProjection } from "../../policy/types/value-carrier-reconciliation.js";
import { recordRustFlowReadProjection } from "../facts/value-carrier-queries.js";

export function selectRustGuardedValueCarrier(
  reference: Node,
  sourceCarrier: TargetTypeRef,
  context: RustOperationPolicyContext,
  options: RustTargetTypeResolutionOptions & { readonly projectTypes: RustProjectTypePolicy },
): TargetTypeRef | undefined {
  const selected = selectRustNativeFlowRefinement({ ...context, navigation: context.source.navigation,
    sourceFacts: context.source.sourceFacts }, reference, sourceCarrier, options.projectTypes, context.typeDefinitions,
    expression => selectRustArrayTypeGuard(context, context.semanticsFor(expression).operations.call(expression), options.sourceProfiles));
  if (selected === undefined) return undefined;
  const projection = selectRustFlowReadProjection(sourceCarrier, selected, options.projectTypes, context.typeDefinitions);
  if (projection.kind !== "projection") return undefined;
  recordRustFlowReadProjection(context.facts, reference, projection.fact);
  return selected;
}

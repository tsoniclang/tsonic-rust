import type { ExtensionFactSubject } from "@tsonic/tsts";
import type { RustOperationPolicyContext } from "../../policy/operations/contracts.js";
import { resolveRustTargetTypeRef, type RustTargetTypeResolutionOptions } from "../../policy/types/resolution.js";
import type { RustProjectTypePolicy } from "../../policy/types/project-types.js";
import { selectRustFlowReadProjection } from "../../policy/types/value-carrier-reconciliation.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { recordRustFlowReadProjection, rustEffectiveValueCarrier } from "../facts/value-carrier-queries.js";

export function selectedValueCarrier(
  expression: ExtensionFactSubject,
  selectedType: ExtensionFactSubject,
  context: RustOperationPolicyContext,
  options: RustTargetTypeResolutionOptions & { readonly projectTypes: RustProjectTypePolicy },
): TargetTypeRef | undefined {
  const stored = resolveRustTargetTypeRef(expression, context, options);
  const effective = rustEffectiveValueCarrier(context.facts, expression);
  if (effective !== undefined &&
    (stored === undefined || !rustTargetTypeRefEquals(effective, stored))) {
    return effective;
  }
  const selected = resolveRustTargetTypeRef(selectedType, context, options);
  if (stored === undefined || selected === undefined || rustTargetTypeRefEquals(stored, selected)) {
    return selected ?? stored;
  }
  const flowRead = selectRustFlowReadProjection(stored, selected, options.projectTypes, context.typeDefinitions);
  if (flowRead.kind === "projection") {
    recordRustFlowReadProjection(context.facts, expression, flowRead.fact);
    return selected;
  }
  if (stored.kind === "reference" && rustTargetTypeRefEquals(stored.referent, selected)) {
    return selected;
  }
  return stored;
}

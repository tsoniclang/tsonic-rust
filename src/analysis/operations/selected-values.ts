import type { ExtensionFactSubject } from "@tsonic/tsts";
import type { RustOperationPolicyContext } from "../../policy/operations/contracts.js";
import { resolveRustTargetTypeRef, type RustTargetTypeResolutionOptions } from "../../policy/types/resolution.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import { selectRustFlowReadProjection } from "../../policy/types/value-carrier-reconciliation.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { recordRustFlowReadProjection, rustEffectiveValueCarrier } from "../facts/value-carrier-queries.js";
import { rustPolicyNode } from "../../policy/model/context.js";
import { selectRustGuardedValueCarrier } from "./native-flow-refinement.js";
import { rustSourceAbsenceReadCarrier, rustSourceAbsenceUse } from "../expressions/absence-use.js";
import { rustOptionElementCarrier, rustSourceOptionalElementCarrier } from "../../target-model/types/carriers/optional.js";

export function selectedValueCarrier(
  expression: ExtensionFactSubject,
  selectedType: ExtensionFactSubject,
  context: RustOperationPolicyContext,
  options: RustTargetTypeResolutionOptions & { readonly projectTypes: RustProjectTypePolicy },
): TargetTypeRef | undefined {
  const stored = resolveRustTargetTypeRef(expression, context, options);
  const reference = rustPolicyNode(context, expression);
  const absenceUse = reference === undefined ? undefined : rustSourceAbsenceUse(reference, context);
  if (stored !== undefined && reference !== undefined &&
    rustOptionElementCarrier(stored) !== undefined && absenceUse === "comparison") return stored;
  const effective = rustSourceAbsenceReadCarrier(stored, rustEffectiveValueCarrier(context.facts, expression), absenceUse);
  const present = rustSourceOptionalElementCarrier(effective);
  if (absenceUse === undefined && effective !== undefined && present !== undefined && reference !== undefined) {
    const types = context.semanticsFor(reference).types;
    const type = types.expressionType(reference);
    const members = type === undefined ? [] : types.isUnion(type) ? types.unionOrIntersectionTypes(type) : [type];
    if (members.length > 0 && members.every(member => !types.isAny(member) && !types.isUnknown(member) &&
      !types.isNullish(member) && !types.isVoidLike(member) && !types.couldContainTypeVariables(member))) {
      const projection = selectRustFlowReadProjection(effective, present, options.projectTypes, context.typeDefinitions);
      if (projection.kind === "projection") {
        recordRustFlowReadProjection(context.facts, expression, projection.fact);
        return present;
      }
    }
  }
  if (effective !== undefined &&
    (stored === undefined || !rustTargetTypeRefEquals(effective, stored))) {
    return effective;
  }
  const guarded = stored === undefined || reference === undefined ? undefined
    : selectRustGuardedValueCarrier(reference, stored, context, options);
  if (guarded !== undefined) return rustSourceAbsenceReadCarrier(stored, guarded, absenceUse);
  const selected = rustSourceAbsenceReadCarrier(stored, resolveRustTargetTypeRef(selectedType, context, options), absenceUse);
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

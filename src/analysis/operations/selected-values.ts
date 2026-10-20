import type { RustOperationAnalysisContext } from "../program/operation-context.js";

import type { ExtensionFactSubject } from "@tsonic/tsts";
import { sourceAbsenceUse } from "@tsonic/target-api/source";

import { resolveRustTargetTypeRef, type RustTargetTypeResolutionOptions } from "../types/resolution/index.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";
import { rustPolicyNode } from "../../policy/model/context.js";
import { selectRustGuardedValueCarrier } from "./native-flow-refinement.js";
import { rustSourceAbsenceReadCarrier } from "../../policy/operations/flow/absence-use.js";
import { rustOptionElementCarrier, rustSourceOptionalElementCarrier } from "../../target-model/types/carriers/optional.js";

export function selectedValueCarrier(
  expression: ExtensionFactSubject,
  selectedType: ExtensionFactSubject,
  operationContext: RustOperationAnalysisContext,
  options: RustTargetTypeResolutionOptions & { readonly projectTypes: RustProjectTypePolicy },
): TargetTypeRef | undefined {
  const reference = rustPolicyNode(operationContext, expression);
  const storage = reference === undefined ? undefined : operationContext.sourceStorage.subjectFor(reference);
  const context = { ...operationContext, sourceStorageSubject: storage?.kind === "resolved" ? storage.subject : undefined };
  const stored = resolveRustTargetTypeRef(expression, context, options);
  const absenceUse = reference === undefined ? undefined : sourceAbsenceUse(reference, context);
  if (stored !== undefined && reference !== undefined &&
    rustOptionElementCarrier(stored) !== undefined && absenceUse === "comparison") return stored;
  const effective = rustSourceAbsenceReadCarrier(stored, rustEffectiveValueCarrier(context.records, expression), absenceUse);
  const present = rustSourceOptionalElementCarrier(effective);
  if (absenceUse === undefined && effective !== undefined && present !== undefined && reference !== undefined) {
    const types = context.semanticsFor(reference).types;
    const type = types.expressionType(reference);
    const members = type === undefined ? [] : types.isUnion(type) ? types.unionOrIntersectionTypes(type) : [type];
    if (members.length > 0 && members.every(member => !types.isAny(member) && !types.isUnknown(member) &&
      !types.isNullish(member) && !types.isVoidLike(member) && !types.couldContainTypeVariables(member))) {
      const projection = context.records.flowReadProjections.resolve(context.requiredRecords, reference, effective, present, options.projectTypes, context.typeDefinitions);
      if (projection.kind === "projection") {
        return projection.fact.selectedCarrier;
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
  const flowRead = reference === undefined ? undefined
    : context.records.flowReadProjections.resolve(context.requiredRecords, reference, stored, selected, options.projectTypes, context.typeDefinitions);
  if (flowRead?.kind === "projection") {
    return flowRead.fact.selectedCarrier;
  }
  if (stored.kind === "reference" && rustTargetTypeRefEquals(stored.referent, selected)) {
    return selected;
  }
  return stored;
}

import { requireRustRecord } from "../program/records/required-records.js";

import { isRustUnitCarrier, isRustOptionCarrier, rustOptionElementCarrier, rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";

import { selectRustIntegerTruncationConversion } from "../../policy/conversions/integer-truncation.js";
import { selectRustKnownNumericValueConversion } from "../../policy/conversions/selection.js";

import { rustCallableTargetForSourceLifetime, selectRustValueCarrierReconciliation } from "../../policy/conversions/value-carrier-reconciliation.js";
import { recordRustConversionSelection } from "../program/records/value-carrier-admission.js";
import { recordRustOptionProjection, recordRustValueCarrierReconciliation } from "../program/records/value-carrier-admission.js";

import { appendRustDiagnostic, rustOperationContext } from "../program/walk.js";

import { selectProviderRecordArgument } from "../operations/members/calls/record-arguments.js";
import { selectRustExactIntegerConversion } from "../../policy/conversions/exact-integer.js";
import { selectRustGuardedIntegerConversion } from "../../policy/conversions/integer-refinement.js";

import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function applyRustOptionalValueCarrier(
  walk: RustFactWalk,
  expression: Node,
  resolved: TargetTypeRef | undefined,
  expected: TargetTypeRef | undefined,
  integerConversion: "native" | "exact",
): TargetTypeRef | undefined {
  const expectedOptionElement = rustOptionElementCarrier(expected);
  const target = expected;
  let projected = resolved;
  if (resolved !== undefined && target !== undefined &&
    !rustTargetTypeRefEquals(resolved, target)) {
    const scalarTarget = expectedOptionElement ?? target;
    const retained = walk.context.records.contextualValueConversion.get(expression);
    const refined = selectRustGuardedIntegerConversion({ integerRanges: walk.context.integerRanges }, expression, resolved, scalarTarget);
    const exactInteger = refined ?? (integerConversion === "exact"
      ? selectRustExactIntegerConversion(resolved, scalarTarget) : undefined);
    const scalarConversion = selectRustKnownNumericValueConversion(resolved, scalarTarget,
      walk.context.literalValues.literalValue.get(expression)) ?? exactInteger;
    if (scalarConversion !== undefined || retained?.conversion.kind === "exact-integer" &&
      rustTargetTypeRefEquals(retained.sourceCarrier, resolved) &&
      rustTargetTypeRefEquals(retained.targetCarrier, scalarTarget)) {
      recordRustValueCarrierReconciliation(walk.context.records, walk.context.requiredRecords, expression, { kind: "conversion", fact: {
        sourceCarrier: resolved, targetCarrier: scalarTarget,
        conversion: scalarConversion ?? retained!.conversion,
      } });
      projected = scalarTarget;
    } else {
      const operation = walk.context.records.targetOperation.get(expression);
      const truncation = selectRustIntegerTruncationConversion(walk.context.ast, expression,
        operation?.kind === "provider-operation" ? operation.operationId : undefined, resolved, scalarTarget);
      if (truncation !== undefined) {
        recordRustValueCarrierReconciliation(walk.context.records, walk.context.requiredRecords, expression, { kind: "conversion",
          fact: { sourceCarrier: resolved, targetCarrier: scalarTarget, conversion: truncation } });
        projected = scalarTarget;
      }
      const reconciliationTarget = expectedOptionElement !== undefined && !isRustOptionCarrier(resolved)
        ? scalarTarget : target;
      let reconciliation = truncation === undefined ? selectRustValueCarrierReconciliation(
        resolved,
        reconciliationTarget,
        walk.context.projectTypes, walk.context.typeDefinitions,
      ) : { kind: "identity" as const };
      if (reconciliation.kind === "incompatible" && rustStructuralObjectCarrierValue(resolved) !== undefined) {
        const context = rustOperationContext(walk, expression);
        const conversion = selectProviderRecordArgument(
          context.currentSemantics.types.expressionType(expression),
          context.currentSemantics.types.contextualType(expression)?.selectedType,
          resolved, reconciliationTarget, context, walk.operationOptions,
        );
        if (conversion !== undefined) reconciliation = { kind: "conversion", fact: {
          sourceCarrier: resolved, targetCarrier: reconciliationTarget, conversion,
        } };
      }
      if (reconciliation.kind === "incompatible" && reconciliation.reason === "ambiguous") {
        appendRustDiagnostic(
          walk,
          "RUST_PROJECT_UPCAST_AMBIGUOUS",
          "The selected project value has more than one exact target heritage instantiation.",
          expression,
          ["target.capability=rust.project-types.upcast"],
        );
        return undefined;
      }
      if (reconciliation.kind === "call-scoped-lifetime" ||
        reconciliation.kind === "conversion" || reconciliation.kind === "project-upcast") {
        recordRustValueCarrierReconciliation(walk.context.records, walk.context.requiredRecords, expression, reconciliation);
        projected = reconciliation.kind === "call-scoped-lifetime"
          ? reconciliation.fact.selectedCarrier : reconciliation.fact.targetCarrier;
        if (reconciliation.kind === "project-upcast" && !isRustOptionCarrier(expected)) {
          recordRustConversionSelection(walk.context.records, walk.context.requiredRecords, expression, projected);
        }
      }
      if (reconciliation.kind === "incompatible" && reconciliation.reason === "unrelated") {
        const view = walk.context.records.objectReferenceViews.select(walk, expression, resolved, reconciliationTarget);
        if (view !== undefined) projected = view.targetCarrier;
      }
    }
  }
  if (expected === undefined || !isRustOptionCarrier(expected)) {
    return projected;
  }
  const inner = rustOptionElementCarrier(expected);
  if (inner === undefined) {
    return resolved;
  }
  if (projected !== undefined && isRustOptionCarrier(projected)) {
    return projected;
  }
  if (isRustUnitCarrier(projected)) {
    requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "option-none", "applyOptionLane");
    const existing = walk.context.records.targetOperation.get(expression);
    if (existing === undefined) {
      walk.context.records.targetOperations.source(expression, { kind: "option-none", operationId: "tsonic.rust.option.none" });
    }
    if (projected !== undefined) {
      recordRustOptionProjection(walk.context.records, walk.context.requiredRecords, expression, { kind: "none", sourceCarrier: projected, resultCarrier: expected });
    }
    return expected;
  }
  // An optional callable destination whose lifetime is still a placeholder takes the present callable's lifetime.
  const present = projected === undefined ? undefined : rustCallableTargetForSourceLifetime(projected, expected);
  const presentInner = present === undefined ? undefined : rustOptionElementCarrier(present);
  if (projected !== undefined && present !== undefined && rustTargetTypeRefEquals(projected, presentInner)) {
    recordRustOptionProjection(walk.context.records, walk.context.requiredRecords, expression, { kind: "some", sourceCarrier: projected,
      elementCarrier: presentInner!, resultCarrier: present });
    return present;
  }
  return resolved;
}

export function reconcileRequiredCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
): boolean {
  const reconciliation = selectRustValueCarrierReconciliation(
    sourceCarrier,
    targetCarrier,
    walk.context.projectTypes, walk.context.typeDefinitions,
  );
  if (reconciliation.kind === "incompatible") {
    return reconciliation.reason === "unrelated" &&
      walk.context.records.objectReferenceViews.select(walk, expression, sourceCarrier, targetCarrier) !== undefined;
  }
  if (reconciliation.kind === "call-scoped-lifetime" ||
    reconciliation.kind === "conversion" || reconciliation.kind === "project-upcast") {
    recordRustValueCarrierReconciliation(
      walk.context.records, walk.context.requiredRecords,
      expression,
      reconciliation,
    );
  }
  return true;
}

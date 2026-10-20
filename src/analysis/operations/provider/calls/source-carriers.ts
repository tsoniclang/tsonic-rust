import type { RustOperationAnalysisContext } from "../../../program/operation-context.js";
import { isRustAbsenceCarrier } from "../../../../target-model/types/index.js";

import { selectProviderRecordArgument } from "./record-arguments.js";

import { normalizeSelectedArgumentCarrier } from "../result.js";
import { selectRustValueCarrierReconciliation } from "../../../../policy/types/resolution/value-carrier-reconciliation.js";
import { rustEffectiveValueCarrier } from "../../../conversions/value-carrier-queries.js";

import { rustOptionElementCarrier } from "../../../../target-model/types/index.js";

import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { selectedSourceValueCarrier } from "../operators.js";

import { selectedCallSourceParameterCarriers, selectedRestSequenceIsClosed } from "./source-sequences.js";

import { selectReferenceReborrow } from "../../../../policy/conversions/reference-reborrows.js";

import type { RustCheckedCallSelectionInput } from "../../../../policy/operations/contracts.js";
import type { RustProviderOperationTemplate } from "../../../../target-model/operations/model.js";

import type { RustAppliedValueCarrierReconciliation } from "../../../../policy/types/resolution/value-carrier-reconciliation.js";
import type { RustOperationsProviderOptions } from "../model.js";

import type { TargetTypeRef } from "../../../../target-model/types/model.js";

import { rustProviderSourceArgumentMode } from "../../../../policy/types/callables/provider-argument-shape.js";

import { selectedCallArgumentTargetCarrier, incompatibleRustProviderSourceArgument } from "../../../../policy/operations/members/call-inputs.js";
type SelectedCallSourceCarriers =
  | {
      readonly kind: "resolved";
      readonly carriers: readonly TargetTypeRef[];
      readonly reconciliations: readonly {
        readonly sourceIndex: number;
        readonly reconciliation: RustAppliedValueCarrierReconciliation;
      }[];
    }
  | { readonly kind: "missing" }
  | {
      readonly kind: "incompatible";
      readonly sourceIndex: number;
      readonly actual?: TargetTypeRef;
      readonly expected?: TargetTypeRef;
    };

export function selectedCallSourceCarriers(
  request: RustCheckedCallSelectionInput,
  fact: RustProviderOperationTemplate,
  declared: readonly (TargetTypeRef | undefined)[] | undefined,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): SelectedCallSourceCarriers {
  const declaredBySourceIndex = selectedCallSourceParameterCarriers(request, fact, declared, context, options);
  if (declaredBySourceIndex === undefined) return { kind: "missing" };
  let incompatibility: Extract<SelectedCallSourceCarriers, { readonly kind: "incompatible" }> | undefined;
  const reconciliations: {
    readonly sourceIndex: number;
    readonly reconciliation: RustAppliedValueCarrierReconciliation;
  }[] = [];
  const actual = request.source.sourceArguments.map((sourceArgument, index) => {
    const argument = sourceArgument.expression;
    const targetExpected = selectedCallArgumentTargetCarrier(fact.target, index);
    const expected = targetExpected ?? declaredBySourceIndex.get(index);
    const resolved = selectedSourceValueCarrier(sourceArgument, context, options);
    if (context.ast.is.IsSpreadElement(argument)) {
      if (!selectedRestSequenceIsClosed(request, index, resolved, fact.target)) {
        incompatibility ??= { kind: "incompatible", sourceIndex: index, actual: resolved, expected };
      }
      return resolved;
    }
    const normalized = normalizeSelectedArgumentCarrier(argument, resolved, expected, context, options);
    let effective = rustEffectiveValueCarrier(context.records, argument) ?? normalized;
    const optionElement = rustOptionElementCarrier(expected);
    if (optionElement !== undefined && effective !== undefined &&
      (isRustAbsenceCarrier(effective) || rustTargetTypeRefEquals(effective, optionElement))) {
      effective = expected;
    }
    if (effective !== undefined && expected !== undefined &&
      !rustTargetTypeRefEquals(effective, expected)) {
      const reborrow = selectReferenceReborrow(
        effective,
        expected,
        rustProviderSourceArgumentMode(fact.target, index),
      );
      if (reborrow !== undefined) {
        reconciliations.push({
          sourceIndex: index,
          reconciliation: {
            kind: "conversion",
            fact: {
              sourceCarrier: effective,
              targetCarrier: expected,
              conversion: reborrow,
            },
          },
        });
        effective = expected;
      }
    }
    if (effective !== undefined && expected !== undefined &&
      !rustTargetTypeRefEquals(effective, expected)) {
      let reconciliation = selectRustValueCarrierReconciliation(
        effective,
        expected,
        options.projectTypes, context.typeDefinitions,
      );
      if (reconciliation.kind === "incompatible" &&
        (rustProviderSourceArgumentMode(fact.target, index) ?? "value") === "value") {
        const bindings = request.source.sourceArgumentBindings.filter(binding =>
          binding.sourceArgumentIndex === index && binding.sourceForm === "value");
        const selected = bindings.length === 1 ? bindings[0] : undefined;
        const conversion = selected === undefined ? undefined : selectProviderRecordArgument(
          selected.selectedArgumentType, selected.selectedParameterType,
          effective, expected, context, options,
        );
        if (conversion !== undefined) reconciliation = { kind: "conversion", fact: {
          sourceCarrier: effective, targetCarrier: expected, conversion,
        } };
      }
      if (reconciliation.kind === "call-scoped-lifetime" ||
        reconciliation.kind === "conversion" || reconciliation.kind === "project-upcast") {
        if (reconciliation.kind === "call-scoped-lifetime" ||
          reconciliation.kind === "project-upcast" || targetExpected === undefined) {
          reconciliations.push({ sourceIndex: index, reconciliation });
          effective = reconciliation.kind === "call-scoped-lifetime"
            ? reconciliation.fact.selectedCarrier : reconciliation.fact.targetCarrier;
        }
      } else if (reconciliation.kind === "incompatible") {
        incompatibility ??= { kind: "incompatible", sourceIndex: index, actual: effective, expected };
      }
    }
    return effective;
  });
  if (incompatibility !== undefined) {
    return incompatibility;
  }
  if (actual.some((carrier) => carrier === undefined)) {
    return { kind: "missing" };
  }
  const resolved = {
    kind: "resolved" as const,
    carriers: actual as TargetTypeRef[],
    reconciliations,
  };
  const incompatible = incompatibleRustProviderSourceArgument(fact.target, resolved.carriers, context.typeDefinitions);
  return incompatible === undefined ? resolved : { kind: "incompatible", sourceIndex: incompatible };
}

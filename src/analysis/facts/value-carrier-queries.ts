import type { ExtensionFactSubject } from "@tsonic/tsts";
import type {
  RustPlanQueries,
  RustPlanWriter,
} from "../../policy/model/selections.js";
import { rustTargetTypeRefEquals } from "../../policy/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type {
  RustAppliedValueCarrierReconciliation,
} from "../../policy/types/value-carrier-reconciliation.js";
import type { RustFlowReadProjectionFact } from "../../policy/types/value-projections.js";
import {
  rustContextualValueConversionFactKey,
  rustFlowReadProjectionFactKey,
  rustOptionProjectionFactKey,
  rustProjectUpcastFactKey,
} from "./keys.js";

export function recordRustFlowReadProjection(
  facts: RustPlanWriter,
  subject: ExtensionFactSubject,
  fact: RustFlowReadProjectionFact,
): void {
  facts.set(subject, rustFlowReadProjectionFactKey, fact, [
    { message: `rust exact ${fact.kind} flow-read projection` },
  ]);
}

export function recordRustValueCarrierReconciliation(
  facts: RustPlanWriter,
  subject: ExtensionFactSubject,
  reconciliation: RustAppliedValueCarrierReconciliation,
): void {
  if (reconciliation.kind === "project-upcast") {
    facts.set(subject, rustProjectUpcastFactKey, reconciliation.fact, [
      { message: "rust exact project-type upcast" },
    ]);
    return;
  }
  facts.set(
    subject,
    rustContextualValueConversionFactKey,
    reconciliation.fact,
    [{ message: "rust exact contextual value conversion" }],
  );
}

export function rustValueCarrierBeforeContextualConversion(
  facts: RustPlanQueries,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  return facts.getFact(subject, rustProjectUpcastFactKey)?.targetCarrier ??
    facts.getTargetConversionFact(subject)?.convertedType ??
    facts.getFact(subject, rustFlowReadProjectionFactKey)?.selectedCarrier ??
    facts.getRuntimeCarrierFact(subject)?.carrier;
}

export function rustValueCarrierBeforeOptionProjection(
  facts: RustPlanQueries,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  return facts.getFact(subject, rustContextualValueConversionFactKey)?.targetCarrier ??
    rustValueCarrierBeforeContextualConversion(facts, subject);
}

export function rustEffectiveValueCarrier(
  facts: RustPlanQueries,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  return facts.getFact(subject, rustOptionProjectionFactKey)?.resultCarrier ??
    rustValueCarrierBeforeOptionProjection(facts, subject);
}

export function rustValueCarrierTransitionTarget(
  facts: RustPlanQueries,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  const source = facts.getRuntimeCarrierFact(subject)?.carrier;
  const effective = rustEffectiveValueCarrier(facts, subject);
  return source === undefined || effective === undefined ||
      rustTargetTypeRefEquals(source, effective)
    ? undefined
    : effective;
}

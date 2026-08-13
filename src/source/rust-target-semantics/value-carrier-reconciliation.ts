import type { ExtensionFactSubject } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type { RustSemanticModel } from "../../policy/model.js";
import type { TargetTypeRef } from "../../policy/types.js";
import {
  rustContextualValueConversionFactKey,
  rustOptionProjectionFactKey,
  rustProjectUpcastFactKey,
} from "../rust-facts/keys.js";
import type {
  RustContextualValueConversionFact,
} from "../rust-facts/keys.js";
import { selectRustSourceValueConversion } from "../rust-facts/value-conversions.js";

export type RustValueCarrierReconciliation =
  | { readonly kind: "identity" }
  | { readonly kind: "conversion"; readonly fact: RustContextualValueConversionFact }
  | { readonly kind: "incompatible" };

export function selectRustValueCarrierReconciliation(
  sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
): RustValueCarrierReconciliation {
  if (rustTargetTypeRefEquals(sourceCarrier, targetCarrier)) {
    return { kind: "identity" };
  }
  const conversion = selectRustSourceValueConversion(sourceCarrier, targetCarrier);
  return conversion === undefined
    ? { kind: "incompatible" }
    : {
        kind: "conversion",
        fact: { sourceCarrier, targetCarrier, conversion },
      };
}

export function recordRustValueCarrierReconciliation(
  facts: RustSemanticModel,
  subject: ExtensionFactSubject,
  reconciliation: Extract<RustValueCarrierReconciliation, { readonly kind: "conversion" }>,
): void {
  facts.set(subject, rustContextualValueConversionFactKey, reconciliation.fact, [
    { message: "rust exact contextual value conversion" },
  ]);
}

export function rustValueCarrierBeforeContextualConversion(
  facts: RustSemanticModel,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  return facts.getFact(subject, rustProjectUpcastFactKey)?.targetCarrier ??
    facts.getTargetConversionFact(subject)?.convertedType ??
    facts.getRuntimeCarrierFact(subject)?.carrier;
}

export function rustValueCarrierBeforeOptionProjection(
  facts: RustSemanticModel,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  return facts.getFact(subject, rustContextualValueConversionFactKey)?.targetCarrier ??
    rustValueCarrierBeforeContextualConversion(facts, subject);
}

export function rustEffectiveValueCarrier(
  facts: RustSemanticModel,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  return facts.getFact(subject, rustOptionProjectionFactKey)?.resultCarrier ??
    rustValueCarrierBeforeOptionProjection(facts, subject);
}

export function rustValueCarrierTransitionTarget(
  facts: RustSemanticModel,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  const source = facts.getRuntimeCarrierFact(subject)?.carrier;
  const effective = rustEffectiveValueCarrier(facts, subject);
  return source === undefined || effective === undefined ||
      rustTargetTypeRefEquals(source, effective)
    ? undefined
    : effective;
}

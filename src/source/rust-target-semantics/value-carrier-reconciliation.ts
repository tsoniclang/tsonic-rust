import type { ExtensionFactSubject } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import { rustConversionKey } from "../../policy/model.js";
import type { RustSemanticModel } from "../../policy/model.js";
import type { TargetTypeRef } from "../../policy/types.js";
import {
  rustContextualValueConversionFactKey,
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
  facts.set(subject, rustConversionKey, {
    convertedType: reconciliation.fact.targetCarrier,
  }, [{ message: "rust contextual target carrier" }]);
}

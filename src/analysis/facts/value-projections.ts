import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustPlanKey } from "../../target-model/facts/keys.js";
import type {
  RustBindingProjectionFact,
  RustContextualValueConversionFact,
  RustFlowReadProjectionFact,
  RustOptionProjectionFact,
  RustProjectDowncastFact,
  RustProjectUpcastFact,
  RustSourceBindingFact,
} from "../../policy/types/value-projections.js";

export const rustOptionProjectionFactKey: RustPlanKey<RustOptionProjectionFact> =
  defineRustPlanKey("optionProjection", closedMetadataEquals);

export const rustFlowReadProjectionFactKey: RustPlanKey<RustFlowReadProjectionFact> =
  defineRustPlanKey("flowReadProjection", (left, right) =>
    left.kind === right.kind &&
    rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
    rustTargetTypeRefEquals(left.selectedCarrier, right.selectedCarrier) &&
    (left.kind !== "project-downcast" ||
      (right.kind === "project-downcast" &&
        rustTargetTypeRefEquals(left.dispatchCarrier, right.dispatchCarrier))) &&
    (left.kind !== "program-error-variant" ||
      (right.kind === "program-error-variant" && left.variant === right.variant)));

export const rustContextualValueConversionFactKey: RustPlanKey<RustContextualValueConversionFact> =
  defineRustPlanKey("contextualValueConversion", closedMetadataEquals);

export const rustProjectUpcastFactKey: RustPlanKey<RustProjectUpcastFact> =
  defineRustPlanKey("projectUpcast", (left, right) =>
    rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
    rustTargetTypeRefEquals(left.targetCarrier, right.targetCarrier));

export const rustProjectDowncastFactKey: RustPlanKey<RustProjectDowncastFact> =
  defineRustPlanKey("projectDowncast", (left, right) =>
    rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
    rustTargetTypeRefEquals(left.dispatchCarrier, right.dispatchCarrier) &&
    rustTargetTypeRefEquals(left.targetCarrier, right.targetCarrier));

export const rustSourceBindingFactKey: RustPlanKey<RustSourceBindingFact> =
  defineRustPlanKey("sourceBinding", (left, right) =>
    left.scope === right.scope &&
    left.sourceName === right.sourceName &&
    left.sourceDeclaration === right.sourceDeclaration &&
    (left.scope !== "module" ||
      (right.scope === "module" && left.fileName === right.fileName)));

export const rustBindingProjectionFactKey: RustPlanKey<RustBindingProjectionFact> =
  defineRustPlanKey("bindingProjection", (left, right) =>
    rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
    rustTargetTypeRefEquals(left.projectedCarrier, right.projectedCarrier) &&
    rustTargetTypeRefEquals(left.bindingCarrier, right.bindingCarrier) &&
    closedMetadataEquals(left.projection, right.projection) &&
    left.normalization === right.normalization);

// Formal source-use facts: mutation is recorded per declaration subject at
// semantics finalization; the backend never scans for writes.
export const rustMutatedBindingFactKey: RustPlanKey<{ readonly mutated: true }> =
  defineRustPlanKey("mutatedBinding", () => true);

// Referent mutation: the value behind the binding is written (field/element
// writes, &mut borrows, mutating receiver methods). Owned bindings need
// `let mut`; reference-typed bindings do not.
export const rustMutatedReferentFactKey: RustPlanKey<{ readonly mutated: true }> =
  defineRustPlanKey("mutatedReferent", () => true);

export const rustSelfModeFactKey: RustPlanKey<{ readonly mode: "ref" | "mut-ref" }> =
  defineRustPlanKey("selfMode", (left, right) => left.mode === right.mode);

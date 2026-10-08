import type { ExtensionFactSubject } from "@tsonic/tsts";
import { rustIndexedFieldKeyArgument } from "./indexed-field-keys.js";
import { rustObjectReferenceViewKey } from "./object-reference-views.js";
import type {
  RustPlanQueries,
  RustPlanWriter,
} from "../../target-model/facts/selections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isRustOptionCarrier, rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustCompilerOwnedContextualConversionMatches, type RustContextualValueConversion } from "../../target-model/conversions/contextual.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type {
  RustAppliedValueCarrierReconciliation,
} from "../../policy/types/value-carrier-reconciliation.js";
import type { RustFlowReadProjectionFact, RustProjectUpcastFact } from "../../target-model/types/value-projections.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import {
  rustCallScopedLifetimeReconciliationFactKey,
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
  if (reconciliation.kind === "call-scoped-lifetime") {
    facts.set(subject, rustCallScopedLifetimeReconciliationFactKey, reconciliation.fact, [
      { message: "rust exact call-scoped lifetime reconciliation" },
    ]);
    return;
  }
  if (reconciliation.kind === "project-upcast") {
    facts.set(subject, rustProjectUpcastFactKey, reconciliation.fact, [
      { message: "rust exact project-type upcast" },
    ]);
    return;
  }
  if (reconciliation.upcast !== undefined) {
    facts.set(subject, rustProjectUpcastFactKey, reconciliation.upcast, [
      { message: "rust exact project payload upcast before contextual conversion" },
    ]);
  }
  const { sourceCarrier, targetCarrier, conversion } = reconciliation.fact;
  if (conversion.kind === "option-some") {
    if (!rustTargetTypeRefEquals(sourceCarrier, conversion.source) ||
      !rustTargetTypeRefEquals(rustOptionElementCarrier(targetCarrier), conversion.element)) {
      throw new Error("Rust optional admission must retain its exact source and selected payload.");
    }
    if (conversion.elementConversion !== null) {
      facts.set(subject, rustContextualValueConversionFactKey, {
        sourceCarrier,
        targetCarrier: conversion.element,
        conversion: conversion.elementConversion,
      }, [{ message: "rust exact contextual payload conversion before presence" }]);
    }
    facts.set(subject, rustOptionProjectionFactKey, {
      kind: "some", sourceCarrier: conversion.element,
      elementCarrier: conversion.element, resultCarrier: targetCarrier,
    }, [{ message: "rust exact option-some projection" }]);
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
  return facts.getFact(subject, rustCallScopedLifetimeReconciliationFactKey)?.selectedCarrier ??
    rustValueCarrierBeforeCallScopedLifetimeReconciliation(facts, subject);
}

export function rustValueCarrierBeforeCallScopedLifetimeReconciliation(
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
    facts.getFact(subject, rustIndexedFieldKeyArgument)?.carrier ??
    facts.getFact(subject, rustObjectReferenceViewKey)?.targetCarrier ??
    rustValueCarrierBeforeContextualConversion(facts, subject);
}

export function rustEffectiveValueCarrier(
  facts: RustPlanQueries,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  return facts.getFact(subject, rustOptionProjectionFactKey)?.resultCarrier ??
    rustValueCarrierBeforeOptionProjection(facts, subject);
}

export function rustValueReferenceReborrow(
  facts: RustPlanQueries,
  subject: ExtensionFactSubject | undefined,
  definitions: RustTypeDefinitions,
): Extract<RustContextualValueConversion, { readonly kind: "reference-reborrow" }> | undefined {
  const fact = facts.getFact(subject, rustContextualValueConversionFactKey);
  const conversion = fact?.conversion;
  return fact !== undefined && conversion?.kind === "reference-reborrow" &&
    rustCompilerOwnedContextualConversionMatches(fact.sourceCarrier, fact.targetCarrier, conversion, definitions)
    ? conversion : undefined;
}

export function rustStrictEqualityOperandCarrier(
  facts: RustPlanQueries,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  const runtime = facts.getRuntimeCarrierFact(subject)?.carrier;
  if (isRustOptionCarrier(runtime)) return runtime;
  const projection = facts.getFact(subject, rustOptionProjectionFactKey);
  return projection !== undefined && isRustOptionCarrier(projection.resultCarrier)
    ? projection.sourceCarrier : rustEffectiveValueCarrier(facts, subject);
}

export function rustValueCarrierTransitionTarget(
  facts: RustPlanQueries,
  subject: ExtensionFactSubject | undefined,
  source: TargetTypeRef | undefined = facts.getRuntimeCarrierFact(subject)?.carrier,
): TargetTypeRef | undefined {
  const raw = facts.getRuntimeCarrierFact(subject)?.carrier;
  const flow = facts.getFact(subject, rustFlowReadProjectionFactKey);
  if (!rustTargetTypeRefEquals(source, raw) && !rustTargetTypeRefEquals(source, flow?.sourceCarrier)) return undefined;
  const effective = rustEffectiveValueCarrier(facts, subject);
  return source === undefined || effective === undefined ||
      rustTargetTypeRefEquals(source, effective)
    ? undefined
    : effective;
}

export function rustProjectUpcastSourceMatches(
  fact: RustProjectUpcastFact,
  definitions: RustTypeDefinitions,
): boolean {
  const variants = definitions.sourceUnionVariants(fact.sourceCarrier);
  if (variants === undefined) return fact.sourceVariants === undefined;
  return variants.length > 0 && fact.sourceVariants !== undefined &&
    fact.sourceVariants.length === variants.length && variants.every((variant, index) => {
      const selected = fact.sourceVariants?.[index];
      return selected !== undefined && selected.name === variant.name &&
        rustTargetTypeRefEquals(selected.carrier, variant.carrier);
    });
}

import type { ExtensionFactSubject } from "@tsonic/tsts";

import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustProgramRecordWriter } from "../program/records/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isRustOptionCarrier, rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustCompilerOwnedContextualConversionMatches } from "../../target-model/conversions/contextual.js";
import type { RustContextualValueConversion } from "../../target-model/conversions/contextual.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustAppliedValueCarrierReconciliation } from "../../policy/types/resolution/value-carrier-reconciliation.js";
import type { RustFlowReadProjectionFact, RustProjectUpcastFact } from "../../target-model/records/value-projections.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";

export function recordRustFlowReadProjection(
  records: RustProgramRecordWriter,
  subject: ExtensionFactSubject,
  fact: RustFlowReadProjectionFact,
): void {
  records.flowReadProjection.set(subject, fact, [
    { message: `rust exact ${fact.kind} flow-read projection` },
  ]);
}

export function recordRustValueCarrierReconciliation(
  records: RustProgramRecordWriter,
  subject: ExtensionFactSubject,
  reconciliation: RustAppliedValueCarrierReconciliation,
): void {
  if (reconciliation.kind === "call-scoped-lifetime") {
    records.callScopedLifetimeReconciliation.set(subject, reconciliation.fact, [
      { message: "rust exact call-scoped lifetime reconciliation" },
    ]);
    return;
  }
  if (reconciliation.kind === "project-upcast") {
    records.projectUpcast.set(subject, reconciliation.fact, [
      { message: "rust exact project-type upcast" },
    ]);
    return;
  }
  if (reconciliation.upcast !== undefined) {
    records.projectUpcast.set(subject, reconciliation.upcast, [
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
      records.contextualValueConversion.set(subject, {
        sourceCarrier,
        targetCarrier: conversion.element,
        conversion: conversion.elementConversion,
      }, [{ message: "rust exact contextual payload conversion before presence" }]);
    }
    records.optionProjection.set(subject, {
      kind: "some", sourceCarrier: conversion.element,
      elementCarrier: conversion.element, resultCarrier: targetCarrier,
    }, [{ message: "rust exact option-some projection" }]);
    return;
  }
  records.contextualValueConversion.set(subject, reconciliation.fact, [{ message: "rust exact contextual value conversion" }]);
}

export function rustValueCarrierBeforeContextualConversion(
  records: RustProgramRecords,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  return records.callScopedLifetimeReconciliation.get(subject)?.selectedCarrier ??
    rustValueCarrierBeforeCallScopedLifetimeReconciliation(records, subject);
}

export function rustValueCarrierBeforeCallScopedLifetimeReconciliation(
  records: RustProgramRecords,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  return records.projectUpcast.get(subject)?.targetCarrier ??
    records.conversion.get(subject)?.convertedType ??
    records.flowReadProjection.get(subject)?.selectedCarrier ??
    records.runtimeCarrier.get(subject)?.carrier;
}

export function rustValueCarrierBeforeOptionProjection(
  records: RustProgramRecords,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  return records.contextualValueConversion.get(subject)?.targetCarrier ??
    records.indexedFieldKeyArgument.get(subject)?.carrier ??
    records.objectReferenceView.get(subject)?.targetCarrier ??
    rustValueCarrierBeforeContextualConversion(records, subject);
}

export function rustEffectiveValueCarrier(
  records: RustProgramRecords,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  return records.optionProjection.get(subject)?.resultCarrier ??
    rustValueCarrierBeforeOptionProjection(records, subject);
}

export function rustValueReferenceReborrow(
  records: RustProgramRecords,
  subject: ExtensionFactSubject | undefined,
  definitions: RustTypeDefinitions,
): Extract<RustContextualValueConversion, { readonly kind: "reference-reborrow" }> | undefined {
  const fact = records.contextualValueConversion.get(subject);
  const conversion = fact?.conversion;
  return fact !== undefined && conversion?.kind === "reference-reborrow" &&
    rustCompilerOwnedContextualConversionMatches(fact.sourceCarrier, fact.targetCarrier, conversion, definitions)
    ? conversion : undefined;
}

export function rustStrictEqualityOperandCarrier(
  records: RustProgramRecords,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  const runtime = records.runtimeCarrier.get(subject)?.carrier;
  if (isRustOptionCarrier(runtime)) return runtime;
  const projection = records.optionProjection.get(subject);
  return projection !== undefined && isRustOptionCarrier(projection.resultCarrier)
    ? projection.sourceCarrier : rustEffectiveValueCarrier(records, subject);
}

export function rustValueCarrierTransitionTarget(
  records: RustProgramRecords,
  subject: ExtensionFactSubject | undefined,
  source: TargetTypeRef | undefined = records.runtimeCarrier.get(subject)?.carrier,
): TargetTypeRef | undefined {
  const raw = records.runtimeCarrier.get(subject)?.carrier;
  const flow = records.flowReadProjection.get(subject);
  if (!rustTargetTypeRefEquals(source, raw) && !rustTargetTypeRefEquals(source, flow?.sourceCarrier) &&
    !rustTargetTypeRefEquals(source, flow?.selectedCarrier)) return undefined;
  const effective = rustEffectiveValueCarrier(records, subject);
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

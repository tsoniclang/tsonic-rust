import type { ExtensionFactSubject } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";

import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustProgramRecordWriter } from "../program/records/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isRustOptionCarrier, rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustCompilerOwnedContextualConversionMatches } from "../../target-model/conversions/contextual.js";
import type { RustContextualValueConversion } from "../../target-model/conversions/contextual.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustAppliedValueCarrierReconciliation } from "../../policy/types/resolution/value-carrier-reconciliation.js";
import type { RustContextualValueConversionFact, RustOptionProjectionFact, RustProjectUpcastFact } from "../../target-model/records/value-projections.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import { rustCallScopedLifetimeReconciliationEquals } from "../../target-model/records/equality.js";

export function recordRustValueCarrierReconciliation(
  records: RustProgramRecordWriter,
  subject: ExtensionFactSubject,
  reconciliation: RustAppliedValueCarrierReconciliation,
): void {
  records.assertOpen();
  if (reconciliation.kind === "call-scoped-lifetime") {
    const previous = records.callScopedLifetimeReconciliation.get(subject);
    if (previous !== undefined) {
      if (!rustCallScopedLifetimeReconciliationEquals(previous, reconciliation.fact)) {
        failTargetAnalysisInvariant("tsonic-rust",
          "Conflicting Rust semantic plan 'tsonic.rust.callScopedLifetimeReconciliation' for one exact source subject.");
      }
    } else records.callScopedLifetimes.reconcile(subject, reconciliation.fact.sourceCarrier, reconciliation.fact.selectedCarrier);
    return;
  }
  if (reconciliation.kind === "project-upcast") {
    recordRustProjectUpcast(records, subject, reconciliation.fact);
    return;
  }
  if (reconciliation.upcast !== undefined) {
    recordRustProjectUpcast(records, subject, reconciliation.upcast);
  }
  const { sourceCarrier, targetCarrier, conversion } = reconciliation.fact;
  if (conversion.kind === "option-some") {
    if (!rustTargetTypeRefEquals(sourceCarrier, conversion.source) ||
      !rustTargetTypeRefEquals(rustOptionElementCarrier(targetCarrier), conversion.element)) {
      failTargetAnalysisInvariant("tsonic-rust", "Rust optional admission must retain its exact source and selected payload.");
    }
    if (conversion.elementConversion !== null) {
      recordRustContextualConversion(records, subject, { sourceCarrier, targetCarrier: conversion.element,
        conversion: conversion.elementConversion });
    }
    recordRustOptionProjection(records, subject, { kind: "some", sourceCarrier: conversion.element,
      elementCarrier: conversion.element, resultCarrier: targetCarrier });
    return;
  }
  recordRustContextualConversion(records, subject, reconciliation.fact);
}

function recordRustProjectUpcast(records: RustProgramRecordWriter, subject: ExtensionFactSubject, selected: RustProjectUpcastFact): void {
  const normalized = { sourceCarrier: selected.sourceCarrier, targetCarrier: selected.targetCarrier,
    ...(selected.sourceVariants === undefined ? {} : { sourceVariants: selected.sourceVariants }) };
  const previous = records.projectUpcast.get(subject);
  if (previous !== undefined) {
    if (!closedMetadataEquals(previous, normalized)) {
      failTargetAnalysisInvariant("tsonic-rust",
        "Conflicting Rust semantic plan 'tsonic.rust.projectUpcast' for one exact source subject.");
    }
  } else records.projectUpcasts.project(subject, selected.sourceCarrier, selected.targetCarrier, selected.sourceVariants);
}

function recordRustContextualConversion(
  records: RustProgramRecordWriter,
  subject: ExtensionFactSubject,
  selected: RustContextualValueConversionFact,
): void {
  const previous = records.contextualValueConversion.get(subject);
  if (previous !== undefined) {
    if (!closedMetadataEquals(previous, selected)) {
      failTargetAnalysisInvariant("tsonic-rust",
        "Conflicting Rust semantic plan 'tsonic.rust.contextualValueConversion' for one exact source subject.");
    }
  } else records.contextualValueConversions.convert(subject, selected.sourceCarrier, selected.targetCarrier, selected.conversion);
}

export function recordRustOptionProjection(records: RustProgramRecordWriter, subject: ExtensionFactSubject, selected: RustOptionProjectionFact): void {
  records.assertOpen();
  const previous = records.optionProjection.get(subject);
  if (previous !== undefined) {
    if (!closedMetadataEquals(previous, selected)) {
      failTargetAnalysisInvariant("tsonic-rust",
        "Conflicting Rust semantic plan 'tsonic.rust.optionProjection' for one exact source subject.");
    }
  } else if (selected.kind === "none") records.optionProjections.none(subject, selected.sourceCarrier, selected.resultCarrier);
  else records.optionProjections.some(subject, selected.sourceCarrier, selected.elementCarrier, selected.resultCarrier);
}

export function recordRustConversionSelection(
  records: RustProgramRecordWriter,
  subject: ExtensionFactSubject,
  convertedType: TargetTypeRef | undefined,
): void {
  records.assertOpen();
  const previous = records.conversion.get(subject);
  if (previous !== undefined) {
    if (!rustTargetTypeRefEquals(previous.convertedType, convertedType)) {
      failTargetAnalysisInvariant("tsonic-rust",
        "Conflicting Rust semantic plan 'tsonic.rust.conversion' for one exact source subject.");
    }
  } else records.conversions.converted(subject, convertedType);
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

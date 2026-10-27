import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";

import type { RustProgramRecordWriter } from "../model.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustOptionElementCarrier } from "../../../../target-model/types/carriers/optional.js";

import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustAppliedValueCarrierReconciliation } from "../../../../policy/conversions/value-carrier-reconciliation.js";
import type { RustContextualValueConversionFact, RustOptionProjectionFact, RustProjectUpcastFact } from "../../../../target-model/records/objects/value-projections.js";

import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import { rustCallScopedLifetimeReconciliationEquals } from "../../../../target-model/records/operations/equality.js";
import { requireRustRecord, type RustRequiredRecord } from "../objects/required-records.js";

export function recordRustValueCarrierReconciliation(
  records: RustProgramRecordWriter,
  requiredRecords: RustRequiredRecord[],
  subject: Node,
  reconciliation: RustAppliedValueCarrierReconciliation,
): void {
  records.assertOpen();
  if (reconciliation.kind === "call-scoped-lifetime") {
    requireRustRecord(requiredRecords, "callScopedLifetimeReconciliation", subject,
      reconciliation.kind, "recordRustValueCarrierReconciliation");
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
    recordRustProjectUpcast(records, requiredRecords, subject, reconciliation.fact);
    return;
  }
  if (reconciliation.upcast !== undefined) {
    recordRustProjectUpcast(records, requiredRecords, subject, reconciliation.upcast);
  }
  const { sourceCarrier, targetCarrier, conversion } = reconciliation.fact;
  if (conversion.kind === "option-some") {
    if (!rustTargetTypeRefEquals(sourceCarrier, conversion.source) ||
      !rustTargetTypeRefEquals(rustOptionElementCarrier(targetCarrier), conversion.element)) {
      failTargetAnalysisInvariant("tsonic-rust", "Rust optional admission must retain its exact source and selected payload.");
    }
    if (conversion.elementConversion !== null) {
      recordRustContextualConversion(records, requiredRecords, subject, { sourceCarrier, targetCarrier: conversion.element,
        conversion: conversion.elementConversion });
    }
    recordRustOptionProjection(records, requiredRecords, subject, { kind: "some", sourceCarrier: conversion.element,
      elementCarrier: conversion.element, resultCarrier: targetCarrier });
    return;
  }
  recordRustContextualConversion(records, requiredRecords, subject, reconciliation.fact);
}

function recordRustProjectUpcast(records: RustProgramRecordWriter, requiredRecords: RustRequiredRecord[],
  subject: Node, selected: RustProjectUpcastFact): void {
  const normalized = { sourceCarrier: selected.sourceCarrier, targetCarrier: selected.targetCarrier,
    ...(selected.sourceVariants === undefined ? {} : { sourceVariants: selected.sourceVariants }) };
  requireRustRecord(requiredRecords, "projectUpcast", subject, "project upcast", "recordRustProjectUpcast");
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
  requiredRecords: RustRequiredRecord[],
  subject: Node,
  selected: RustContextualValueConversionFact,
): void {
  requireRustRecord(requiredRecords, "contextualValueConversion", subject, selected.conversion.kind, "recordRustContextualConversion");
  const previous = records.contextualValueConversion.get(subject);
  if (previous !== undefined) {
    if (!closedMetadataEquals(previous, selected)) {
      failTargetAnalysisInvariant("tsonic-rust",
        "Conflicting Rust semantic plan 'tsonic.rust.contextualValueConversion' for one exact source subject.");
    }
  } else records.contextualValueConversions.convert(subject, selected.sourceCarrier, selected.targetCarrier, selected.conversion);
}

export function recordRustOptionProjection(records: RustProgramRecordWriter, requiredRecords: RustRequiredRecord[],
  subject: Node, selected: RustOptionProjectionFact): void {
  records.assertOpen();
  requireRustRecord(requiredRecords, "optionProjection", subject, selected.kind, "recordRustOptionProjection");
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
  requiredRecords: RustRequiredRecord[],
  subject: Node,
  convertedType: TargetTypeRef | undefined,
): void {
  records.assertOpen();
  if (convertedType !== undefined) requireRustRecord(requiredRecords, "conversion", subject,
    "checked conversion", "recordRustConversionSelection");
  const previous = records.conversion.get(subject);
  if (previous !== undefined) {
    if (!rustTargetTypeRefEquals(previous.convertedType, convertedType)) {
      failTargetAnalysisInvariant("tsonic-rust",
        "Conflicting Rust semantic plan 'tsonic.rust.conversion' for one exact source subject.");
    }
  } else records.conversions.converted(subject, convertedType);
}

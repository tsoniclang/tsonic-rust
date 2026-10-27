import type { ExtensionFactSubject } from "@tsonic/tsts";

import type { RustProgramRecords } from "../../target-model/records/program.js";

import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isRustOptionCarrier } from "../../target-model/types/carriers/optional.js";
import { rustCompilerOwnedContextualConversionMatches } from "../../policy/conversions/contextual.js";
import type { RustContextualValueConversion } from "../../target-model/conversions/contextual.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import type { RustProjectUpcastFact } from "../../target-model/records/objects/value-projections.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";

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

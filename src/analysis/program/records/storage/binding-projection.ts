import type { Node } from "@tsonic/tsts";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustBindingProjectionFact, RustBindingValueProjectionFact } from "../../../../target-model/records/objects/value-projections.js";
import { rustBindingNormalizationContract } from "../../../../policy/types/storage/binding-normalization.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { createRustRecordFamily } from "../family.js";
import { requireRustRecord, type RustRequiredRecord } from "../objects/required-records.js";

export interface RustBindingProjectionProducer {
  readonly records: RustRecordFamily<RustBindingProjectionFact>;
  resolve(requiredRecords: RustRequiredRecord[], binding: Node, sourceCarrier: TargetTypeRef, projectedCarrier: TargetTypeRef,
    projection: RustBindingValueProjectionFact["projection"], defaultCarrier?: TargetTypeRef,
    checkedArrayElement?: TargetTypeRef): RustBindingValueProjectionFact | undefined;
  omitted(requiredRecords: RustRequiredRecord[], binding: Node, sourceCarrier: TargetTypeRef): void;
}

export function createRustBindingProjectionProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustBindingProjectionFact>,
): RustBindingProjectionProducer {
  const family = createRustRecordFamily<RustBindingProjectionFact>({
    id: "tsonic.rust.bindingProjection",
    equals: (left, right) => {
      if (!rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) ||
        !closedMetadataEquals(left.projection, right.projection)) return false;
      if (!("bindingCarrier" in left)) return !("bindingCarrier" in right);
      return "bindingCarrier" in right && rustTargetTypeRefEquals(left.projectedCarrier, right.projectedCarrier) &&
        rustTargetTypeRefEquals(left.storageCarrier, right.storageCarrier) &&
        rustTargetTypeRefEquals(left.bindingCarrier, right.bindingCarrier) && left.normalization === right.normalization;
    },
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    resolve(requiredRecords: RustRequiredRecord[], binding: Node, sourceCarrier: TargetTypeRef, projectedCarrier: TargetTypeRef,
      projection: RustBindingValueProjectionFact["projection"], defaultCarrier?: TargetTypeRef,
      checkedArrayElement?: TargetTypeRef): RustBindingValueProjectionFact | undefined {
      assertOpen();
      const normalized = rustBindingNormalizationContract(projectedCarrier, defaultCarrier, checkedArrayElement);
      if (normalized === undefined) return undefined;
      requireRustRecord(requiredRecords, "bindingProjection", binding, projection.kind, "bindingProjections.resolve");
      const fact = Object.freeze({ sourceCarrier, projectedCarrier,
        storageCarrier: normalized.storageCarrier, bindingCarrier: normalized.bindingCarrier,
        projection, normalization: normalized.normalization,
      });
      family.writer.set(binding, fact);
      return fact;
    },
    omitted(requiredRecords: RustRequiredRecord[], binding: Node, sourceCarrier: TargetTypeRef): void {
      assertOpen();
      requireRustRecord(requiredRecords, "bindingProjection", binding, "omitted", "bindingProjections.omitted");
      family.writer.set(binding, Object.freeze({ sourceCarrier, projection: Object.freeze({ kind: "omitted" as const }) }));
    },
  });
}

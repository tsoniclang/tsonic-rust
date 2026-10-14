import type { Node } from "@tsonic/tsts";
import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import type { RustBindingProjection, RustBindingProjectionFact } from "../../../target-model/records/value-projections.js";
import { rustBindingNormalizationContract } from "../../../target-model/types/binding-normalization.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { createRustRecordFamily } from "./family.js";

export interface RustBindingProjectionProducer {
  readonly records: RustRecordFamily<RustBindingProjectionFact>;
  resolve(binding: Node, sourceCarrier: TargetTypeRef, projectedCarrier: TargetTypeRef,
    projection: RustBindingProjection, defaultCarrier?: TargetTypeRef, checkedArrayElement?: TargetTypeRef): RustBindingProjectionFact | undefined;
}

export function createRustBindingProjectionProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustBindingProjectionFact>,
): RustBindingProjectionProducer {
  const family = createRustRecordFamily<RustBindingProjectionFact>({
    id: "tsonic.rust.bindingProjection",
    equals: (left, right) => rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
      rustTargetTypeRefEquals(left.projectedCarrier, right.projectedCarrier) &&
      rustTargetTypeRefEquals(left.storageCarrier, right.storageCarrier) &&
      rustTargetTypeRefEquals(left.bindingCarrier, right.bindingCarrier) &&
      closedMetadataEquals(left.projection, right.projection) && left.normalization === right.normalization,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    resolve(binding: Node, sourceCarrier: TargetTypeRef, projectedCarrier: TargetTypeRef,
      projection: RustBindingProjection, defaultCarrier?: TargetTypeRef, checkedArrayElement?: TargetTypeRef): RustBindingProjectionFact | undefined {
      assertOpen();
      const normalized = rustBindingNormalizationContract(projectedCarrier, defaultCarrier, checkedArrayElement);
      if (normalized === undefined) return undefined;
      const fact = Object.freeze({ sourceCarrier, projectedCarrier,
        storageCarrier: normalized.storageCarrier, bindingCarrier: normalized.bindingCarrier,
        projection, normalization: normalized.normalization,
      });
      family.writer.set(binding, fact);
      return fact;
    },
  });
}

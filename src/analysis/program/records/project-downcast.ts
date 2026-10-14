import type { ExtensionFactSubject } from "@tsonic/tsts";
import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import type { RustProjectDowncastFact } from "../../../target-model/records/value-projections.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustProjectProjectionSelection } from "../../../target-model/types/project-projections.js";
import { createRustRecordFamily } from "./family.js";

export interface RustProjectDowncastProducer {
  readonly records: RustRecordFamily<RustProjectDowncastFact>;
  project(subject: ExtensionFactSubject, sourceCarrier: TargetTypeRef, dispatchCarrier: TargetTypeRef,
    targetCarrier: TargetTypeRef, projection: RustProjectProjectionSelection): void;
}

export function createRustProjectDowncastProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustProjectDowncastFact>,
): RustProjectDowncastProducer {
  const family = createRustRecordFamily({
    id: "tsonic.rust.projectDowncast",
    equals: (left: RustProjectDowncastFact, right: RustProjectDowncastFact) =>
      rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
      rustTargetTypeRefEquals(left.dispatchCarrier, right.dispatchCarrier) &&
      rustTargetTypeRefEquals(left.targetCarrier, right.targetCarrier) &&
      closedMetadataEquals(left.projection, right.projection),
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    project(subject: ExtensionFactSubject, sourceCarrier: TargetTypeRef, dispatchCarrier: TargetTypeRef,
      targetCarrier: TargetTypeRef, projection: RustProjectProjectionSelection): void {
      family.writer.set(subject, Object.freeze({ sourceCarrier, dispatchCarrier, targetCarrier, projection }));
    },
  });
}

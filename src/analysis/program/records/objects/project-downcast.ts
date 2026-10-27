import type { ExtensionFactSubject } from "@tsonic/tsts";
import { rustProjectDowncastEquals } from "../../../../target-model/records/operations/equality.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustProjectDowncastFact, RustProjectProjectionSelection } from "../../../../target-model/types/project-projections.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { createRustRecordFamily } from "../family.js";
import { createRustProjectDowncastQuery } from "../../../control-flow/project-downcasts.js";
import type { RustProjectDowncastQuery } from "../../../control-flow/project-downcasts.js";

export interface RustProjectDowncastProducer {
  readonly records: RustRecordFamily<RustProjectDowncastFact>;
  readonly resolve: RustProjectDowncastQuery;
  project(subject: ExtensionFactSubject, sourceCarrier: TargetTypeRef, dispatchCarrier: TargetTypeRef,
    targetCarrier: TargetTypeRef, projection: RustProjectProjectionSelection): void;
}

export function createRustProjectDowncastProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustProjectDowncastFact>,
): RustProjectDowncastProducer {
  const family = createRustRecordFamily({
    id: "tsonic.rust.projectDowncast",
    equals: rustProjectDowncastEquals,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    resolve: createRustProjectDowncastQuery({ assertOpen, records: family.reader,
      publish: (subject, fact) => family.writer.set(subject, fact) }),
    project(subject: ExtensionFactSubject, sourceCarrier: TargetTypeRef, dispatchCarrier: TargetTypeRef,
      targetCarrier: TargetTypeRef, projection: RustProjectProjectionSelection): void {
      family.writer.set(subject, Object.freeze({ sourceCarrier, dispatchCarrier, targetCarrier, projection }));
    },
  });
}

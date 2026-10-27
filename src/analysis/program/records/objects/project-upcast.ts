import type { ExtensionFactSubject } from "@tsonic/tsts";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustProjectUpcastFact } from "../../../../target-model/records/objects/value-projections.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { createRustRecordFamily } from "../family.js";

export interface RustProjectUpcastProducer {
  readonly records: RustRecordFamily<RustProjectUpcastFact>;
  project(subject: ExtensionFactSubject, sourceCarrier: TargetTypeRef, targetCarrier: TargetTypeRef,
    sourceVariants?: RustProjectUpcastFact["sourceVariants"]): void;
}

export function createRustProjectUpcastProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustProjectUpcastFact>,
): RustProjectUpcastProducer {
  const family = createRustRecordFamily<RustProjectUpcastFact>({
    id: "tsonic.rust.projectUpcast", equals: closedMetadataEquals,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    project(subject: ExtensionFactSubject, sourceCarrier: TargetTypeRef, targetCarrier: TargetTypeRef,
      sourceVariants?: RustProjectUpcastFact["sourceVariants"]): void {
      family.writer.set(subject, Object.freeze({ sourceCarrier, targetCarrier,
        ...(sourceVariants === undefined ? {} : { sourceVariants }),
      }));
    },
  });
}

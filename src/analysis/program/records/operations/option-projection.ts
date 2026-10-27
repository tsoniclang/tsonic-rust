import type { ExtensionFactSubject } from "@tsonic/tsts";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustOptionProjectionFact } from "../../../../target-model/records/objects/value-projections.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { createRustRecordFamily } from "../family.js";

export interface RustOptionProjectionProducer {
  readonly records: RustRecordFamily<RustOptionProjectionFact>;
  none(subject: ExtensionFactSubject, source: TargetTypeRef, result: TargetTypeRef): void;
  some(subject: ExtensionFactSubject, source: TargetTypeRef, element: TargetTypeRef, result: TargetTypeRef): void;
}

export function createRustOptionProjectionProducer(
  assertOpen: () => void, inherited?: RustOptionProjectionProducer["records"],
): RustOptionProjectionProducer {
  const family = createRustRecordFamily<RustOptionProjectionFact>({ id: "tsonic.rust.optionProjection", equals: closedMetadataEquals },
    assertOpen, inherited);
  return Object.freeze({ records: family.reader,
    none(subject: ExtensionFactSubject, source: TargetTypeRef, result: TargetTypeRef): void {
      assertOpen();
      family.writer.set(subject, Object.freeze({ kind: "none", sourceCarrier: source, resultCarrier: result }));
    },
    some(subject: ExtensionFactSubject, source: TargetTypeRef, element: TargetTypeRef, result: TargetTypeRef): void {
      assertOpen();
      family.writer.set(subject, Object.freeze({ kind: "some", sourceCarrier: source, elementCarrier: element, resultCarrier: result }));
    },
  });
}

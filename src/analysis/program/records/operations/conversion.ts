import type { ExtensionFactSubject } from "@tsonic/tsts";
import type { RustFoundation } from "../../../../target-model/foundation/model.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustConversionSelection } from "../../../../target-model/records/selections.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustFoundationForCarrier } from "../../../foundation/requirements.js";
import { createRustRecordFamily } from "../family.js";

export interface RustConversionProducer {
  readonly records: RustRecordFamily<RustConversionSelection>;
  converted(subject: ExtensionFactSubject, convertedType: TargetTypeRef | undefined): void;
}

export function createRustConversionProducer(
  assertOpen: () => void, requireFoundation: (foundation: RustFoundation) => void,
  inherited?: RustConversionProducer["records"],
): RustConversionProducer {
  const family = createRustRecordFamily<RustConversionSelection>({ id: "tsonic.rust.conversion",
    equals: (left, right) => rustTargetTypeRefEquals(left.convertedType, right.convertedType) }, assertOpen, inherited,
    fact => requireFoundation(fact.convertedType === undefined ? "core" : rustFoundationForCarrier(fact.convertedType)));
  return Object.freeze({ records: family.reader,
    converted(subject: ExtensionFactSubject, convertedType: TargetTypeRef | undefined): void {
      assertOpen();
      family.writer.set(subject, Object.freeze(convertedType === undefined ? {} : { convertedType }));
    },
  });
}

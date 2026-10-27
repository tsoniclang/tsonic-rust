import type { ExtensionFactSubject } from "@tsonic/tsts";
import type { RustFoundation } from "../../../../target-model/foundation/model.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustRuntimeCarrierSelection } from "../../../../target-model/records/selections.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustFoundationForCarrier } from "../../../foundation/requirements.js";
import { createRustRecordFamily, type RustRecordConflict } from "../family.js";

export interface RustRuntimeCarrierProducer {
  readonly records: RustRecordFamily<RustRuntimeCarrierSelection>;
  selected(subject: ExtensionFactSubject, carrier: TargetTypeRef): void;
  source(subject: ExtensionFactSubject, carrier: TargetTypeRef): RustRecordConflict<RustRuntimeCarrierSelection> | undefined;
}

export function createRustRuntimeCarrierProducer(
  assertOpen: () => void,
  requireFoundation: (foundation: RustFoundation) => void,
  inherited?: RustRecordFamily<RustRuntimeCarrierSelection>,
): RustRuntimeCarrierProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.runtimeCarrier", equals: (
    left: RustRuntimeCarrierSelection, right: RustRuntimeCarrierSelection,
  ) => rustTargetTypeRefEquals(left.carrier, right.carrier) }, assertOpen, inherited,
  value => requireFoundation(rustFoundationForCarrier(value.carrier)));
  return Object.freeze({
    records: family.reader,
    selected(subject: ExtensionFactSubject, carrier: TargetTypeRef): void {
      family.writer.set(subject, { carrier });
    },
    source(subject: ExtensionFactSubject, carrier: TargetTypeRef): RustRecordConflict<RustRuntimeCarrierSelection> | undefined {
      assertOpen();
      const existing = family.reader.get(subject);
      return existing === undefined ? family.admit(subject, { carrier })
        : rustTargetTypeRefEquals(existing.carrier, carrier) ? undefined : { existing, incoming: { carrier } };
    },
  });
}

import type { ExtensionFactSubject } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustCallScopedLifetimeReconciliationFact } from "../../../../target-model/records/objects/value-projections.js";
import { rustCallScopedLifetimeReconciliationEquals } from "../../../../target-model/records/operations/equality.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { createRustRecordFamily } from "../family.js";

export interface RustCallScopedLifetimeReconciliationProducer {
  readonly records: RustRecordFamily<RustCallScopedLifetimeReconciliationFact>;
  reconcile(subject: ExtensionFactSubject, sourceCarrier: TargetTypeRef, selectedCarrier: TargetTypeRef): void;
}

export function createRustCallScopedLifetimeReconciliationProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustCallScopedLifetimeReconciliationFact>,
): RustCallScopedLifetimeReconciliationProducer {
  const family = createRustRecordFamily({
    id: "tsonic.rust.callScopedLifetimeReconciliation",
    equals: rustCallScopedLifetimeReconciliationEquals,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    reconcile(subject: ExtensionFactSubject, sourceCarrier: TargetTypeRef, selectedCarrier: TargetTypeRef): void {
      family.writer.set(subject, Object.freeze({ sourceCarrier, selectedCarrier }));
    },
  });
}

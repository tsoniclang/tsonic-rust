import type { ExtensionFactSubject } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import type { RustCallScopedLifetimeReconciliationFact } from "../../../target-model/records/value-projections.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { createRustRecordFamily } from "./family.js";

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
    equals: (left: RustCallScopedLifetimeReconciliationFact, right: RustCallScopedLifetimeReconciliationFact) =>
      rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
      rustTargetTypeRefEquals(left.selectedCarrier, right.selectedCarrier),
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    reconcile(subject: ExtensionFactSubject, sourceCarrier: TargetTypeRef, selectedCarrier: TargetTypeRef): void {
      family.writer.set(subject, Object.freeze({ sourceCarrier, selectedCarrier }));
    },
  });
}

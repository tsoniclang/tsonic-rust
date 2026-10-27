import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustRecordContributionFact, RustRecordContributionEvidence, RustRecordContributionRecords } from "../../../../target-model/records/objects/record-contributions.js";

export function createRustRecordContributionProducer(assertOpen: () => void) {
  const values = new WeakMap<RustRecordContributionFact, RustRecordContributionEvidence>();
  const records: RustRecordContributionRecords = Object.freeze({ recordContribution: Object.freeze({
    get: (fact: RustRecordContributionFact) => values.get(fact),
  }) });
  return Object.freeze({ records, publish(fact: RustRecordContributionFact, value: RustRecordContributionEvidence): void {
    assertOpen();
    if (values.has(fact)) failTargetAnalysisInvariant("tsonic-rust", "A record contribution has one exact source evaluation owner.");
    values.set(fact, Object.freeze(value));
  } });
}

export type RustRecordContributionProducer = ReturnType<typeof createRustRecordContributionProducer>;

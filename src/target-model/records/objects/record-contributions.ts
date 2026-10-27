import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../operations/operations.js";

export type RustRecordContributionFact = Extract<RustTargetOperationFact, { readonly kind: "record-literal" }>;
export type RustRecordSpreadContribution = Extract<RustRecordContributionFact["contributions"][number], { readonly kind: "spread" }>;

export interface RustRecordSpreadEvidence {
  readonly optional: boolean;
  readonly absentFields: ReadonlySet<RustRecordSpreadContribution["fields"][number]>;
  readonly retained: ReadonlySet<RustRecordSpreadContribution["fields"][number]>;
  readonly evaluated: ReadonlySet<RustRecordSpreadContribution["fields"][number]>;
}

export interface RustRecordContributionEvidence {
  readonly finalFields: ReadonlyMap<number, number>;
  readonly finalMethods: ReadonlyMap<Node, number>;
  readonly spreads: ReadonlyMap<RustRecordSpreadContribution, RustRecordSpreadEvidence>;
}

export interface RustRecordContributionRecords {
  readonly recordContribution: { readonly get: (fact: RustRecordContributionFact) => RustRecordContributionEvidence | undefined };
}

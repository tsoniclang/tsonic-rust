import type { RustTargetOperationFact } from "../../target-model/records/operations.js";
import type { Node } from "@tsonic/tsts";
import type { RustStructuralShapePlan } from "../objects/structural-shape-plan.js";
import { rustOptionElementCarrier } from "../../target-model/types/index.js";

export type RustRecordContributionFact = Extract<RustTargetOperationFact, { readonly kind: "record-literal" }>;
export type RustRecordSpreadContribution = Extract<RustRecordContributionFact["contributions"][number], { readonly kind: "spread" }>;
type RecordFact = RustRecordContributionFact;
type Spread = RustRecordSpreadContribution;

export interface RustRecordSpreadEvidence {
  readonly retained: ReadonlySet<Spread["fields"][number]>;
  readonly evaluated: ReadonlySet<Spread["fields"][number]>;
}

export interface RustRecordContributionEvidence {
  readonly finalFields: ReadonlyMap<number, number>;
  readonly finalMethods: ReadonlyMap<Node, number>;
  readonly spreads: ReadonlyMap<Spread, RustRecordSpreadEvidence>;
}

export function analyzeRustRecordContributions(
  fact: RecordFact,
  shapes: Pick<RustStructuralShapePlan, "field" | "definitionForCarrier">,
): RustRecordContributionEvidence {
  const finalFields = rustRecordFinalFieldContributions(fact);
  const finalMethods = new Map<Node, number>();
  const spreads = new Map<Spread, RustRecordSpreadEvidence>();
  for (const [index, contribution] of fact.contributions.entries()) {
    if (contribution.kind === "method") {
      for (const declaration of contribution.contractDeclarations) finalMethods.set(declaration, index);
    }
    if (contribution.kind !== "spread") continue;
    for (const method of contribution.methods) finalMethods.set(method.contractDeclaration, index);
    const retained = new Set(contribution.fields.filter(field =>
      rustRecordSpreadRetainsField(contribution, field, index, finalFields)));
    spreads.set(contribution, Object.freeze({
      retained,
      evaluated: new Set(contribution.fields.filter(field =>
        retained.has(field) || rustRecordSpreadReadIsObservable(contribution, field, shapes))),
    }));
  }
  return Object.freeze({ finalFields, finalMethods, spreads });
}

export function rustRecordFinalFieldContributions(fact: RecordFact): ReadonlyMap<number, number> {
  const final = new Map<number, number>();
  fact.contributions.forEach((contribution, index) => {
    if (contribution.kind === "property" || contribution.kind === "structural-method")
      final.set(contribution.targetStorageIndex, index);
    else if (contribution.kind === "spread" && rustOptionElementCarrier(contribution.sourceCarrier) === undefined)
      for (const field of contribution.fields) final.set(field.targetStorageIndex, index);
  });
  return final;
}

export function rustRecordSpreadRetainsField(
  spread: Spread, field: Spread["fields"][number], index: number, final: ReadonlyMap<number, number>,
): boolean {
  return rustOptionElementCarrier(spread.sourceCarrier) === undefined
    ? final.get(field.targetStorageIndex) === index
    : (final.get(field.targetStorageIndex) ?? -1) < index;
}

export function rustRecordSpreadReadIsObservable(
  spread: Spread, field: Spread["fields"][number], shapes: Pick<RustStructuralShapePlan, "field" | "definitionForCarrier">,
): boolean {
  const storage = spread.sourceStorage === "structural-object"
    ? shapes.field(spread.sourceValueCarrier, field.sourceStorageIndex) : undefined;
  return field.accessor !== undefined || storage !== undefined &&
    (storage.storage !== "stored" || storage.nativeLayout !== undefined ||
      shapes.definitionForCarrier(spread.sourceValueCarrier)?.dispatchName !== undefined);
}

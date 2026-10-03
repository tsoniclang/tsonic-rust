import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import type { RustStructuralShapePlan } from "../../../analysis/objects/structural-shape-plan.js";
import { rustOptionElementCarrier } from "../../../target-model/types/index.js";

type RecordFact = Extract<RustTargetOperationFact, { readonly kind: "record-literal" }>;
type Spread = Extract<RecordFact["contributions"][number], { readonly kind: "spread" }>;

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

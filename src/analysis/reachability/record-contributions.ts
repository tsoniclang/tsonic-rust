import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustRecordContributionProducer } from "../program/records/objects/record-contributions.js";
import type { RustRecordContributionFact, RustRecordSpreadContribution, RustRecordSpreadEvidence, RustRecordContributionEvidence } from "../../target-model/records/objects/record-contributions.js";
import type { RustStructuralShapePlan } from "../objects/shapes/structural-shape-plan.js";
import { rustOptionElementCarrier } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

type RecordFact = RustRecordContributionFact;
type Spread = RustRecordSpreadContribution;

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
      optional: rustOptionElementCarrier(contribution.sourceCarrier) !== undefined,
      absentFields: new Set(contribution.fields.filter(field => rustOptionElementCarrier(field.carrier) !== undefined)),
      retained,
      evaluated: new Set(contribution.fields.filter(field =>
        retained.has(field) || rustRecordSpreadReadIsObservable(contribution, field, shapes))),
    }));
  }
  return Object.freeze({ finalFields, finalMethods, spreads });
}

export function admitRustRecordContributions(program: Omit<RustAnalysisProgram, "reachability">,
  values: ReadonlyMap<RustRecordContributionFact, RustRecordContributionEvidence>, producer: RustRecordContributionProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  for (const [fact, value] of values) {
    for (const [spread, evidence] of value.spreads) {
      const source = rustOptionElementCarrier(spread.sourceCarrier) ?? spread.sourceCarrier;
      const index = fact.contributions.indexOf(spread);
      if (!rustTargetTypeRefEquals(source, spread.sourceValueCarrier) || evidence.optional &&
        spread.methods.some(method => value.finalMethods.get(method.contractDeclaration) === index))
        issues.push({ code: "RUST_UNSUPPORTED_AST", category: "error", source: "tsonic-rust", sourceNode: spread.property,
          message: `Record spread requires its exact native source carrier and non-optional retained method storage. Node kind: ${program.source.ast.kindName(spread.property)}.`,
          evidence: ["target.capability=rust.backend.record-spread"] });
    }
    producer.publish(fact, value);
  }
  return Object.freeze(issues);
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

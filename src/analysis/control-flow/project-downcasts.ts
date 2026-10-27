import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustProgramRecords, RustRecordFamily } from "../../target-model/records/program.js";
import type { Node } from "@tsonic/tsts";
import type { RustProjectDowncastFact } from "../../target-model/types/project-projections.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import { rustOptionElementCarrier } from "../../target-model/types/index.js";
import { rustProjectDowncastEquals } from "../../target-model/records/operations/equality.js";
import { selectRustProjectProjection } from "../../policy/types/project/project-projections.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/objects/required-records.js";

export type RustProjectDowncastQuery = (
  requiredRecords: RustRequiredRecord[],
  subject: Node,
  sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
  projectTypes: RustProjectTypePolicy,
) => RustProjectDowncastFact | undefined;

export function createRustProjectDowncastQuery(input: {
  readonly assertOpen: () => void;
  readonly records: RustRecordFamily<RustProjectDowncastFact>;
  readonly publish: (subject: Node, fact: RustProjectDowncastFact) => void;
}): RustProjectDowncastQuery {
  const completed = new WeakMap<Node, { readonly canonical: RustProjectDowncastFact;
    readonly policies: Set<RustProjectTypePolicy> }>();
  return (requiredRecords, subject, sourceCarrier, targetCarrier, projectTypes) => {
    input.assertOpen();
    const previous = input.records.get(subject);
    const completion = completed.get(subject);
    if (previous !== undefined && completion?.canonical === previous && completion.policies.has(projectTypes) &&
      rustTargetTypeRefEquals(previous.sourceCarrier, sourceCarrier) &&
      rustTargetTypeRefEquals(previous.targetCarrier, targetCarrier)) return previous;
    const dispatchCarrier = rustOptionElementCarrier(sourceCarrier) ?? sourceCarrier;
    const sourceDefinition = projectTypes.definitionForCarrier(dispatchCarrier);
    const targetDefinition = projectTypes.definitionForCarrier(targetCarrier);
    const relationship = sourceDefinition === undefined || targetDefinition === undefined ||
        targetDefinition.kind !== "class"
      ? { kind: "unrelated" as const }
      : projectTypes.relationship(targetCarrier, sourceDefinition);
    const projection = selectRustProjectProjection(dispatchCarrier, targetCarrier, projectTypes);
    if (sourceDefinition === undefined || relationship.kind !== "related" ||
      !rustTargetTypeRefEquals(relationship.targetType, dispatchCarrier) || projection === undefined) return undefined;
    const selected = Object.freeze({ sourceCarrier, dispatchCarrier, targetCarrier, projection });
    requireRustRecord(requiredRecords, "projectDowncast", subject, projection.kind, "projectDowncasts.resolve");
    if (previous !== undefined && !rustProjectDowncastEquals(previous, selected)) {
      failTargetAnalysisInvariant("tsonic-rust",
        "Conflicting Rust semantic plan 'tsonic.rust.projectDowncast' for one exact source subject.",
      );
    }
    if (previous === undefined) input.publish(subject, selected);
    const canonical = previous ?? input.records.get(subject)!;
    const policies = completion?.canonical === canonical ? completion.policies : new Set<RustProjectTypePolicy>();
    policies.add(projectTypes);
    completed.set(subject, { canonical, policies });
    return canonical;
  };
}

export function rustSelectedProjectDowncast(
  records: RustProgramRecords,
  node: Node,
): RustProjectDowncastFact | undefined {
  const selected = records.projectDowncast.get(node);
  const flow = records.flowReadProjection.get(node);
  if (flow?.kind !== "project-downcast") return selected;
  const projection = Object.freeze({
    sourceCarrier: flow.sourceCarrier,
    dispatchCarrier: flow.dispatchCarrier,
    targetCarrier: flow.selectedCarrier,
    projection: flow.projection,
  });
  return selected === undefined ? projection
    : rustProjectDowncastEquals(selected, projection)
      ? selected : undefined;
}

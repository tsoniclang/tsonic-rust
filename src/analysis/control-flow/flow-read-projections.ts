import type { RustFlowReadProjectionFact } from "../../target-model/records/objects/value-projections.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { isRustTargetTypeRef } from "../../target-model/types/equality.js";
import { selectRustFlowReadProjection } from "../../policy/conversions/value-carrier-reconciliation.js";
import type { RustFlowReadProjectionSelection } from "../../policy/conversions/value-carrier-reconciliation.js";
import type { ExtensionFactSubject, Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustRecordFamily } from "../../target-model/records/program.js";
import { rustFlowReadProjectionEquals } from "../../target-model/records/operations/equality.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/objects/required-records.js";

export interface RustFlowReadProjectionQueries {
  readonly resolve: (requiredRecords: RustRequiredRecord[], subject: Node, source: TargetTypeRef, selected: TargetTypeRef,
    projectTypes: RustProjectTypePolicy, definitions: RustTypeDefinitions) => RustFlowReadProjectionSelection;
  readonly validate: (subject: ExtensionFactSubject, source: TargetTypeRef, projectTypes: RustProjectTypePolicy,
    definitions: RustTypeDefinitions) => Exclude<RustFlowReadProjectionSelection, { readonly kind: "identity" }> | undefined;
}

export function createRustFlowReadProjectionQueries(input: {
  readonly assertOpen: () => void;
  readonly records: RustRecordFamily<RustFlowReadProjectionFact>;
  readonly publish: (subject: ExtensionFactSubject, fact: RustFlowReadProjectionFact) => void;
}): RustFlowReadProjectionQueries {
  const completed = new WeakMap<ExtensionFactSubject, {
    readonly canonical: RustFlowReadProjectionFact;
    readonly requests: WeakMap<RustProjectTypePolicy, WeakSet<RustTypeDefinitions>>;
  }>();
  const selectionFor = (subject: ExtensionFactSubject, source: TargetTypeRef, selected: TargetTypeRef,
    projectTypes: RustProjectTypePolicy, definitions: RustTypeDefinitions,
    existing: RustFlowReadProjectionFact | undefined): RustFlowReadProjectionSelection => {
    const completion = completed.get(subject);
    if (existing !== undefined && completion?.canonical === existing &&
      rustTargetTypeRefEquals(existing.sourceCarrier, source) && rustTargetTypeRefEquals(existing.selectedCarrier, selected) &&
      completion.requests.get(projectTypes)?.has(definitions) === true) return { kind: "projection", fact: existing };
    return selectRustFlowReadProjection(source, selected, projectTypes, definitions);
  };
  const remember = (subject: ExtensionFactSubject, canonical: RustFlowReadProjectionFact,
    projectTypes: RustProjectTypePolicy, definitions: RustTypeDefinitions): Extract<RustFlowReadProjectionSelection, { readonly kind: "projection" }> => {
    let completion = completed.get(subject);
    if (completion?.canonical !== canonical) {
      completion = { canonical, requests: new WeakMap() };
      completed.set(subject, completion);
    }
    let readers = completion.requests.get(projectTypes);
    if (readers === undefined) {
      readers = new WeakSet();
      completion.requests.set(projectTypes, readers);
    }
    readers.add(definitions);
    return { kind: "projection", fact: canonical };
  };
  return Object.freeze({
    resolve(requiredRecords: RustRequiredRecord[], subject: Node, source: TargetTypeRef, selected: TargetTypeRef,
      projectTypes: RustProjectTypePolicy, definitions: RustTypeDefinitions): RustFlowReadProjectionSelection {
      input.assertOpen();
      const existing = input.records.get(subject);
      const selection = selectionFor(subject, source, selected, projectTypes, definitions, existing);
      if (selection.kind === "projection" && selection.fact === existing) return selection;
      if (selection.kind === "incompatible") return selection;
      if (existing !== undefined && (selection.kind !== "projection" || !rustFlowReadProjectionEquals(existing, selection.fact))) {
        failTargetAnalysisInvariant("tsonic-rust", "Conflicting Rust semantic plan 'tsonic.rust.flowReadProjection' for one exact source subject.");
      }
      if (selection.kind !== "projection") return selection;
      requireRustRecord(requiredRecords, "flowReadProjection", subject, selection.fact.kind, "flowReadProjections.resolve");
      if (existing === undefined) input.publish(subject, selection.fact);
      const canonical = existing ?? input.records.get(subject);
      if (canonical === undefined || !rustFlowReadProjectionEquals(canonical, selection.fact)) {
        failTargetAnalysisInvariant("tsonic-rust", "Rust flow projection admission did not publish its complete native proof.");
      }
      return remember(subject, canonical, projectTypes, definitions);
    },
    validate(subject: ExtensionFactSubject, source: TargetTypeRef, projectTypes: RustProjectTypePolicy,
      definitions: RustTypeDefinitions): Exclude<RustFlowReadProjectionSelection, { readonly kind: "identity" }> | undefined {
      input.assertOpen();
      const existing = input.records.get(subject);
      if (existing === undefined) return undefined;
      if (!isRustTargetTypeRef(existing.sourceCarrier) || !isRustTargetTypeRef(existing.selectedCarrier) ||
        !rustTargetTypeRefEquals(existing.sourceCarrier, source)) return { kind: "incompatible" };
      const selection = selectionFor(subject, source, existing.selectedCarrier, projectTypes, definitions, existing);
      if (selection.kind === "projection" && selection.fact === existing) return selection;
      if (selection.kind !== "projection" || !rustFlowReadProjectionEquals(existing, selection.fact)) return { kind: "incompatible" };
      return { kind: "projection", fact: remember(subject, existing, projectTypes, definitions).fact };
    },
  });
}

export function rustFlowReadProjectionMatches(
  fact: RustFlowReadProjectionFact, projectTypes: RustProjectTypePolicy, definitions: RustTypeDefinitions,
): boolean {
  if (!isRustTargetTypeRef(fact.sourceCarrier) || !isRustTargetTypeRef(fact.selectedCarrier)) return false;
  const selected = selectRustFlowReadProjection(fact.sourceCarrier, fact.selectedCarrier, projectTypes, definitions);
  return selected.kind === "projection" && rustFlowReadProjectionEquals(selected.fact, fact);
}

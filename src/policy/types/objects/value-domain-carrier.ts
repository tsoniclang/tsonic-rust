import type { Node, SourceFile } from "@tsonic/tsts";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustJsArrayLikeElementTargetType } from "../../../target-model/types/carriers/js.js";
import { rustFixedArrayCarrierValue } from "../../../target-model/types/carriers/native.js";

export interface RustValueDomainCarrierHost {
  readonly sourceStorage?: SourceStorageQueries;
  readonly types: {
    resolveNode(node: Node, sourceFile: SourceFile): TargetTypeRef | undefined;
  };
  semantics(sourceFile: SourceFile): SourceFileSemantics;
}

export function rustValueDomainHasTargetType(
  host: RustValueDomainCarrierHost,
  node: Node,
  expected: TargetTypeRef,
): boolean {
  const storage = host.sourceStorage;
  if (storage === undefined || storage.failureReason() !== undefined) return false;
  const selected = storage.subjectFor(node);
  if (selected.kind !== "resolved") return false;
  const origins = storage.closedOriginsFor(selected.subject);
  if (origins.kind !== "complete" || origins.origins.length === 0) return false;
  const sourceFile = storage.source.ast.getSourceFile(node);
  if (sourceFile === undefined || !storage.source.semantics.includes(sourceFile)) return false;
  const queries = host.semantics(sourceFile);
  const selectedType = queries.types.expressionType(node);
  if (selectedType === undefined) return false;
  const selectedMembers = queries.types.isUnion(selectedType)
    ? queries.types.unionOrIntersectionTypes(selectedType) : [selectedType];
  const admitsAbsence = selectedMembers.some(type => queries.types.isNullish(type));
  let present = false;
  for (const origin of origins.origins) {
    if (host.semantics(origin.sourceFile).types.isNullish(origin.type)) {
      if (admitsAbsence) return false;
      continue;
    }
    if (origin.subject.kind !== "value") return false;
    let carrier = host.types.resolveNode(origin.subject.node, origin.sourceFile);
    for (const component of origin.subject.projection) {
      carrier = component.kind === "array-element"
        ? carrier?.kind === "array" || carrier?.kind === "slice" ? carrier.element
          : rustFixedArrayCarrierValue(carrier)?.element ?? rustJsArrayLikeElementTargetType(carrier)
        : carrier?.kind === "tuple" ? carrier.elements[component.index] : undefined;
    }
    if (carrier === undefined || !rustTargetTypeRefEquals(carrier, expected)) return false;
    present = true;
  }
  return present && storage.failureReason() === undefined;
}

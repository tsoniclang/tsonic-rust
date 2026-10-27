import type { Node, SourceFile } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageProducer, SourceStorageQueries, SourceStorageProjection } from "@tsonic/target-api/analysis";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustJsArrayLikeElementTargetType } from "../../target-model/types/carriers/js.js";
import { rustFixedArrayCarrierValue } from "../../target-model/types/carriers/native.js";
import type { RustTargetTypeResolutionOptions } from "../source-evidence/types/resolution/model.js";

export interface RustValueDomainCarrierHost {
  readonly sourceStorage?: SourceStorageQueries;
  readonly sourceTypes: Pick<RustTargetTypeResolutionOptions["sourceTypes"], "structuralFieldProjectionForDeclaration">;
  readonly projectFieldProjection: RustTargetTypeResolutionOptions["projectFieldProjection"];
  readonly projectIndexedCarrier: (component: Extract<SourceStorageProjection, { readonly kind: "indexed-value" }>,
    owner: TargetTypeRef, node: Node) => TargetTypeRef | undefined;
  readonly types: {
    resolveNode(node: Node, sourceFile: SourceFile): TargetTypeRef | undefined;
  };
  semantics(sourceFile: SourceFile): SourceFileSemantics;
}

export function rustValueDomainHasTargetType(
  host: RustValueDomainCarrierHost,
  node: Node,
  expected: TargetTypeRef,
  bindings: SourceStorageBindings,
): boolean {
  const storage = host.sourceStorage;
  if (storage === undefined || bindings === undefined || storage.failureReason() !== undefined) return false;
  const selected = storage.subjectFor(node);
  if (selected.kind !== "resolved") return false;
  const origins = storage.storageProducersFor(selected.subject, bindings);
  if (origins.kind !== "complete" || origins.producers.length === 0) return false;
  const sourceFile = storage.source.ast.getSourceFile(node);
  if (sourceFile === undefined || !storage.source.semantics.includes(sourceFile)) return false;
  const queries = host.semantics(sourceFile);
  const selectedType = queries.types.expressionType(node);
  if (selectedType === undefined) return false;
  const selectedMembers = queries.types.isUnion(selectedType)
    ? queries.types.unionOrIntersectionTypes(selectedType) : [selectedType];
  const admitsAbsence = selectedMembers.some(type => queries.types.isNullish(type));
  let present = false;
  for (const origin of origins.producers) {
    if (host.semantics(origin.sourceFile).types.isNullish(origin.type)) {
      if (admitsAbsence) return false;
      continue;
    }
    if (origin.subject.kind !== "value") return false;
    const carrier = rustSourceStorageProjectedCarrier(host, origin,
      host.types.resolveNode(origin.subject.node, origin.sourceFile));
    if (carrier === undefined || !rustTargetTypeRefEquals(carrier, expected)) return false;
    present = true;
  }
  return present && storage.failureReason() === undefined;
}

export function rustSourceStorageProjectedCarrier(
  host: RustValueDomainCarrierHost,
  source: Pick<SourceStorageProducer, "subject" | "bindings">,
  root: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const storage = host.sourceStorage;
  if (storage === undefined || source.subject === undefined || source.bindings === undefined ||
    storage.failureReason() !== undefined) return undefined;
  const { subject } = source;
  let carrier = root;
  for (const [index, component] of subject.projection.entries()) {
    carrier = component.kind === "array-element"
      ? carrier?.kind === "array" || carrier?.kind === "slice" ? carrier.element
        : rustFixedArrayCarrierValue(carrier)?.element ?? rustJsArrayLikeElementTargetType(carrier)
      : component.kind === "tuple-element"
        ? carrier?.kind === "tuple" ? carrier.elements[component.index] : undefined
        : component.kind === "indexed-value" ? carrier === undefined ? undefined : host.projectIndexedCarrier(component, carrier, subject.node)
        : carrier === undefined ? undefined
          : projectedMemberCarrier(host, storage, source, index, component.declaration, carrier);
  }
  return carrier;
}

function projectedMemberCarrier(
  host: RustValueDomainCarrierHost,
  storage: SourceStorageQueries,
  source: Pick<SourceStorageProducer, "subject" | "bindings">,
  index: number,
  declaration: Node,
  owner: TargetTypeRef,
): TargetTypeRef | undefined {
  const structural = host.sourceTypes.structuralFieldProjectionForDeclaration(declaration, owner);
  if (structural !== undefined) return structural.field.method === true || structural.field.accessor !== undefined
    ? undefined : structural.field.resultCarrier;
  const { subject } = source;
  const prefix = storage.subject(subject.node, subject.kind, subject.projection.slice(0, index));
  if (prefix.kind !== "resolved") return undefined;
  const selected = storage.typeFor(prefix.subject);
  if (selected.kind !== "resolved") return undefined;
  const queries = host.semantics(selected.sourceFile);
  const ownerType = queries.types.nonNullableType(selected.type);
  if (ownerType === undefined) return undefined;
  const correspondence = queries.types.structuralMembers(ownerType, ownerType, "read");
  if (correspondence.kind !== "available") return undefined;
  const members = correspondence.members.filter(member => member.kind === "present" &&
    member.source.read === "property" && member.source.declarations.includes(declaration));
  const member = members.length === 1 && members[0]?.kind === "present" ? members[0].source : undefined;
  if (member === undefined) return undefined;
  return host.projectFieldProjection(member.property, owner, ownerType,
    { kind: "resolved", subject: prefix.subject, bindings: source.bindings })?.output;
}

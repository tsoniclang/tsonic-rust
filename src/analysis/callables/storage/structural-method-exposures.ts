import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { Node } from "@tsonic/tsts";
import type { SourceStorageDomainBoundary, SourceStorageQueries } from "@tsonic/target-api/analysis";
import { Node_Expression, sourceEnclosingCallable, type TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustStructuralGenericCarrier } from "../../../policy/types/objects/structural-generics.js";
import type { RustStructuralMethodExposure } from "../../../target-model/records/objects/structural-shapes.js";
import type { RustSourceObjectShape } from "../../../target-model/records/types/source-types.js";
import { structuralStorageKey } from "../../../policy/types/objects/structural-storage.js";
import { selectRustStructuralMethodExposure } from "../../../policy/types/objects/structural-emission.js";

function structuralBoundariesAreExportOnly(source: TargetSourceProgram,
  boundaries: readonly Pick<SourceStorageDomainBoundary, "kind" | "exposure">[] | undefined): boolean {
  const { ast } = source;
  return boundaries !== undefined && boundaries.length !== 0 && boundaries.every(boundary => boundary.kind === "external-write" &&
    (ast.is.IsVariableDeclaration(boundary.exposure) || ast.is.IsFunctionDeclaration(boundary.exposure) ||
      ast.is.IsClassDeclaration(boundary.exposure)) && source.navigation.declarationUseSummary(boundary.exposure).exported);
}

export function analyzeRustStructuralMethodExposures(input: {
  readonly source: TargetSourceProgram;
  readonly sourceStorage: SourceStorageQueries;
  readonly records: RustProgramRecords;
  readonly nativeNodes: readonly Node[];
  readonly shapes: readonly RustSourceObjectShape[];
  readonly componentForFile: (fileName: string) => string;
}): ReadonlyMap<string, RustStructuralMethodExposure> {
  const { ast } = input.source;
  const candidates = new Map<string, { readonly slots: Set<string>; readonly declarations: Set<Node>; writes: "none" | "present" | "unresolved";
    boundary: "none" | "export-only" | "opaque"; extracted: boolean; presence: "required" | "optional" }>();
  const keyFor = (carrier: TargetTypeRef, index: number): string =>
    `${structuralStorageKey(rustStructuralGenericCarrier(carrier, "fields").carrier, input.componentForFile)}#${index}`;
  const connect = (source: string, target: string): void => {
    const left = candidates.get(source);
    const right = candidates.get(target);
    if (left === undefined || right === undefined || left === right) return;
    const owner = left.slots.size >= right.slots.size ? left : right;
    const incoming = owner === left ? right : left;
    for (const slot of incoming.slots) {
      owner.slots.add(slot);
      candidates.set(slot, owner);
    }
    for (const declaration of incoming.declarations) owner.declarations.add(declaration);
    if (incoming.writes === "unresolved" || owner.writes === "none") owner.writes = incoming.writes;
    if (incoming.boundary === "opaque" || owner.boundary === "none") owner.boundary = incoming.boundary;
    owner.extracted ||= incoming.extracted;
    if (incoming.presence === "optional") owner.presence = "optional";
  };
  const retain = (carrier: TargetTypeRef, index: number, declaration: Node): void => {
    const key = keyFor(carrier, index);
    const selected = candidates.get(key);
    if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "A structural implementation requires its actual checked field domain.", declaration);
    candidates.set(key, selected);
    if (ast.body(declaration) === undefined || selected.declarations.has(declaration)) return;
    selected.declarations.add(declaration);
    const subject = input.sourceStorage.memberSubjectFor(declaration);
    const writes = subject.kind === "resolved" ? input.sourceStorage.memberWritesFor(subject.subject) : subject;
    if (writes.kind === "unresolved") selected.writes = "unresolved";
    else {
      if (writes.writes.length !== 0 && selected.writes !== "unresolved") selected.writes = "present";
      if (writes.kind === "open") {
        const exported = structuralBoundariesAreExportOnly(input.source, writes.boundaries);
        if (!exported) selected.boundary = "opaque";
        else if (selected.boundary === "none") selected.boundary = "export-only";
      }
    }
  };
  for (const shape of input.shapes) for (const field of shape.fields) {
    if (field.method !== true) continue;
    const key = keyFor(shape.carrier, field.storageIndex);
    if (!candidates.has(key)) candidates.set(key, { slots: new Set([key]), declarations: new Set(), writes: "none", boundary: "none", extracted: false, presence: field.presence });
    for (const declaration of field.declarations) retain(shape.carrier, field.storageIndex, declaration);
  }
  for (const node of input.nativeNodes) {
    const operation = input.records.targetOperation.get(node);
    if (operation?.kind === "record-literal" && operation.storage === "structural-object") {
      for (const contribution of operation.contributions) if (contribution.kind === "structural-method")
        retain(operation.resultCarrier, contribution.targetStorageIndex, contribution.property);
      else if (contribution.kind === "spread") for (const field of contribution.fields) {
        if (field.method !== true) continue;
        connect(keyFor(contribution.sourceValueCarrier, field.sourceStorageIndex), keyFor(operation.resultCarrier, field.targetStorageIndex));
        for (const [carrier, index] of [[contribution.sourceValueCarrier, field.sourceStorageIndex],
          [operation.resultCarrier, field.targetStorageIndex]] as const) {
          const selected = candidates.get(keyFor(carrier, index));
          if (selected !== undefined) selected.extracted = true;
        }
      }
    }
    const projection = input.records.bindingProjection.get(node);
    if (projection?.projection.kind === "object-rest" && "bindingCarrier" in projection)
      for (const field of projection.projection.fields) for (const [carrier, index] of [
        [projection.sourceCarrier, field.sourceStorageIndex], [projection.bindingCarrier, field.targetStorageIndex],
      ] as const) {
        const selected = candidates.get(keyFor(carrier, index));
        if (selected !== undefined) selected.extracted = true;
      }
    const view = input.records.objectReferenceView.get(node);
    if (view?.kind === "structural") for (const field of view.fields) {
      if (field.source.valueSemantics.kind !== "method") continue;
      if (field.source.storage === "structural-object")
        connect(keyFor(field.source.receiverCarrier, field.source.storageIndex), keyFor(view.targetCarrier, field.destinationIndex));
    }
    const method = operation?.kind === "source-call" && operation.target.form === "structural-method"
      ? { carrier: operation.target.receiverCarrier, index: operation.target.storageIndex, expression: Node_Expression(ast, node) }
      : operation?.kind === "source-field" && operation.storage === "structural-object" && operation.valueSemantics.kind === "method"
        ? { carrier: operation.receiverCarrier, index: operation.storageIndex, expression: node } : undefined;
    if (method?.expression !== undefined) {
      const candidate = candidates.get(keyFor(method.carrier, method.index));
      const subject = input.sourceStorage.subjectFor(method.expression);
      const bindings = input.sourceStorage.bindingsForLexicalOwner(method.expression);
      const producers = subject.kind === "unresolved" ? subject : bindings.kind === "unresolved" ? bindings
        : input.sourceStorage.storageProducersFor(subject.subject, bindings.bindings);
      if (candidate !== undefined) {
        if (producers.kind === "unresolved" || producers.kind === "open" &&
          !structuralBoundariesAreExportOnly(input.source, producers.boundaries)) candidate.boundary = "opaque";
        else {
          if (producers.kind === "open" && candidate.boundary === "none") candidate.boundary = "export-only";
          for (const producer of producers.producers) {
            if (producer.subject.kind === "input") {
              const owner = sourceEnclosingCallable(producer.subject.node, ast);
              const summary = owner === undefined ? undefined : input.source.navigation.declarationUseSummary(owner);
              if (summary === undefined || summary.exported || summary.firstClassUseCount !== 0 || summary.hasUnclassifiedValueUse)
                candidate.boundary = "opaque";
              continue;
            }
            if (producer.subject.kind !== "value" || producer.subject.projection.length !== 0 ||
              !ast.is.IsMethodDeclaration(producer.subject.node) || ast.body(producer.subject.node) === undefined) candidate.boundary = "opaque";
            else retain(method.carrier, method.index, producer.subject.node);
          }
        }
      }
    }
    if (operation?.kind !== "source-field" || operation.storage !== "structural-object" || operation.valueSemantics.kind !== "method") continue;
    const use = input.source.navigation.expressionValueFlow(node);
    const selected = candidates.get(keyFor(operation.receiverCarrier, operation.storageIndex));
    if (selected !== undefined && (use.escapes ||
      use.uses.some(current => current.role !== "call-target" && current.role !== "type-only"))) selected.extracted = true;
  }
  return new Map([...candidates].map(([key, value]) => {
    const selected = selectRustStructuralMethodExposure({ writes: value.writes, boundary: value.boundary,
      extracted: value.extracted, implementations: value.declarations.size, presence: value.presence });
    const exposure: RustStructuralMethodExposure = selected === "fixed"
      ? Object.freeze({ kind: "fixed", declaration: [...value.declarations][0]! }) : Object.freeze({ kind: "stored" });
    return [key, exposure];
  }));
}

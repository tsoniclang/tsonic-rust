import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustProjectTypeDefinition, RustProjectTypePolicy } from "../project-types/index.js";
import type { RustProjectStructuralView } from "../../target-model/records/objects/project-structural-views.js";
import type { RustReceiverFieldCapture } from "../../target-model/records/callables/receiver-captures.js";
import type { RustReceiverFieldCaptureQueries } from "../project-types/receiver-captures.js";

import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { RustStructuralShapePlan } from "./shapes/structural-shape-plan.js";
import type { RustStructuralShapeDefinition } from "../../target-model/records/objects/structural-shapes.js";
import { inferRustTargetTypeParameterBindings } from "../../target-model/types/carriers/generic-inference.js";
import { rustTargetTypeParameterIdentities } from "../../target-model/types/carriers/generic-references.js";

import type { RustFrozenReceiverCapturePlan } from "../../target-model/records/storage/frozen-data.js";
import { createRustFrozenReceiverCaptureRecords } from "../program/records/storage/frozen-data.js";

export function analyzeRustFrozenReceiverCaptures(input: {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly isNativeNode: (node: Node) => boolean;
  readonly records: RustProgramRecords;
  readonly projectTypes: RustProjectTypePolicy;
  readonly views: readonly RustProjectStructuralView[];
  readonly captures: RustReceiverFieldCaptureQueries;
  readonly structuralShapes: Pick<RustStructuralShapePlan, "sharesStorage"> & {
    readonly definitions: readonly Pick<RustStructuralShapeDefinition, "sourceCarriers">[];
  };
  readonly typeDefinitions: RustTypeDefinitions;
}): RustFrozenReceiverCapturePlan {
  const frozen = new Set<RustProjectTypeDefinition>();
  const carriers = new Map<string, TargetTypeRef>();
  const origins = new Map<string, { readonly carrier: TargetTypeRef; readonly sources: Map<string, TargetTypeRef> }>();
  const writes: RustReceiverFieldCapture[] = [];
  const pending: Node[] = [];
  const sourceNodes: Node[] = [];
  let visited = 0;
  const reserve = (): void => {
    if (++visited > 4_194_304) throw new Error("Frozen receiver capture analysis exceeds its finite work budget.");
  };
  const enqueue = (node: Node): void => {
    reserve();
    pending.push(node);
  };
  const demand = (carrier: TargetTypeRef): void => {
    reserve();
    carriers.set(closedMetadataKey(carrier), carrier);
  };
  const recordOrigin = (source: TargetTypeRef, target: TargetTypeRef): void => {
    reserve();
    const identity = closedMetadataKey(target);
    const selected = origins.get(identity) ?? { carrier: target, sources: new Map<string, TargetTypeRef>() };
    selected.sources.set(closedMetadataKey(source), source);
    origins.set(identity, selected);
  };
  for (const view of input.views) recordOrigin(view.sourceCarrier, view.targetCarrier);
  for (const sourceFile of input.sourceFiles) enqueue(sourceFile);
  while (pending.length !== 0) {
    const node = pending.pop()!;
    if (!input.isNativeNode(node)) continue;
    sourceNodes.push(node);
    const operation = input.records.targetOperation.get(node);
    if (operation?.kind === "provider-operation" && operation.abi.target.form === "call" &&
      operation.abi.target.path === "tsonic_rust_runtime::freeze_object") {
      let carrier: TargetTypeRef | undefined;
      for (const argument of operation.abi.sourceArguments) {
        reserve();
        if (argument.role !== "parameter" || argument.disposition !== "runtime") continue;
        if (carrier !== undefined || argument.form !== "value" || argument.carrier === undefined)
          throw new Error("Frozen receiver capture analysis requires the exact finalized freeze input.");
        carrier = argument.carrier;
      }
      if (carrier === undefined)
        throw new Error("Frozen receiver capture analysis requires the exact finalized freeze input.");
      demand(carrier);
    }
    const view = input.records.objectReferenceView.get(node);
    if (view?.kind === "structural") recordOrigin(view.sourceCarrier, view.targetCarrier);
    if (input.ast.is.IsArrowFunction(node)) for (const capture of input.captures.capturesFor(node)) {
      reserve();
      if (input.captures.storageReadonly(capture.declaration)) continue;
      const name = input.ast.name(capture.declaration);
      if (name !== undefined && input.ast.kindName(name) === "KindPrivateIdentifier") continue;
      let writesStorage = false;
      for (const reference of capture.references) {
        reserve();
        const selected = input.records.targetOperation.get(reference);
        if (selected?.kind === "source-field" && selected.storage === "project-object" &&
          selected.valueSemantics.kind === "stored" && (selected.accessMode === "write" || selected.accessMode === "read-write") &&
          selected.declaration !== undefined && input.captures.storageDeclaration(selected.declaration) ===
            input.captures.storageDeclaration(capture.declaration)) writesStorage = true;
      }
      if (writesStorage) writes.push(capture);
    }
    input.ast.forEachChild(node, child => { if (child !== undefined) enqueue(child); });
  }
  const queued = [...carriers.values()];
  for (let index = 0; index < queued.length; index += 1) {
    const carrier = queued[index]!;
    reserve();
    const carrierIdentity = closedMetadataKey(carrier);
    const sources = new Map<string, TargetTypeRef>();
    for (const [identity, origin] of origins) {
      reserve();
      if (identity === carrierIdentity ||
        input.structuralShapes.sharesStorage(origin.carrier, carrier)) {
        for (const [identity, source] of origin.sources) { reserve(); sources.set(identity, source); }
      }
    }
    const parameters = new Set(rustTargetTypeParameterIdentities(carrier));
    if (parameters.size !== 0) for (const shape of input.structuralShapes.definitions) {
      reserve();
      if (!shape.sourceCarriers.some(source => { reserve(); return closedMetadataKey(source) === carrierIdentity; })) continue;
      for (const source of shape.sourceCarriers) {
        reserve();
        if (inferRustTargetTypeParameterBindings(carrier, source, parameters) !== undefined)
          sources.set(closedMetadataKey(source), source);
      }
    }
    for (const variant of input.typeDefinitions.sourceUnionVariants(carrier) ?? []) {
      reserve();
      sources.set(closedMetadataKey(variant.carrier), variant.carrier);
    }
    for (const [identity, source] of sources) {
      reserve();
      if (carriers.has(identity)) continue;
      carriers.set(identity, source);
      queued.push(source);
    }
    const selected = input.projectTypes.definitionForCarrier(carrier);
    if (selected === undefined) continue;
    for (const definition of input.projectTypes.definitions) {
      reserve();
      const ownCarrier = input.projectTypes.openCarrier(definition);
      if (input.projectTypes.relationship(ownCarrier, selected).kind === "related") frozen.add(definition);
    }
  }
  const frozenOwners = new Set<RustProjectTypeDefinition>();
  for (const definition of frozen) {
    reserve();
    for (const owner of input.projectTypes.classLineage(definition) ?? []) { reserve(); frozenOwners.add(owner); }
  }
  const fields = new Map<Node, Set<Node>>();
  for (const capture of writes) {
    reserve();
    const owner = input.projectTypes.definitionContainingDeclaration(capture.declaration);
    if (owner === undefined || !frozenOwners.has(owner)) continue;
    const declaration = input.captures.storageDeclaration(capture.declaration);
    const references = fields.get(declaration) ?? new Set<Node>();
    for (const reference of capture.references) { reserve(); references.add(reference); }
    fields.set(declaration, references);
  }
  const entries: (readonly [Node, ReadonlySet<Node>])[] = [];
  for (const node of sourceNodes) {
    const references = fields.get(input.captures.storageDeclaration(node));
    if (references !== undefined) entries.push([node, references]);
  }
  for (const [declaration, references] of fields) entries.push([declaration, references]);
  return createRustFrozenReceiverCaptureRecords(entries);
}

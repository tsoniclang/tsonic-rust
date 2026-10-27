import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustCarrierReadProducer } from "../program/records/storage/carrier-reads.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustLocationTargetType, rustOptionTargetType, rustStructuralPropertyValueCarrier } from "../../target-model/types/index.js";
import { isRustCopyCarrier, rustCarrierSupportsClone } from "../../policy/constraints/native-traits.js";
import { rustStructuralPropertyGetterStorageCarrier, rustStructuralPropertySetterStorageCarrier } from "../../policy/types/objects/member-storage.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustTargetOperationResultCarrier } from "../../target-model/records/operations/operation-result-carriers.js";

export function analyzeRustCarrierReads(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[], producer: RustCarrierReadProducer): void {
  const pending: TargetTypeRef[] = [];
  for (const context of program.physicalEmissionContexts.contexts) pending.push(...context.operands,
    ...(context.returnDestination.kind === "value" ? [context.returnDestination.carrier] : []));
  for (const operand of program.physicalEmissionContexts.operands) pending.push(operand.carrier,
    ...(operand.destination === undefined ? [] : [operand.destination]));
  for (const node of nodes) {
    const carrier = program.records.runtimeCarrier.get(node)?.carrier;
    if (carrier !== undefined) pending.push(carrier);
    // A flow-read projection copies or clones its selected payload, so the planner reads that carrier's guarantees.
    const flow = program.records.flowReadProjection.get(node);
    if (flow !== undefined) pending.push(flow.selectedCarrier);
    const operation = program.records.targetOperation.get(node);
    if (operation !== undefined) {
      const result = rustTargetOperationResultCarrier(operation);
      if (result !== undefined) pending.push(result);
      if (operation.kind === "source-call" && operation.resultProjection !== undefined) pending.push(operation.resultProjection.selectedCarrier);
      if (operation.kind === "source-field") pending.push(operation.receiverCarrier);
      if (operation.kind === "source-accessor" && operation.receiver.kind === "instance") {
        const receiver = Node_Expression(program.source.ast, node);
        const carrier = receiver === undefined ? undefined : rustEffectiveValueCarrier(program.records, receiver);
        if (carrier !== undefined) pending.push(carrier);
      }
    }
    const captures = program.records.closureCapture.get(node);
    if (captures !== undefined) pending.push(...captures.captures.map(capture => capture.carrier), ...captures.receiverFields.map(capture => capture.carrier),
      ...captures.receivers.map(capture => capture.carrier));
  }
  for (const definition of program.projectTypes.definitions) {
    pending.push(program.projectTypes.openCarrier(definition));
    for (const field of program.projectTypes.objectLayoutForDefinition(definition)?.fields ?? []) {
      const stored = program.callableValues.projectFieldStorage.get(field.declaration);
      if (stored !== undefined) pending.push(stored);
    }
  }
  for (const selected of program.classValues.instanceViewImplementations)
    for (const view of program.records.structuralViewImplementations.get(selected.declaration, selected.ownerFileName) ?? [])
      for (const member of view.fields) if (member.readAdapter !== undefined)
        pending.push(member.readAdapter.sourceCarrier, member.readAdapter.targetCarrier);
  for (const shape of program.structuralShapes.instances) {
    pending.push(shape.carrier, ...shape.fields.map(field => field.carrier));
    for (const field of shape.fields) if (field.nativeLayout !== undefined) pending.push(rustLocationTargetType(field.carrier));
    for (const field of shape.fields) {
      if (field.methodPlan?.carrier !== undefined) pending.push(field.methodPlan?.carrier);
      if (field.property === undefined) continue;
      const value = rustStructuralPropertyValueCarrier(field.carrier, field.presence);
      const getter = rustStructuralPropertyGetterStorageCarrier(shape.carrier, field.carrier, field.presence);
      const setter = rustStructuralPropertySetterStorageCarrier(shape.carrier, field.carrier, field.presence);
      if (value !== undefined) pending.push(value, rustOptionTargetType(value));
      if (getter !== undefined) pending.push(getter);
      if (setter !== undefined) pending.push(setter);
    }
  }
  for (const definition of program.callableValues.generic.definitions) {
    pending.push(...definition.signature.parameters, definition.signature.result);
    for (const implementation of definition.implementations) pending.push(implementation.carrier,
      ...implementation.captures.flatMap(capture => [capture.carrier, capture.storageCarrier]),
      ...implementation.receiverFields.flatMap(capture => [capture.carrier, capture.storageCarrier]),
      ...implementation.receivers.flatMap(capture => [capture.carrier, capture.storageCarrier]));
  }
  const seen = new Set<string>();
  for (let index = 0; index < pending.length; index++) {
    const carrier = pending[index]!;
    const key = closedMetadataKey(carrier);
    if (seen.has(key)) continue;
    seen.add(key);
    producer.carrier(carrier, { copy: isRustCopyCarrier(carrier, selected => program.callableValues.generic.definitionFor(selected)?.copy === true),
      clone: rustCarrierSupportsClone(carrier, program.typeDefinitions) });
    pending.push(...rustTargetTypeChildren(carrier));
    // A project instance stores its fields at their instantiated carriers.
    const definition = program.projectTypes.definitionForCarrier(carrier);
    if (definition !== undefined) pending.push(...(program.records.projectClassFields.get(definition, carrier) ?? []).map(field => field.carrier));
  }
}

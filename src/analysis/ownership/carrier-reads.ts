import type { Node } from "@tsonic/tsts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustCarrierReadProducer } from "../program/records/carrier-reads.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { isRustCopyCarrier, rustLocationTargetType, rustOptionTargetType, rustStructuralPropertyValueCarrier,
  rustStructuralPropertyGetterStorageCarrier, rustStructuralPropertySetterStorageCarrier } from "../../target-model/types/index.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustTargetOperationResultCarrier } from "../../target-model/records/operations.js";

export function analyzeRustCarrierReads(program: Omit<RustTargetProgram, "reachability">, nodes: readonly Node[], producer: RustCarrierReadProducer): void {
  const pending: TargetTypeRef[] = [];
  for (const node of nodes) {
    const carrier = program.records.runtimeCarrier.get(node)?.carrier;
    if (carrier !== undefined) pending.push(carrier);
    const operation = program.records.targetOperation.get(node);
    if (operation !== undefined) {
      const result = rustTargetOperationResultCarrier(operation);
      if (result !== undefined) pending.push(result);
      if (operation.kind === "source-field" || operation.kind === "source-accessor") pending.push(operation.receiverCarrier);
    }
    const captures = program.records.closureCapture.get(node);
    if (captures !== undefined) pending.push(...captures.captures.map(capture => capture.carrier), ...captures.receiverFields.map(capture => capture.carrier),
      ...captures.receivers.map(capture => capture.carrier));
  }
  for (const definition of program.projectTypes.definitions) pending.push(program.projectTypes.openCarrier(definition));
  for (const shape of program.structuralShapes.instances) {
    pending.push(shape.carrier, ...shape.fields.map(field => field.carrier));
    for (const field of shape.fields) if (field.nativeLayout !== undefined) pending.push(rustLocationTargetType(field.carrier));
    for (const field of shape.fields) {
      if (field.methodStorageCarrier !== undefined) pending.push(field.methodStorageCarrier);
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
    producer.carrier(carrier, { copy: isRustCopyCarrier(carrier, selected => program.callableValues.generic.definitionFor(selected)?.copy === true) });
    pending.push(...rustTargetTypeChildren(carrier));
  }
}

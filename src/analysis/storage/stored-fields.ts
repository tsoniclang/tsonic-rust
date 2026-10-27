import type { Node } from "@tsonic/tsts";
import { Node_Expression, sourceTransparentExpressionOperand } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustStoredFieldProducer } from "../program/records/storage/stored-fields.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustCallableProtocol, rustLocationTargetType, rustOptionElementCarrier, rustOptionTargetType, rustStructuralObjectCarrierValue, rustStructuralPropertyValueCarrier, rustStructuralMethodCallableCarrier } from "../../target-model/types/index.js";
import { rustStructuralPropertyGetterStorageCarrier, rustStructuralPropertySetterStorageCarrier } from "../../policy/types/objects/member-storage.js";
import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustValueFieldProjectionStep } from "../../target-model/records/storage/stored-fields.js";

export function analyzeRustStoredFields(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[], producer: RustStoredFieldProducer): void {
  const pending = [...program.structuralShapes.instances.map(shape => shape.carrier),
    ...program.projectTypes.definitions.map(definition => program.projectTypes.openCarrier(definition)),
    ...program.classValues.instanceViewImplementations.flatMap(view => [view.sourceCarrier, view.targetCarrier]),
    ...program.classValues.constructorViewImplementations.flatMap(view => [view.sourceCarrier, view.targetCarrier])];
  const requests: { readonly receiver: TargetTypeRef; readonly index: number; readonly arguments: readonly TargetTypeRef[] }[] = [];
  const invocations = new Set<string>();
  const method = (carrier: TargetTypeRef, index: number, arguments_: readonly TargetTypeRef[]): void => {
    const key = closedMetadataKey([carrier, index, arguments_]);
    if (invocations.has(key)) return;
    invocations.add(key);
    const shape = program.structuralShapes.definitionForCarrier(carrier);
    const field = program.structuralShapes.field(carrier, index);
    if (field?.method !== true) return;
    const callableCarrier = rustStructuralMethodCallableCarrier(field.carrier, field.presence);
    const generic = rustGenericCallableValue(callableCarrier);
    const protocol = generic === undefined ? rustCallableProtocol(callableCarrier) : rustGenericCallableProtocol(callableCarrier, arguments_);
    const rawStorage = field.presence === "optional" ? rustOptionElementCarrier(field.methodPlan?.carrier) : field.methodPlan?.carrier;
    if (protocol === undefined || rawStorage === undefined) {
      if (generic !== undefined && arguments_.length === 0) return;
      failTargetAnalysisInvariant("tsonic-rust", "An admitted structural invocation requires its exact native callable and storage.");
    }
    if (field.methodPlan === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted structural method requires its selected native representation.");
    producer.invocation(carrier, index, arguments_, { result: protocol.result, parameterCount: protocol.parameters.length,
      rawStorage, ...(field.methodPlan.kind === "fixed" ? { kind: "fixed", owner: shape!.carrier, factoryReceiver: field.methodPlan.factoryReceiver }
        : field.methodPlan.kind === "native-dispatch" ? { kind: "native-dispatch", cloneDispatch: shape!.construction === undefined }
          : { kind: "stored", generic: generic !== undefined, receiver: field.methodPlan.receiver }) });
  };
  for (const node of new Set(nodes)) {
    const runtime = program.records.runtimeCarrier.get(node)?.carrier;
    if (runtime !== undefined) pending.push(runtime);
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "source-field" || operation?.kind === "source-indexed-field") {
      if (operation.kind === "source-field") {
        const selected = program.records.selectedOperation.get(node);
        const optional = program.records.optionalChain.get(node);
        if (optional !== undefined && !rustTargetTypeRefEquals(optional.innerResultCarrier, operation.resultCarrier) ||
          selected?.operationId !== operation.operationId || selected.operationKind !== "property" ||
          !rustTargetTypeRefEquals(selected.resultType, optional?.resultCarrier ?? operation.resultCarrier))
          failTargetAnalysisInvariant("tsonic-rust", "A source field requires its exact selected native operation and optional result correspondence.", node);
        producer.admit(node, operation);
      }
      pending.push(operation.receiverCarrier);
      const declaration = operation.kind === "source-field" ? operation.declaration : undefined;
      const captured = declaration !== undefined && (program.callableValues.frames.bindingFor(declaration) !== undefined || program.records.capturedFieldStorage.get(declaration) !== undefined);
      const structural = operation.kind === "source-field" && operation.storage === "structural-object";
      const structuralField = structural ? program.structuralShapes.field(operation.receiverCarrier, operation.storageIndex) : undefined;
      const representation = structural ? undefined : program.objectRepresentations.representationFor(program.projectTypes.definitionForCarrier(operation.receiverCarrier));
      const receiver = Node_Expression(program.source.ast, node);
      const reference = receiver === undefined ? undefined : program.sourceNavigation.sourceReferenceFor(receiver)?.declaration;
      const stable = receiver !== undefined && (program.source.ast.kindName(receiver) === "KindThisExpression" || program.source.ast.kindName(receiver) === "KindThisKeyword" ||
        program.source.ast.is.IsIdentifier(receiver) && reference !== undefined && !program.sourceNavigation.declarationUseSummary(reference).bindingWritten);
      producer.receiver(node, captured || operation.kind === "source-indexed-field" ||
        (structural ? rustStructuralObjectCarrierValue(operation.receiverCarrier)?.representation === "value" : representation?.kind === "value"), stable);
      if (operation.kind === "source-field") producer.reference(node, structural
        ? rustStructuralObjectCarrierValue(operation.receiverCarrier)?.representation === "reference" && structuralField !== undefined &&
          structuralField.storage !== "bound" && structuralField.nativeLayout === undefined
        : representation !== undefined && representation.kind !== "value");
    }
    if (operation?.kind === "source-union-field") pending.push(...operation.variants.map(variant => variant.carrier));
    if (operation?.kind === "source-call" && operation.target.form === "structural-method") {
      pending.push(operation.target.receiverCarrier);
      requests.push({ receiver: operation.target.receiverCarrier, index: operation.target.storageIndex,
        arguments: operation.targetGenericArguments?.flatMap(argument => argument.kind === "type" ? [argument.type] : []) ?? [] });
    }
  }
  const seen = new Set<string>();
  for (let index = 0; index < pending.length; index++) {
    const carrier = pending[index]!;
    const key = closedMetadataKey(carrier);
    if (seen.has(key)) continue;
    seen.add(key);
    pending.push(...rustTargetTypeChildren(carrier));
    const shape = program.structuralShapes.definitionForCarrier(carrier);
    if (shape !== undefined) {
      const value = rustStructuralObjectCarrierValue(carrier)?.representation === "value";
      const sourceFields = rustStructuralObjectCarrierValue(carrier)?.fields;
      if (sourceFields === undefined) failTargetAnalysisInvariant("tsonic-rust", "A structural field inventory requires its checked source field domain.");
      const fields = sourceFields.map((sourceField, index) => {
        const field = program.structuralShapes.field(carrier, index);
        if (field === undefined || field.sourceName !== sourceField.sourceName)
          failTargetAnalysisInvariant("tsonic-rust", "A structural field requires its exact checked-to-physical member correspondence.");
        const propertyValue = field.property === undefined ? undefined : rustStructuralPropertyValueCarrier(field.carrier, field.presence);
        const getter = field.property === undefined ? undefined : rustStructuralPropertyGetterStorageCarrier(carrier, field.carrier, field.presence);
        const setter = field.property === undefined || field.readonly ? undefined : rustStructuralPropertySetterStorageCarrier(carrier, field.carrier, field.presence);
        if (field.property !== undefined && (propertyValue === undefined || getter === undefined))
          failTargetAnalysisInvariant("tsonic-rust", "An admitted structural property requires its exact native storage carriers.");
        return Object.freeze({ field, value, dispatch: shape.dispatchName !== undefined,
          borrowedRead: shape.dispatchName === undefined && field.storage === "stored" && field.method !== true && field.nativeLayout === undefined,
          location: field.nativeLayout === undefined ? undefined : rustLocationTargetType(field.carrier),
          property: propertyValue === undefined || getter === undefined ? undefined : Object.freeze({ value: propertyValue, stored: rustOptionTargetType(propertyValue), getter, setter }) });
      });
      producer.structural(carrier, fields, value);
      for (const [fieldIndex, field] of fields.entries()) {
        producer.field("structural-object", carrier, fieldIndex, { check: program.frozenDataWrites.receiverFor("structural-object", carrier, fieldIndex),
          declaration: undefined, path: field.field.storage === "stored" ? [field.field.targetName] : undefined,
          dispatch: undefined, borrowedRead: field.borrowedRead });
        pending.push(field.field.carrier);
        if (field.field.method === true) method(carrier, fieldIndex, []);
      }
    }
    const definition = program.projectTypes.definitionForCarrier(carrier);
    if (definition === undefined) continue;
    const polymorphic = program.projectTypes.isPolymorphic(definition);
    const external = program.projectTypes.externalBaseForDefinition(definition)?.fields ?? [];
    const layout = program.projectTypes.objectLayoutForDefinition(definition);
    for (const field of [...external.map(field => ({ index: field.storageIndex, declaration: field.declaration, external: true })),
      ...(layout?.fields.map(field => ({ index: external.length + field.storageIndex, declaration: field.declaration, external: false })) ?? [])]) {
      const name = polymorphic ? undefined : program.projectTypes.fieldStorageName(definition, field.declaration);
      const plan = !polymorphic || field.external ? undefined : program.projectFieldDispatch.planFor(field.declaration);
      const read = plan === undefined ? undefined : program.projectTypes.memberSlotName(field.declaration, "read");
      const write = plan === undefined ? undefined : program.projectTypes.memberSlotName(field.declaration, "write");
      producer.field("project-object", carrier, field.index, { declaration: field.external ? undefined : field.declaration,
        check: program.frozenDataWrites.receiverFor("project-object", carrier, field.index), path: name === undefined ? undefined : Object.freeze([name]),
        borrowedRead: name !== undefined, dispatch: plan === undefined || read === undefined || write === undefined ? undefined : Object.freeze({ plan, read, write }) });
    }
  }
  for (const request of requests) method(request.receiver, request.index, request.arguments);
  for (const node of new Set(nodes)) {
    const steps: RustValueFieldProjectionStep[] = [];
    const visited = new Set<Node>();
    let current = node;
    let expected: TargetTypeRef | undefined;
    while (!visited.has(current)) {
      visited.add(current);
      const transparent = sourceTransparentExpressionOperand(program.source.ast, current);
      if (transparent !== undefined) {
        steps.push(Object.freeze({ kind: "transparent", node: current, next: transparent }));
        current = transparent;
        continue;
      }
      const operation = producer.records.admittedField.get(current);
      if (operation === undefined || producer.records.fieldValueReceiver.get(current) !== true ||
        operation.declaration !== undefined && program.records.capturedFieldStorage.get(operation.declaration) !== undefined) break;
      if (operation.valueSemantics.kind !== "stored" || operation.dispatch !== undefined ||
        expected !== undefined && !rustTargetTypeRefEquals(expected, operation.resultCarrier)) break;
      const field = producer.records.structuralFieldStorage.get(operation.receiverCarrier, operation.storageIndex)?.field;
      const selected = producer.records.storedField.get(operation.storage, operation.receiverCarrier, operation.storageIndex);
      const path = selected?.path;
      const next = Node_Expression(program.source.ast, current);
      if (path === undefined || next === undefined || operation.storage === "structural-object" &&
        (field?.storage !== "stored" || field.nativeLayout !== undefined || field.method === true)) break;
      steps.push(Object.freeze({ kind: "field", node: current, next, path, field: operation, writable: field?.readonly !== true }));
      expected = operation.receiverCarrier;
      current = next;
    }
    if (steps.some(step => step.kind === "field")) producer.projection(node, { steps: Object.freeze(steps), root: current });
  }
}

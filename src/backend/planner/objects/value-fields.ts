import { requireRustReadOwnership } from "../expressions/typed-locations.js";
import { Node_Expression } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";

import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planExpression } from "../expressions/entry.js";
import { effectivePlannedExpressionCarrier } from "../expressions/fundamentals.js";
import { planRustDirectStorage } from "../expressions/updates/target.js";
import { findRustLocationStorageRoot, planRustSourceLocationStorage, rustExpressionHasBoundRecordField, planRustSharedReceiver,
  rustLocationStorageForReference, rustRawLocationRoot } from "../expressions/typed-locations.js";
import { rustRecordFieldResult, readRustBoundRecordField, writeRustBoundRecordField } from "./record-fields.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustIndexedFieldLocation } from "../expressions/indexed-locations.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { readRustStoredObjectField, writeRustStoredObjectField, rustProjectObjectRepresentation, rustDirectProjectFieldStoragePath } from "./project-storage.js";
import { rustCapturedFieldStorage, rustCapturedFieldLocation } from "./captured-fields.js";
import { readRustProjectObjectFieldOwner, readRustProjectDispatchedField, writeRustProjectDispatchedField, withRustProjectStoredField } from "./project-objects.js";
import { planRustProjectFieldDispatchRole } from "./project-field-dispatch.js";
import { rustClassFrameFieldLocation } from "./frame-storage.js";

export interface RustValueFieldLocation {
  readonly bindings: readonly { readonly name: string; readonly value: RustExpr; readonly mutable?: boolean }[];
  readonly read: RustExpr;
  readonly write: (value: RustExpr, context: RustPlanContext) => RustExpr | undefined;
  readonly project?: (names: readonly string[], carrier: TargetTypeRef) => RustValueFieldLocation;
  readonly withRead?: (project: (value: RustExpr) => RustExpr | undefined) => RustExpr | undefined;
  readonly initialize?: (value: RustExpr, context: RustPlanContext) => RustExpr | undefined;
  readonly address?: (member: string | undefined, context: RustPlanContext) =>
    { readonly kind: "infallible" | "fallible"; readonly value: RustExpr } | undefined;
  readonly invoke?: (arguments_: readonly RustExpr[], context: RustPlanContext) => RustExpr | undefined;
  readonly planInput?: (node: Node, context: RustPlanContext, planValue: () => RustExpr | undefined) => RustExpr | undefined;
}

export function planRustValueFieldInput(
  location: RustValueFieldLocation,
  node: Node,
  context: RustPlanContext,
  planValue: () => RustExpr | undefined = () => planExpression(node, context),
): RustExpr | undefined {
  return location.planInput === undefined ? planValue() : location.planInput(node, context, planValue);
}

export function rustPreparedValueLocation(node: Node, context: RustPlanContext): RustValueFieldLocation | undefined {
  const expression = context.valueFieldLocations?.get(node);
  if (expression !== undefined) return expression;
  const binding = context.input.program.records.sourceBinding.get(node);
  return binding === undefined ? undefined : context.bindingLocations?.get(binding.sourceDeclaration);
}

export function rustSourceFieldHasValueReceiver(node: Node, context: RustPlanContext): boolean {
  if (rustPreparedValueLocation(node, context) !== undefined) return true;
  return context.input.program.records.fieldValueReceiver.get(node) === true;
}

export function planRustValueFieldLocation(
  node: Node,
  context: RustPlanContext,
  access: "read" | "write",
): RustValueFieldLocation | undefined {
  const prepared = rustPreparedValueLocation(node, context);
  if (prepared !== undefined) return prepared;
  const selectedField = context.input.program.records.targetOperation.get(node);
  if (selectedField?.kind === "source-field" && selectedField.declaration !== undefined) {
    const binding = context.input.program.records.frameBindingDeclaration.get(selectedField.declaration);
    if (binding !== undefined) {
      const receiverNode = Node_Expression(context.input.program.source.ast, node);
      const planned = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
      if (receiverNode === undefined || planned === undefined || context.syntheticNames === undefined ||
        !(context.input.program.records.admittedField.get(node) === selectedField)) failRustPlannerInvariant("An admitted native value field requires its exact sealed projection and receiver plan.", node);
      const name = allocateRustSyntheticName(context.syntheticNames, "frame_receiver");
      const location = rustClassFrameFieldLocation(selectedField.declaration, selectedField.receiverCarrier,
        { kind: "path", path: name }, context, receiverNode);
      if (location === undefined) failRustPlannerInvariant("An admitted native value field requires its exact sealed projection and receiver plan.", node);
      return { ...location,
        bindings: [{ name, value: planRustSharedReceiver(receiverNode, planned, context) }] };
    }
    const storage = rustCapturedFieldStorage(selectedField.declaration, context);
    if (storage !== undefined) {
      if (!(context.input.program.records.admittedField.get(node) === selectedField) || context.syntheticNames === undefined) failRustPlannerInvariant("An admitted native value field requires its exact sealed projection and receiver plan.", node);
      if (rustProjectObjectRepresentation(selectedField.receiverCarrier, context)?.kind !== "value") {
        const receiverNode = Node_Expression(context.input.program.source.ast, node);
        const planned = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
        if (receiverNode === undefined || planned === undefined) failRustPlannerInvariant("An admitted native value field requires its exact sealed projection and receiver plan.", node);
        const name = allocateRustSyntheticName(context.syntheticNames, "field_receiver");
        const receiver: RustExpr = { kind: "path", path: name };
        const bindings = [{ name, value: planRustSharedReceiver(receiverNode, planned, context) }];
        if (selectedField.dispatch === undefined) {
          const read = readRustStoredObjectField(selectedField.storage, selectedField.receiverCarrier, receiver,
            selectedField.storageIndex, selectedField.resultCarrier, context);
          const path = rustDirectProjectFieldStoragePath(selectedField.receiverCarrier, selectedField.storageIndex, context);
          const representation = rustProjectObjectRepresentation(selectedField.receiverCarrier, context);
          return read === undefined ? failRustPlannerInvariant("An admitted captured field requires its native read plan.", node) : { bindings, read, write: value => writeRustStoredObjectField(selectedField.storage,
            selectedField.receiverCarrier, receiver, selectedField.storageIndex, "=", value, context),
            ...(path === undefined || representation === undefined ? {} : {
              withRead: (apply: (value: RustExpr) => RustExpr | undefined) => withRustProjectStoredField(receiver, path, representation,
                field => rustCapturedFieldLocation(storage, field, selectedField.resultCarrier, context).withRead(apply)),
            }) };
        }
        const dispatch = context.input.program.records.projectFieldDispatch.get(selectedField.declaration);
        const readRole = dispatch === undefined ? undefined : planRustProjectFieldDispatchRole(dispatch, "read", context);
        if (readRole === undefined) failRustPlannerInvariant("An admitted native value field requires its exact sealed projection and receiver plan.", node);
        const writeName = allocateRustSyntheticName(context.syntheticNames, "field_write_receiver");
        const read = readRustProjectDispatchedField(receiver, selectedField.dispatch.read, readRole);
        if (read === undefined) failRustPlannerInvariant("An admitted native value field requires its exact sealed projection and receiver plan.", node);
        return { bindings, read,
          write: (value, writeContext) => {
            const writeRole = dispatch === undefined ? undefined : planRustProjectFieldDispatchRole(dispatch, "write", writeContext);
            return selectedField.dispatch?.write === undefined || writeRole === undefined ? failRustPlannerInvariant("An admitted dispatched field write requires its sealed write role.", node)
              : writeRustProjectDispatchedField(receiver, writeName, selectedField.dispatch.read, selectedField.dispatch.write,
                "=", value, { read: readRole, write: writeRole });
          } };
      }
      const owner = planRustCapturedFieldOwner(node, context, true);
      if (owner === undefined || context.syntheticNames === undefined) failRustPlannerInvariant("An admitted native value field requires its exact sealed projection and receiver plan.", node);
      const name = allocateRustSyntheticName(context.syntheticNames, "field_owner");
      return { ...rustCapturedFieldLocation(storage, { kind: "path", path: name }, selectedField.resultCarrier, context),
        bindings: [{ name, value: owner }] };
    }
  }
  if (selectedField?.kind === "source-indexed-field") return planRustIndexedFieldLocation(node, selectedField, context, access);
  const reject = (): never => failRustPlannerInvariant(
    "An admitted native value field requires its exact stored projection and owned mutable location.", node);
  if (!rustSourceFieldHasValueReceiver(node, context) || context.syntheticNames === undefined) return reject();
  const { ast } = context.input.program.source;
  if (rustExpressionHasBoundRecordField(node, context)) {
    const operation = context.input.program.records.targetOperation.get(node);
    if (operation?.kind !== "source-field") return reject();
    const field = context.input.program.records.structuralFieldStorage.get(operation.receiverCarrier, operation.storageIndex)?.field;
    if (field === undefined) return reject();
    const root = findRustLocationStorageRoot(node, context);
    if (root !== undefined) {
      const pointer = planRustSourceLocationStorage(node, root.expression, context, planExpression);
      if (pointer === undefined) return reject();
      const name = allocateRustSyntheticName(context.syntheticNames, "record_location");
      const location: RustExpr = { kind: "path", path: name };
      const read = rustRecordFieldResult({ kind: "method-call", receiver: location, method: "try_load", args: [] }, context);
      return read === undefined ? reject() : { bindings: [{ name, value: pointer }], read,
        write: value => rustRecordFieldResult({ kind: "method-call", receiver: location, method: "try_store", args: [value] }, context) };
    }
    const receiverNode = Node_Expression(ast, node);
    const receiver = receiverNode === undefined ? undefined : access === "read"
      ? planExpression(receiverNode, context) : planRustDirectStorage(receiverNode, context);
    if (receiver === undefined) return reject();
    const read = readRustBoundRecordField(receiver, field, context);
    return read === undefined ? reject() : { bindings: [], read,
      write: value => writeRustBoundRecordField(receiver, field, "=", value, context) };
  }
  const names: string[] = [];
  let current = node;
  let leafCarrier: TargetTypeRef | undefined;
  let expectedReceiver: TargetTypeRef | undefined;
  const projection = context.input.program.records.valueFieldProjection.get(node);
  const directOverride = context.expressionOverrides?.get(node);
  if (projection === undefined && directOverride?.valueForm === "storage" && selectedField?.kind === "source-field" &&
    selectedField.valueSemantics.kind === "stored") {
    leafCarrier = selectedField.resultCarrier;
    expectedReceiver = selectedField.resultCarrier;
  } else {
    if (projection === undefined) return reject();
    for (const step of projection.steps) {
      current = step.node;
      const overridden = context.expressionOverrides?.get(current);
      if (overridden !== undefined) {
        if (current === node) {
          if (overridden.valueForm !== "storage" || selectedField?.kind !== "source-field" ||
            selectedField.valueSemantics.kind !== "stored") return reject();
          leafCarrier = selectedField.resultCarrier;
          expectedReceiver = selectedField.resultCarrier;
        }
        break;
      }
      if (context.valueFieldLocations?.has(current)) break;
      if (step.kind === "field") {
        if (expectedReceiver !== undefined && !rustTargetTypeRefEquals(expectedReceiver, step.field.resultCarrier) ||
          access === "write" && names.length === 0 && !step.writable) return reject();
        names.unshift(...step.path);
        leafCarrier ??= step.field.resultCarrier;
        expectedReceiver = step.field.receiverCarrier;
      }
      current = step.next;
    }
  }
  if (leafCarrier === undefined) return reject();
  const resultCarrier = leafCarrier;
  const project = (value: RustExpr): RustExpr => names.reduce<RustExpr>((receiver, name) =>
    ({ kind: "field", receiver, name }), value);
  const read = (value: RustExpr): RustExpr => {
    const selected = project(value);
    const ownership = requireRustReadOwnership(node, context);
    return (access === "read" ? ownership.value : ownership.snapshot)?.kind === "clone"
      ? { kind: "method-call", receiver: selected, method: "clone", args: [] } : selected;
  };
  const capturedRoot = context.valueFieldLocations?.get(current);
  if (capturedRoot !== undefined) {
    if (capturedRoot.project !== undefined) return capturedRoot.project(names, resultCarrier);
    const value = capturedRoot.read;
    if (access === "read") return { bindings: capturedRoot.bindings, read: read(value), write: () => reject() };
    return reject();
  }
  const overridden = context.expressionOverrides?.has(current) === true;
  const rootField = overridden ? undefined : context.input.program.records.targetOperation.get(current);
  if (rootField?.kind === "source-field") {
    if (rootField.valueSemantics.kind !== "stored" || rootField.dispatch !== undefined ||
      !(context.input.program.records.admittedField.get(current) === rootField) ||
      !rustTargetTypeRefEquals(rootField.resultCarrier, expectedReceiver!)) return reject();
    const receiverNode = Node_Expression(ast, current);
    const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
    if (receiverNode === undefined || receiver === undefined) return reject();
    const rootName = allocateRustSyntheticName(context.syntheticNames, "value_owner");
    const root: RustExpr = { kind: "path", path: rootName };
    const selected = readRustStoredObjectField(rootField.storage, rootField.receiverCarrier, root,
      rootField.storageIndex, resultCarrier, context, names);
    if (selected === undefined) return reject();
    return {
      bindings: [{ name: rootName, value: planRustSharedReceiver(receiverNode, receiver, context) }],
      read: selected,
      write: value => writeRustStoredObjectField(rootField.storage, rootField.receiverCarrier, root,
        rootField.storageIndex, "=", value, context, names),
    };
  }
  const location = overridden ? undefined : rustLocationStorageForReference(current, context);
  if (location !== undefined) {
    if (!rustTargetTypeRefEquals(location.valueCarrier, expectedReceiver!)) return reject();
    const root = rustRawLocationRoot(current, context, location.storage === "local-location");
    if (root === undefined) return reject();
    const rootName = allocateRustSyntheticName(context.syntheticNames, "value_location");
    const storage: RustExpr = { kind: "path", path: rootName };
    const ownerName = allocateRustSyntheticName(context.syntheticNames, "value_storage");
    return {
      bindings: [{ name: rootName, value: root }],
      read: read({ kind: "method-call", receiver: storage, method: "load", args: [] }),
      write: value => ({ kind: "method-call", receiver: storage, method: "with_mut", args: [{
        kind: "closure", params: [{ name: ownerName, byRefCopy: false }],
        body: { kind: "assignment", operator: "=", target: project({ kind: "path", path: ownerName }), value },
      }] }),
    };
  }
  const direct = planRustDirectStorage(current, context);
  const carrier = effectivePlannedExpressionCarrier(current, context);
  if (!rustTargetTypeRefEquals(carrier, expectedReceiver)) return reject();
  if (direct === undefined) {
    const value = access === "read" ? planExpression(current, context) : undefined;
    return value === undefined ? reject() : { bindings: [], read: read(value), write: () => reject() };
  }
  return {
    bindings: [],
    read: read(direct),
    withRead: apply => apply(project(direct)),
    write: value => ({ kind: "assignment", operator: "=", target: project(direct), value }),
  };
}

export function planRustCapturedFieldOwner(node: Node, context: RustPlanContext, borrowed = false): RustExpr | undefined {
  const operation = context.input.program.records.targetOperation.get(node);
  if (operation?.kind !== "source-field" || operation.declaration === undefined ||
    !(context.input.program.records.admittedField.get(node) === operation)) failRustPlannerInvariant("An admitted native value field requires its exact sealed projection and receiver plan.", node);
  const storage = rustCapturedFieldStorage(operation.declaration, context);
  if (storage === undefined) failRustPlannerInvariant("An admitted native value field requires its exact sealed projection and receiver plan.", node);
  const captured = context.capturedFieldOwners?.get(node);
  if (captured !== undefined) return storage.kind === "copy" ? captured : borrowed ? { kind: "reference", expr: captured }
    : { kind: "method-call", receiver: captured, method: "clone", args: [] };
  const receiverNode = Node_Expression(context.input.program.source.ast, node);
  const planned = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
  const receiver = receiverNode === undefined || planned === undefined ? undefined
    : planned;
  if (receiver !== undefined && operation.dispatch !== undefined) {
    const slot = context.input.program.records.projectMemberSlot.get(operation.declaration, "capture");
    return slot === undefined ? failRustPlannerInvariant("An admitted captured field requires its exact native capture slot.", node) : { kind: "method-call", receiver: {
      kind: "field", receiver, name: "dispatch",
    }, method: slot, args: [] };
  }
  const path = rustDirectProjectFieldStoragePath(operation.receiverCarrier, operation.storageIndex, context);
  const representation = rustProjectObjectRepresentation(operation.receiverCarrier, context);
  if (receiver === undefined || path === undefined || representation === undefined) failRustPlannerInvariant("An admitted native value field requires its exact sealed projection and receiver plan.", node);
  const stable = context.input.program.records.capturedReceiverStable.get(node) === true;
  return readRustProjectObjectFieldOwner(receiver, path, representation, storage, borrowed && stable && storage.kind !== "copy");
}

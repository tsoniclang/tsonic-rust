import { Node_Expression } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import { rustTargetOperationFactKey } from "../../../analysis/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { isRustCopyCarrier, rustStructuralObjectCarrierValue } from "../../../target-model/types/index.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { planExpression } from "../expressions/entry.js";
import { sourceFieldSelectedOperationMatches } from "../expressions/properties.js";
import { planRustDirectStorage } from "../expressions/updates/target.js";
import { findRustLocationStorageRoot, planRustSourceLocationStorage, rustExpressionHasBoundRecordField, planRustSharedReceiver, rustLocationStorageForReference, rustRawLocationRoot } from "../expressions/typed-locations.js";
import { rustRecordFieldResult, readRustBoundRecordField, writeRustBoundRecordField } from "./record-fields.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustIndexedFieldLocation } from "../expressions/indexed-fields.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { readRustStoredObjectField, writeRustStoredObjectField, rustProjectObjectRepresentation, rustDirectProjectFieldStoragePath } from "./project-storage.js";

export interface RustValueFieldLocation {
  readonly bindings: readonly { readonly name: string; readonly value: RustExpr; readonly mutable?: boolean }[];
  readonly read: RustExpr;
  readonly write: (value: RustExpr) => RustExpr | undefined;
}

export function rustSourceFieldHasValueReceiver(node: Node, context: RustPlanContext): boolean {
  const operation = context.input.program.facts.getFact(node, rustTargetOperationFactKey);
  return operation?.kind === "source-indexed-field" || operation?.kind === "source-field" &&
    (operation.storage === "structural-object"
      ? rustStructuralObjectCarrierValue(operation.receiverCarrier)?.representation === "value"
      : rustProjectObjectRepresentation(operation.receiverCarrier, context)?.kind === "value");
}

export function planRustValueFieldLocation(
  node: Node,
  context: RustPlanContext,
  access: "read" | "write",
): RustValueFieldLocation | undefined {
  const prepared = context.valueFieldLocations?.get(node);
  if (prepared !== undefined) return prepared;
  const selectedField = context.input.program.facts.getFact(node, rustTargetOperationFactKey);
  if (selectedField?.kind === "source-indexed-field") return planRustIndexedFieldLocation(node, selectedField, context, access);
  const reject = (): undefined => {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.value-field-location",
      "A value field requires an exact stored projection and an owned mutable location; copying its receiver cannot implement a write."));
    return undefined;
  };
  if (!rustSourceFieldHasValueReceiver(node, context) || context.syntheticNames === undefined) return reject();
  const { ast } = context.input.program.source;
  if (rustExpressionHasBoundRecordField(node, context)) {
    const operation = context.input.program.facts.getFact(node, rustTargetOperationFactKey);
    if (operation?.kind !== "source-field") return reject();
    const field = context.input.program.structuralShapes.field(operation.receiverCarrier, operation.storageIndex);
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
    const read = readRustBoundRecordField(operation.receiverCarrier, receiver, field, context);
    return read === undefined ? reject() : { bindings: [], read,
      write: value => writeRustBoundRecordField(operation.receiverCarrier, receiver, field, "=", value, context) };
  }
  const names: string[] = [];
  let current = node;
  let leafCarrier: TargetTypeRef | undefined;
  let expectedReceiver: TargetTypeRef | undefined;
  const visited = new Set<Node>();
  while (!visited.has(current)) {
    visited.add(current);
    if (ast.is.IsParenthesizedExpression(current) || ast.is.IsAsExpression(current) ||
      ast.is.IsSatisfiesExpression(current) || ast.is.IsNonNullExpression(current) || ast.is.IsTypeAssertion(current)) {
      const inner = Node_Expression(ast, current);
      if (inner === undefined) return reject();
      current = inner;
      continue;
    }
    const operation = context.input.program.facts.getFact(current, rustTargetOperationFactKey);
    if (operation?.kind !== "source-field" || !rustSourceFieldHasValueReceiver(current, context)) break;
    if (!sourceFieldSelectedOperationMatches(current, operation, context) ||
      operation.valueSemantics.kind !== "stored" || operation.dispatch !== undefined ||
      expectedReceiver !== undefined && !rustTargetTypeRefEquals(expectedReceiver, operation.resultCarrier)) return reject();
    if (operation.storage === "structural-object") {
      const field = context.input.program.structuralShapes.field(operation.receiverCarrier, operation.storageIndex);
      if (field === undefined || field.storage !== "stored" || field.nativeLayout !== undefined || field.method === true ||
        access === "write" && names.length === 0 && field.readonly) return reject();
      names.unshift(field.targetName);
    } else {
      const path = rustDirectProjectFieldStoragePath(operation.receiverCarrier, operation.storageIndex, context);
      if (path === undefined) return reject();
      names.unshift(...path);
    }
    leafCarrier ??= operation.resultCarrier;
    expectedReceiver = operation.receiverCarrier;
    const receiver = Node_Expression(ast, current);
    if (receiver === undefined) return reject();
    current = receiver;
  }
  if (leafCarrier === undefined || names.length === 0) return reject();
  const resultCarrier = leafCarrier;
  const project = (value: RustExpr): RustExpr => names.reduce<RustExpr>((receiver, name) =>
    ({ kind: "field", receiver, name }), value);
  const read = (value: RustExpr): RustExpr => {
    const selected = project(value);
    return isRustCopyCarrier(resultCarrier) ? selected : { kind: "method-call", receiver: selected, method: "clone", args: [] };
  };
  const rootField = context.input.program.facts.getFact(current, rustTargetOperationFactKey);
  if (rootField?.kind === "source-field") {
    if (rootField.valueSemantics.kind !== "stored" || rootField.dispatch !== undefined ||
      !sourceFieldSelectedOperationMatches(current, rootField, context) ||
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
  const location = rustLocationStorageForReference(current, context);
  if (location !== undefined) {
    if (!rustTargetTypeRefEquals(location.valueCarrier, expectedReceiver!)) return reject();
    const root = rustRawLocationRoot(current, context);
    if (root === undefined) return reject();
    const rootName = allocateRustSyntheticName(context.syntheticNames, "value_location");
    const storage: RustExpr = { kind: "path", path: rootName };
    const ownerName = allocateRustSyntheticName(context.syntheticNames, "value_storage");
    return {
      bindings: [{ name: rootName, value: location.storage === "local-location"
        ? { kind: "method-call", receiver: root, method: "clone", args: [] } : root }],
      read: read({ kind: "method-call", receiver: storage, method: "load", args: [] }),
      write: value => ({ kind: "method-call", receiver: storage, method: "with_mut", args: [{
        kind: "closure", params: [{ name: ownerName, byRefCopy: false }],
        body: { kind: "assignment", operator: "=", target: project({ kind: "path", path: ownerName }), value },
      }] }),
    };
  }
  const direct = planRustDirectStorage(current, context);
  const carrier = context.input.program.facts.getRuntimeCarrierFact(current)?.carrier;
  if (!rustTargetTypeRefEquals(carrier, expectedReceiver)) return reject();
  if (direct === undefined) {
    const value = access === "read" ? planExpression(current, context) : undefined;
    return value === undefined ? reject() : { bindings: [], read: read(value), write: () => reject() };
  }
  return {
    bindings: [],
    read: read(direct),
    write: value => ({ kind: "assignment", operator: "=", target: project(direct), value }),
  };
}

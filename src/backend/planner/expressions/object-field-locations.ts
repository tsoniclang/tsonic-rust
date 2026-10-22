import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { rustPackageFallibleBoundary } from "../program/fallible-boundaries.js";
import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";

import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustActiveErrorType, rustCurrentErrorBoundary } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { readRustStoredObjectField, writeRustStoredObjectField } from "../objects/project-storage.js";
import { readRustProjectDispatchedField, writeRustProjectDispatchedField } from "../objects/project-objects.js";
import { planRustProjectFieldDispatchRoles } from "../objects/project-field-dispatch.js";
import { rustClassFrameFieldLocation } from "../objects/frame-storage.js";
import { planRustSharedReceiver } from "./typed-locations.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustAutoBorrowedReceiver } from "./auto-borrowed-receivers.js";

export function rustExpressionHasReferenceObjectField(expression: Node, context: RustPlanContext): boolean {
  return context.input.program.records.referenceObjectField.get(expression) === true;
}

export function planRustReferenceObjectFieldLocation(
  expression: Node,
  context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): RustExpr | undefined {
  const operation = context.input.program.records.targetOperation.get(expression);
  const receiverNode = Node_Expression(context.input.program.source.ast, expression);
  const boundary = rustCurrentErrorBoundary(context);
  if (operation?.kind !== "source-field" || receiverNode === undefined || boundary === undefined ||
    context.syntheticNames === undefined || !(context.input.program.records.admittedField.get(expression) === operation))
    failRustPlannerInvariant("An admitted reference field address requires its checked source receiver and native error boundary.", expression);
  const receiver = planExpression(receiverNode, context);
  if (receiver === undefined) return undefined;
  const callbackContext: RustPlanContext = { ...context, fallibleBoundary: rustPackageFallibleBoundary(boundary) };
  const dispatch = operation.declaration === undefined ? undefined
    : context.input.program.records.projectFieldDispatch.get(operation.declaration);
  const roles = dispatch === undefined ? undefined : planRustProjectFieldDispatchRoles(dispatch, callbackContext);
  if (operation.dispatch !== undefined && roles?.write === undefined)
    failRustPlannerInvariant("An admitted reference field address requires its exact native writable dispatch.", expression);
  const framed = operation.declaration !== undefined && context.input.program.records.frameBindingDeclaration.get(operation.declaration) !== undefined;
  return planRustProjectedObjectLocation(planRustSharedReceiver(receiverNode, receiver, context), operation.operationId, callbackContext,
    reader => framed ? rustClassFrameFieldLocation(operation.declaration!, operation.receiverCarrier, reader, callbackContext)?.read
      : operation.dispatch === undefined
        ? readRustStoredObjectField(operation.storage, operation.receiverCarrier, reader, operation.storageIndex,
            operation.resultCarrier, callbackContext)
        : readRustProjectDispatchedField(reader, operation.dispatch.read, roles!.read),
    (writer, value) => framed ? rustClassFrameFieldLocation(operation.declaration!, operation.receiverCarrier, writer, callbackContext)?.write(value, callbackContext)
      : operation.dispatch === undefined
        ? writeRustStoredObjectField(operation.storage, operation.receiverCarrier, writer, operation.storageIndex,
            "=", value, callbackContext)
        : writeRustProjectDispatchedField(writer, allocateRustSyntheticName(context.syntheticNames!, "location_dispatch"),
            operation.dispatch.read, operation.dispatch.write, "=", value, { read: roles!.read, write: roles!.write! }));
}

export function planRustProjectedObjectLocation(
  receiver: RustExpr, member: string, context: RustPlanContext,
  selectRead: (reader: RustExpr) => RustExpr | undefined,
  selectWrite: (writer: RustExpr, value: RustExpr) => RustExpr | undefined,
  identity: (owner: RustExpr) => RustExpr = owner => owner,
): RustExpr | undefined {
  const errorType = rustActiveErrorType(context);
  if (context.syntheticNames === undefined || errorType === undefined)
    failRustPlannerInvariant("An admitted projected native address requires its hygienic scope and error type.", context.callableDeclaration ?? context.sourceFile);
  const ownerName = allocateRustSyntheticName(context.syntheticNames, "location_owner");
  const readerName = allocateRustSyntheticName(context.syntheticNames, "location_reader");
  const writerName = allocateRustSyntheticName(context.syntheticNames, "location_writer");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "location_value");
  const owner: RustExpr = { kind: "path", path: ownerName };
  const reader: RustExpr = { kind: "path", path: readerName };
  const writer: RustExpr = { kind: "path", path: writerName };
  const value: RustExpr = { kind: "path", path: valueName };
  const read = selectRead(reader);
  const write = selectWrite(writer, value);
  if (read === undefined || write === undefined) {
    failRustPlannerInvariant("An admitted projected native field address requires its physical read and write operations.", context.callableDeclaration ?? context.sourceFile);
  }
  const clone = (value: RustExpr): RustExpr => ({ kind: "method-call",
    receiver: rustAutoBorrowedReceiver(value), method: "clone", args: [] });
  context.usedAliases?.add("rt");
  return rustValueBlock([
    { name: ownerName, value: clone(receiver) },
    { name: readerName, value: clone(owner) },
    { name: writerName, value: clone(owner) },
  ], { kind: "call", path: "rt::Location::try_bind_projected", args: [
    identity(owner),
    { kind: "call", path: "rt::location::LocationSegment::Member", args: [
      { kind: "call", path: "String::from", args: [{ kind: "str-literal", value: member }] },
    ] },
    { kind: "closure", move: true, params: [], body: { kind: "call", path: "Ok",
      genericArguments: [{ kind: "type", type: { kind: "infer" } }, { kind: "type", type: errorType }], args: [read] } },
    { kind: "closure", move: true, params: [{ name: valueName, byRefCopy: false }], body: {
      kind: "evaluate-then", effect: write, discard: "unit", value: {
        kind: "call", path: "Ok", args: [{ kind: "tuple-literal", elements: [] }],
      },
    } },
  ] });
}

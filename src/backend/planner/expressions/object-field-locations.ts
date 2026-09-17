import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import { rustTargetOperationFactKey } from "../../../analysis/facts/keys.js";
import { rustStructuralObjectCarrierValue } from "../../../target-model/types/index.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCurrentErrorBoundary } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustProjectObjectRepresentation, readRustStoredObjectField, writeRustStoredObjectField } from "../objects/project-storage.js";
import { readRustProjectDispatchedField, writeRustProjectDispatchedField } from "../objects/project-objects.js";
import { planRustProjectFieldDispatchRoles } from "../objects/project-field-dispatch.js";

export function rustExpressionHasReferenceObjectField(expression: Node, context: RustPlanContext): boolean {
  const operation = context.input.program.facts.getFact(expression, rustTargetOperationFactKey);
  if (operation?.kind !== "source-field") return false;
  if (operation.storage === "structural-object") {
    const field = context.input.program.structuralShapes.field(operation.receiverCarrier, operation.storageIndex);
    return rustStructuralObjectCarrierValue(operation.receiverCarrier)?.representation === "reference" &&
      field !== undefined && field.storage !== "bound" && field.nativeLayout === undefined;
  }
  const representation = rustProjectObjectRepresentation(operation.receiverCarrier, context);
  return representation !== undefined && representation.kind !== "value";
}

export function planRustReferenceObjectFieldLocation(
  expression: Node,
  context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): RustExpr | undefined {
  const operation = context.input.program.facts.getFact(expression, rustTargetOperationFactKey);
  const receiverNode = Node_Expression(context.input.program.source.ast, expression);
  const boundary = rustCurrentErrorBoundary(context);
  if (operation?.kind !== "source-field" || receiverNode === undefined || boundary === undefined ||
    context.syntheticNames === undefined) return undefined;
  const receiver = planExpression(receiverNode, context);
  if (receiver === undefined) return undefined;
  const callbackContext: RustPlanContext = { ...context, fallibleBoundary: boundary };
  const ownerName = allocateRustSyntheticName(context.syntheticNames, "location_owner");
  const readerName = allocateRustSyntheticName(context.syntheticNames, "location_reader");
  const writerName = allocateRustSyntheticName(context.syntheticNames, "location_writer");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "location_value");
  const owner: RustExpr = { kind: "path", path: ownerName };
  const reader: RustExpr = { kind: "path", path: readerName };
  const writer: RustExpr = { kind: "path", path: writerName };
  const value: RustExpr = { kind: "path", path: valueName };
  const dispatch = operation.declaration === undefined ? undefined
    : context.input.program.projectFieldDispatch.planFor(operation.declaration);
  const roles = dispatch === undefined ? undefined : planRustProjectFieldDispatchRoles(dispatch, callbackContext);
  if (operation.dispatch !== undefined && roles?.write === undefined) return undefined;
  const read = operation.dispatch === undefined
    ? readRustStoredObjectField(operation.storage, operation.receiverCarrier, reader, operation.storageIndex,
        operation.resultCarrier, callbackContext)
    : readRustProjectDispatchedField(reader, operation.dispatch.read, roles!.read);
  const write = operation.dispatch === undefined
    ? writeRustStoredObjectField(operation.storage, operation.receiverCarrier, writer, operation.storageIndex,
        "=", value, callbackContext)
    : writeRustProjectDispatchedField(writer, allocateRustSyntheticName(context.syntheticNames, "location_dispatch"),
        operation.dispatch.read, operation.dispatch.write, "=", value, { read: roles!.read, write: roles!.write! });
  if (read === undefined || write === undefined) return undefined;
  const clone = (value: RustExpr): RustExpr => ({ kind: "method-call", receiver: value, method: "clone", args: [] });
  context.usedAliases?.add("rt");
  return { kind: "block", bindings: [
    { name: ownerName, value: clone(receiver) },
    { name: readerName, value: clone(owner) },
    { name: writerName, value: clone(owner) },
  ], value: { kind: "call", path: "rt::Location::try_bind_projected", args: [
    owner,
    { kind: "call", path: "rt::location::LocationSegment::Member", args: [
      { kind: "call", path: "String::from", args: [{ kind: "str-literal", value: operation.operationId }] },
    ] },
    { kind: "closure", move: true, params: [], body: { kind: "call", path: "Ok", args: [read] } },
    { kind: "closure", move: true, params: [{ name: valueName, byRefCopy: false }], body: {
      kind: "evaluate-then", effect: write, discard: "unit", value: {
        kind: "call", path: "Ok", args: [{ kind: "tuple-literal", elements: [] }],
      },
    } },
  ] } };
}

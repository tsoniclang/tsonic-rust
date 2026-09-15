import type { RustExpr, RustType } from "../../target-ast/nodes.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustStructuralShapeField } from "../../../analysis/objects/structural-shape-plan.js";
import type { RustAssignmentOperator } from "../../../target-model/syntax/tokens.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCurrentErrorBoundary, rustErrorType } from "../program/plan-context.js";
import { rustStructuralObjectCarrierValue, rustProgramErrorTargetType } from "../../../target-model/types/index.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";

export function rustRecordFieldStorageType(field: RustStructuralShapeField, context: RustPlanContext): RustType | undefined {
  const value = rustTypeFromCarrierInContext(field.carrier, context);
  const error = rustTypeFromCarrierInContext(rustProgramErrorTargetType(), context);
  return value === undefined || error === undefined ? undefined : {
    kind: "named", path: "rt::RecordField", genericArguments: [
      { kind: "type", type: value }, { kind: "type", type: error },
    ],
  };
}

export function rustRecordFieldSelector(field: RustStructuralShapeField, mutable: boolean): RustExpr {
  return { kind: "closure", params: [{ name: "record", byRefCopy: false }], body: {
    kind: "reference", mutable, expr: { kind: "field", receiver: { kind: "path", path: "record" }, name: field.targetName },
  } };
}

export function rustRecordFieldResult(expression: RustExpr, context: RustPlanContext): RustExpr | undefined {
  const boundary = rustCurrentErrorBoundary(context);
  return boundary === undefined || context.fallibleBoundary === undefined ? undefined : {
    kind: "try", expr: expression, resultErrorType: rustErrorType(context.fallibleBoundary), operandErrorType: rustErrorType(boundary),
  };
}

export function readRustBoundRecordField(
  receiverCarrier: TargetTypeRef, receiver: RustExpr, field: RustStructuralShapeField, context: RustPlanContext,
): RustExpr | undefined {
  context.usedAliases?.add("rt");
  const owner = rustRecordFieldStorageType(field, context);
  if (owner === undefined) return undefined;
  const value = rustStructuralObjectCarrierValue(receiverCarrier)?.representation === "value";
  return rustRecordFieldResult(value ? {
    kind: "method-call", receiver: { kind: "field", receiver, name: field.targetName }, method: "try_load", args: [],
  } : { kind: "associated-call", owner, method: "try_load_object", args: [
    { kind: "reference", expr: receiver }, rustRecordFieldSelector(field, false),
  ] }, context);
}

export function writeRustBoundRecordField(
  receiverCarrier: TargetTypeRef, receiver: RustExpr, field: RustStructuralShapeField,
  operator: RustAssignmentOperator, value: RustExpr, context: RustPlanContext,
): RustExpr | undefined {
  if (operator !== "=") return mutateRustBoundRecordField(receiverCarrier, receiver, field,
    current => ({ kind: "assignment", target: current, operator, value }), context);
  context.usedAliases?.add("rt");
  const owner = rustRecordFieldStorageType(field, context);
  if (owner === undefined || field.readonly) return undefined;
  const direct = rustStructuralObjectCarrierValue(receiverCarrier)?.representation === "value";
  return rustRecordFieldResult(direct ? {
    kind: "method-call", receiver: { kind: "field", receiver, name: field.targetName }, receiverMode: "mut-ref", method: "try_store", args: [value],
  } : { kind: "associated-call", owner, method: "try_store_object", args: [
    { kind: "reference", expr: receiver }, rustRecordFieldSelector(field, false), rustRecordFieldSelector(field, true), value,
  ] }, context);
}

export function mutateRustBoundRecordField(
  receiverCarrier: TargetTypeRef, receiver: RustExpr, field: RustStructuralShapeField,
  mutation: (field: RustExpr) => RustExpr | undefined, context: RustPlanContext,
): RustExpr | undefined {
  if (context.syntheticNames === undefined || field.readonly) return undefined;
  const ownerName = allocateRustSyntheticName(context.syntheticNames, "record_owner");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "record_value");
  const resultName = allocateRustSyntheticName(context.syntheticNames, "record_result");
  const owner: RustExpr = { kind: "path", path: ownerName };
  const direct = rustStructuralObjectCarrierValue(receiverCarrier)?.representation === "value";
  const selected: RustExpr = direct ? { kind: "dereference", pointer: owner } : owner;
  const loaded = readRustBoundRecordField(receiverCarrier, selected, field, context);
  const changed = mutation({ kind: "path", path: valueName });
  const stored = writeRustBoundRecordField(receiverCarrier, selected, field, "=", { kind: "path", path: valueName }, context);
  if (loaded === undefined || changed === undefined || stored === undefined) return undefined;
  return { kind: "block", bindings: [
    { name: ownerName, value: direct ? { kind: "reference", mutable: true, expr: receiver }
      : { kind: "method-call", receiver, method: "clone", args: [] } },
    { name: valueName, mutable: true, value: loaded },
    { name: resultName, value: changed },
  ], value: { kind: "evaluate-then", effect: stored, discard: "unit", value: { kind: "path", path: resultName } } };
}

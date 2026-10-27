import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import type { RustExpr, RustType } from "../../target-ast/syntax/nodes.js";
import type { RustStructuralShapeField } from "../../../target-model/records/objects/structural-shapes.js";
import type { RustAssignmentOperator } from "../../../target-model/syntax/tokens.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCurrentErrorBoundary } from "../program/plan-context.js";
import { rustErrorType, rustPropagateLocalError } from "../program/fallible-boundaries.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function rustRecordFieldStorageType(field: RustStructuralShapeField, context: RustPlanContext): RustType | undefined {
  if (field.boundStorage === undefined) failRustPlannerInvariant("An admitted bound record field requires its exact native storage carrier.");
  const type = rustTypeFromCarrierInContext(field.boundStorage.carrier, context);
  if (type === undefined) failRustPlannerInvariant("An admitted bound record field requires its native storage syntax.");
  return type;
}

export function rustRecordFieldSelector(field: RustStructuralShapeField, mutable: boolean): RustExpr {
  return { kind: "closure", params: [{ name: "record", byRefCopy: false }], body: {
    kind: "reference", mutable, expr: { kind: "field", receiver: { kind: "path", path: "record" }, name: field.targetName },
  } };
}

export function rustRecordFieldResult(expression: RustExpr, context: RustPlanContext): RustExpr | undefined {
  const boundary = rustCurrentErrorBoundary(context);
  if (boundary === undefined || context.fallibleBoundary === undefined) failRustPlannerInvariant("An admitted fallible record operation requires its exact native error region.");
  return rustPropagateLocalError(context.fallibleBoundary, rustErrorType(boundary), expression);
}

export function readRustBoundRecordField(
  receiver: RustExpr, field: RustStructuralShapeField, context: RustPlanContext,
  receiverIsBorrowed = false,
): RustExpr | undefined {
  context.usedAliases?.add("rt");
  const owner = rustRecordFieldStorageType(field, context);
  if (owner === undefined || field.boundStorage === undefined) failRustPlannerInvariant("An admitted bound record read requires its sealed native storage form.");
  const value = field.boundStorage.direct;
  return rustRecordFieldResult(value ? {
    kind: "method-call", receiver: { kind: "field", receiver, name: field.targetName }, method: "try_load", args: [],
  } : { kind: "associated-call", owner, method: "try_load_object", args: [
    receiverIsBorrowed ? receiver : { kind: "reference", expr: receiver }, rustRecordFieldSelector(field, false),
  ] }, context);
}

export function writeRustBoundRecordField(
  receiver: RustExpr, field: RustStructuralShapeField,
  operator: RustAssignmentOperator, value: RustExpr, context: RustPlanContext,
  receiverIsBorrowed = false,
): RustExpr | undefined {
  if (operator !== "=") return mutateRustBoundRecordField(receiver, field,
    current => ({ kind: "assignment", target: current, operator, value }), context);
  context.usedAliases?.add("rt");
  const owner = rustRecordFieldStorageType(field, context);
  if (owner === undefined || field.boundStorage === undefined) failRustPlannerInvariant("An admitted bound record write requires its sealed native storage form.");
  if (field.readonly) return undefined;
  const direct = field.boundStorage.direct;
  return rustRecordFieldResult(direct ? {
    kind: "method-call", receiver: { kind: "field", receiver, name: field.targetName }, receiverMode: "mut-ref", method: "try_store", args: [value],
  } : { kind: "associated-call", owner, method: "try_store_object", args: [
    receiverIsBorrowed ? receiver : { kind: "reference", expr: receiver }, rustRecordFieldSelector(field, false), rustRecordFieldSelector(field, true), value,
  ] }, context);
}

export function mutateRustBoundRecordField(
  receiver: RustExpr, field: RustStructuralShapeField,
  mutation: (field: RustExpr) => RustExpr | undefined, context: RustPlanContext,
): RustExpr | undefined {
  if (context.syntheticNames === undefined || field.boundStorage === undefined) failRustPlannerInvariant("An admitted bound record mutation requires its native storage form and hygienic scope.");
  if (field.readonly) return undefined;
  const ownerName = allocateRustSyntheticName(context.syntheticNames, "record_owner");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "record_value");
  const resultName = allocateRustSyntheticName(context.syntheticNames, "record_result");
  const owner: RustExpr = { kind: "path", path: ownerName };
  const direct = field.boundStorage.direct;
  const selected: RustExpr = direct ? { kind: "dereference", pointer: owner } : owner;
  const loaded = readRustBoundRecordField(selected, field, context);
  const changed = mutation({ kind: "path", path: valueName });
  const stored = writeRustBoundRecordField(selected, field, "=", { kind: "path", path: valueName }, context);
  if (loaded === undefined || changed === undefined || stored === undefined) return undefined;
  return rustValueBlock([
    { name: ownerName, value: direct ? { kind: "reference", mutable: true, expr: receiver }
      : { kind: "method-call", receiver, method: "clone", args: [] } },
    { name: valueName, mutable: true, value: loaded },
    { name: resultName, value: changed },
  ], { kind: "evaluate-then", effect: stored, discard: "unit", value: { kind: "path", path: resultName } });
}

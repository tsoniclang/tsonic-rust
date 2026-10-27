import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { Node_Expression } from "@tsonic/target-api/source";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planRustBorrowedUpdateLocation, planRustDirectStorage, planRustOwnedUpdateLocation, planRustSourceFieldUpdate, planRustUpdateProjectionArguments, planRustUpdateValue } from "./update-target.js";
import { planRustValueFieldLocation } from "../objects/value-fields.js";
import { finishRustSourceAccessorCall, planRustSourceAccessorCall } from "./properties.js";
import { planRustIndexedRecordStorage, planRustSourceIndexKey } from "../objects/indexed-records.js";
import { planExpression } from "./entry.js";
import { planRustMutableProjectReceiver, planRustPromotedStorageLocation } from "./typed-locations.js";
import { planRustSourceUnionFieldProjection, mutateRustUnionField } from "./unions.js";
import { planRustSourceStaticFieldStorage } from "../declarations/classes/static-field-storage.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustExpressionResultUse } from "./entry.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { RustUnaryUpdateEmission } from "../../../target-model/records/operations/expression-unary.js";
import { planRustSourceAccessorReceiver } from "../objects/accessor-receivers.js";
import { planRustRuntimeIndexUpdate } from "./update-runtime.js";

export function planRustUpdateExpression(expression: Node, selected: RustUnaryUpdateEmission,
  resultUse: RustExpressionResultUse, context: RustPlanContext): RustExpr {
  const { operand, fact, location } = selected;
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted update requires its native name scope.", expression);
  const step: RustExpr = selected.step === "bigint"
    ? { kind: "call", path: "rt::BigInt::from_decimal_literal", args: [{ kind: "str-literal", value: "1" }] }
    : selected.step === "float" ? { kind: "float-literal", text: "1.0" } : { kind: "int-literal", text: "1" };
  if (selected.step === "bigint") context.usedAliases?.add("rt");
  const returnsPrevious = resultUse === "value" && selected.postfix;
  let result: RustExpr | undefined;
  switch (location.kind) {
    case "runtime": result = planRustRuntimeIndexUpdate(expression, operand, fact, step, returnsPrevious, context); break;
    case "value-field": {
      const value = planRustValueFieldLocation(operand, context, "write")
        ?? failRustPlannerInvariant("An admitted value-field update requires its native storage.", operand);
      result = planRustUpdateValue({ locationBindings: value.bindings, read: value.read, write: next => value.write(next, context),
        update: fact, step, returnsPrevious, context });
      break;
    }
    case "accessor": result = planRustSourceAccessorUpdate(location.expression, location.fact, fact, step, returnsPrevious, context); break;
    case "static": {
      const storage = planRustSourceStaticFieldStorage(location.fact, context)
        ?? failRustPlannerInvariant("An admitted static update requires its native storage.", location.expression);
      result = planRustUpdateValue({ locationBindings: storage.bindings, read: storage.read, write: storage.write,
        update: fact, step, returnsPrevious, context });
      break;
    }
    case "index": result = planRustSourceIndexUpdate(location.expression, location.fact, fact, step, returnsPrevious, context); break;
    case "field": {
      const field = location.selection;
      result = field.fact.kind === "source-union-field"
        ? planRustSourceUnionFieldUpdate(operand, field.expression, field.fact, fact, step, returnsPrevious, context)
        : planRustSourceFieldUpdate(operand, field.expression, field.fact, fact, step, returnsPrevious, context);
      break;
    }
    case "promoted": {
      const promoted = planRustPromotedStorageLocation(operand, context, planExpression);
      if (promoted.kind !== "promoted" || promoted.expression === undefined)
        failRustPlannerInvariant("An admitted promoted update requires its native location.", operand);
      result = planRustOwnedUpdateLocation(promoted.expression, fact, step, returnsPrevious, context, promoted);
      break;
    }
    case "direct": {
      const target = planRustDirectStorage(operand, context)
        ?? failRustPlannerInvariant("An admitted direct update requires its native writable place.", operand);
      if (resultUse === "discarded" && selected.directDiscard) {
        if (fact.operator !== "+=" && fact.operator !== "-=") failRustPlannerInvariant("An admitted direct update requires its native assignment operator.", expression);
        result = { kind: "assignment", operator: fact.operator, target, value: step };
      } else result = planRustBorrowedUpdateLocation(target, fact, step, returnsPrevious, context);
      break;
    }
  }
  return result ?? failRustPlannerInvariant("An admitted update requires its complete native read-modify-write plan.", expression);
}

function planRustSourceIndexUpdate(expression: Node,
  index: Extract<RustTargetOperationFact, { readonly kind: "source-index-signature" }>,
  update: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>, step: RustExpr,
  returnsPrevious: boolean, context: RustPlanContext): RustExpr | undefined {
  const names = context.syntheticNames ?? failRustPlannerInvariant("An admitted index update requires its native name scope.", expression);
  const receiverNode = Node_Expression(context.input.program.source.ast, expression)
    ?? failRustPlannerInvariant("An admitted index update requires its source receiver.", expression);
  const plannedReceiver = planExpression(receiverNode, context)
    ?? failRustPlannerInvariant("An admitted index update requires its native receiver.", receiverNode);
  const key = planRustSourceIndexKey(expression, index, context, planExpression, false);
  const storage = planRustIndexedRecordStorage(index.receiverCarrier, index.keyCarrier, index.resultCarrier, index.storage, context);
  if (key === undefined || storage === undefined) failRustPlannerInvariant("An admitted index update requires its native key and storage.", expression);
  const receiverName = allocateRustSyntheticName(names, "index_update_receiver");
  const keyName = allocateRustSyntheticName(names, "index_update_key");
  const receiver: RustExpr = { kind: "path", path: receiverName };
  const selectedKey: RustExpr = { kind: "path", path: keyName };
  return planRustUpdateValue({ locationBindings: [
    { name: receiverName, value: planRustMutableProjectReceiver(receiverNode, plannedReceiver, index.receiverCarrier, context) },
    { name: keyName, value: key }], read: storage.read(receiver, { kind: "reference", expr: selectedKey }),
    write: value => storage.write(receiver, selectedKey, value), update, step, returnsPrevious, context });
}

function planRustSourceAccessorUpdate(accessorExpression: Node,
  accessor: Extract<RustTargetOperationFact, { readonly kind: "source-accessor" }>,
  update: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>, step: RustExpr,
  returnsPrevious: boolean, context: RustPlanContext): RustExpr | undefined {
  if (accessor.read === undefined || accessor.write === undefined)
    failRustPlannerInvariant("An admitted accessor update requires both native accessor declarations.", accessorExpression);
  const readDeclaration = accessor.read.declaration;
  const writeDeclaration = accessor.write.declaration;
  const locationBindings: { name: string; value: RustExpr; mutable?: boolean }[] = [];
  let receiver: RustExpr | undefined;
  if (accessor.receiver.kind === "instance") {
    const evaluation = planRustSourceAccessorReceiver(accessorExpression, [], context)
      ?? failRustPlannerInvariant("An admitted accessor update requires its native receiver.", accessorExpression);
    locationBindings.push(...evaluation.bindings);
    receiver = evaluation.receiver;
  }
  const plannedRead = planRustSourceAccessorCall(accessorExpression, accessor, "read", [], context, receiver);
  const read = plannedRead === undefined ? undefined : finishRustSourceAccessorCall(accessorExpression, readDeclaration, "read", plannedRead, context);
  if (read === undefined) failRustPlannerInvariant("An admitted accessor update requires its native getter.", accessorExpression);
  return planRustUpdateValue({ locationBindings, read,
    write: value => {
      const write = planRustSourceAccessorCall(accessorExpression, accessor, "write", [value], context, receiver);
      return write === undefined ? undefined : finishRustSourceAccessorCall(accessorExpression, writeDeclaration, "write", write, context);
    }, update, step, returnsPrevious, context });
}

export function findRustUpdateSourceAccessor(operand: Node, context: RustPlanContext): {
  readonly expression: Node; readonly fact: Extract<RustTargetOperationFact, { readonly kind: "source-accessor" }>;
} | undefined {
  const selected = context.input.program.records.updateMember.get(operand);
  if (selected === undefined) failRustPlannerInvariant("An admitted accessor query requires its sealed source member selection.", operand);
  return selected?.kind === "accessor" ? selected : undefined;
}

function planRustSourceUnionFieldUpdate(operand: Node, fieldExpression: Node,
  field: Extract<RustTargetOperationFact, { readonly kind: "source-union-field" }>,
  update: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>, step: RustExpr,
  returnsPrevious: boolean, context: RustPlanContext): RustExpr | undefined {
  const names = context.syntheticNames ?? failRustPlannerInvariant("An admitted union field update requires its native name scope.", fieldExpression);
  const receiverNode = Node_Expression(context.input.program.source.ast, fieldExpression)
    ?? failRustPlannerInvariant("An admitted union field update requires its source receiver.", fieldExpression);
  const receiver = planExpression(receiverNode, context)
    ?? failRustPlannerInvariant("An admitted union field update requires its native receiver.", receiverNode);
  const receiverName = allocateRustSyntheticName(names, "union_update_receiver");
  const projection = planRustUpdateProjectionArguments(operand, fieldExpression, context)
    ?? failRustPlannerInvariant("An admitted union field update requires its native index evaluation.", operand);
  const projected = planRustSourceUnionFieldProjection(fieldExpression, { kind: "path", path: receiverName }, field, context,
    (payload, selectedField, variantIndex) => mutateRustUnionField(selectedField, field.variants[variantIndex]!.carrier, payload,
      field.resultCarrier, storage => {
        const overrides = new Map(context.expressionOverrides ?? []);
        for (const override of projection.overrides) overrides.set(override.node, override.value);
        overrides.set(fieldExpression, { expression: storage, carrier: field.resultCarrier, valueForm: "storage", storageForm: "plain" });
        const target = operand === fieldExpression ? storage : planRustDirectStorage(operand,
          { ...context, expressionOverrides: overrides }, projection.inputOverrides);
        return target === undefined ? undefined : planRustBorrowedUpdateLocation(target, update, step, returnsPrevious, context);
      }, context));
  return projected === undefined ? undefined : rustValueBlock([{ name: receiverName, value: receiver }, ...projection.bindings], projected);
}

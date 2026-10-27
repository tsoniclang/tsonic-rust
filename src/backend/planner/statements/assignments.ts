import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import {
  planExpression,
  planRustOperatorCallExpression,
  finishRustSourceAccessorCall,
  planRustSourceAccessorCall,
} from "../expressions/index.js";
import {
  rustProjectObjectDispatchField,
  writeRustProjectMethodOverride,
} from "../objects/project-objects.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { checkRustDataWrite } from "../objects/data-writes.js";
import {
  KindIdentifier,
  Node_Expression,
} from "@tsonic/target-api/source";
import { isRustAssignmentOperator } from "../../../target-model/syntax/tokens.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planRustMutableProjectReceiver, planRustPromotedStorageLocation } from "../expressions/typed-locations.js";
import { planRustSourceStaticFieldStorage } from "../declarations/classes/static-field-storage.js";
import { planRustIndexedRecordStorage, planRustSourceIndexKey } from "../objects/indexed-records.js";
import { rustStringConcat } from "../../target-ast/syntax/expressions.js";
import type { Node } from "@tsonic/tsts";
import type { RustAssignmentOperationPlan } from "../../../target-model/records/operations/operator-selection.js";
import type { RustExpr, RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import { planRustSourceAccessorReceiver } from "../objects/accessor-receivers.js";
import { applyRustValueConversion } from "../expressions/value-conversions.js";
import { planRustSharedReceiver } from "../expressions/typed-locations.js";

export function planRustBuiltinErrorAssignment(
  left: Node,
  valueNode: Node,
  property: Extract<RustTargetOperationFact, { readonly kind: "builtin-error-property" }>,
  assignment: RustAssignmentOperationPlan,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const receiverNode = Node_Expression(context.input.program.source.ast, left);
  if (receiverNode === undefined || context.syntheticNames === undefined)
    failRustPlannerInvariant("An admitted error-field assignment requires its native receiver and name scope.", left);
  const receiver = planExpression(receiverNode, context);
  const value = planExpression(valueNode, context);
  if (receiver === undefined || value === undefined) failRustPlannerInvariant("An admitted error-field assignment requires its native operand plans.", left);
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "error_receiver");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "error_value");
  const currentName = allocateRustSyntheticName(context.syntheticNames, "error_previous");
  const selectedReceiver: RustExpr = { kind: "path", path: receiverName };
  const bindings = [{ name: receiverName, value: planRustSharedReceiver(receiverNode, receiver, context) }];
  if (assignment.operator !== "=") {
    if (property.property === "stack") failRustPlannerInvariant("An admitted compound error-field assignment requires its selected string payload.", left);
    bindings.push({ name: currentName, value: { kind: "owned-string-from-borrowed-str", expression: {
      kind: "call", path: `tsonic_rust_runtime::ErrorObject::error_${property.property}`, args: [selectedReceiver],
    } } });
  }
  bindings.push({ name: valueName, value });
  const next = assignment.operator === "=" ? { kind: "path" as const, path: valueName }
    : planRustCompoundAssignmentValue(assignment, { kind: "path", path: currentName }, { kind: "path", path: valueName }, left, context);
  if (next === undefined) failRustPlannerInvariant("An admitted error-field assignment requires its native value operation.", left);
  return [{ kind: "expr", expr: rustValueBlock(bindings, {
    kind: "call", path: `tsonic_rust_runtime::WritableErrorObject::set_error_${property.property}`,
    args: [selectedReceiver, next],
  }) }];
}

export function planRustSourceMethodPropertyAssignment(
  left: Node,
  valueNode: Node,
  method: Extract<RustTargetOperationFact, { readonly kind: "source-method-property" }>,
  assignment: RustAssignmentOperationPlan,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  if (assignment.kind !== "operator-token" || assignment.operator !== "=" ||
    method.write === undefined) failRustPlannerInvariant("An admitted method replacement requires its sealed native write contract.", left);
  const receiverNode = Node_Expression(context.input.program.source.ast, left);
  const plannedReceiver = receiverNode === undefined
    ? undefined
    : planExpression(receiverNode, context);
  const value = planExpression(valueNode, context);
  const selectedReceiver = context.input.program.records.methodWriteReceiver.get(left);
  const representation = selectedReceiver?.representation;
  if (receiverNode === undefined || plannedReceiver === undefined || value === undefined ||
    representation === undefined ||
    context.syntheticNames === undefined) {
    failRustPlannerInvariant("An admitted method replacement requires its native receiver representation and operand plans.", left);
  }
  const receiverName = allocateRustSyntheticName(
    context.syntheticNames,
    "method_receiver",
  );
  const valueName = allocateRustSyntheticName(
    context.syntheticNames,
    "method_replacement",
  );
  const receiver: RustExpr = { kind: "path", path: receiverName };
  const replacement: RustExpr = { kind: "path", path: valueName };
  const dispatched = context.input.program.records.methodWriteDispatch.get(left);
  if (dispatched === undefined) failRustPlannerInvariant("An admitted method replacement requires its sealed dispatch form.", left);
  let write = dispatched
    ? {
        kind: "method-call" as const,
        receiver: {
          kind: "field" as const,
          receiver,
          name: rustProjectObjectDispatchField,
        },
        method: method.write.dispatchSlot,
        args: [replacement],
      }
    : method.write.storageName === undefined
      ? undefined
      : writeRustProjectMethodOverride(
          receiver,
          method.write.storageName,
          replacement,
          representation,
        );
  if (write === undefined) {
    failRustPlannerInvariant("An admitted method replacement requires its native storage route.", left);
  }
  const check = selectedReceiver?.check;
  if (check !== undefined) {
    const region = context.fallibleBoundary;
    const checked = region === undefined ? undefined : checkRustDataWrite(check, receiver, write, region);
    if (checked === undefined) failRustPlannerInvariant("An admitted method replacement requires its native checked-write region.", left);
    write = checked;
  }
  return [{
    kind: "expr",
    expr: rustValueBlock([{
        name: receiverName,
        value: planRustMutableProjectReceiver(
          receiverNode,
          plannedReceiver,
          method.receiverCarrier,
          context,
        ),
      }, {
        name: valueName,
        value,
      }], write),
  }];
}

export function planRustSourceStaticFieldAssignment(
  target: Node,
  valueNode: Node,
  field: Extract<RustTargetOperationFact, { readonly kind: "source-static-field" }>,
  assignment: RustAssignmentOperationPlan,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  if (!isRustAssignmentOperator(assignment.operator)) {
    failRustPlannerInvariant("An admitted static-field assignment requires its native operator.", target);
  }
  const storage = planRustSourceStaticFieldStorage(field, context);
  const value = planExpression(valueNode, context);
  if (storage === undefined || value === undefined || context.syntheticNames === undefined) {
    failRustPlannerInvariant("An admitted static-field assignment requires its native storage and operand plans.", target);
  }
  const valueName = allocateRustSyntheticName(context.syntheticNames, "static_field_value");
  const valuePath: RustExpr = { kind: "path", path: valueName };
  if (assignment.operator === "=") {
    return [{
      kind: "expr",
      expr: rustValueBlock([
          ...storage.bindings,
          { name: valueName, value },
        ], storage.write(valuePath)),
    }];
  }
  const currentName = allocateRustSyntheticName(context.syntheticNames, "static_field_current");
  const nextName = allocateRustSyntheticName(context.syntheticNames, "static_field_next");
  const nextValue = planRustCompoundAssignmentValue(
    assignment,
    { kind: "path", path: currentName },
    valuePath,
    target,
    context,
  );
  if (nextValue === undefined) {
    failRustPlannerInvariant("An admitted static-field assignment requires its native value operation.", target);
  }
  return [{
    kind: "expr",
    expr: rustValueBlock([
        ...storage.bindings,
        {
          name: currentName,
          value: storage.read,
        },
        { name: valueName, value },
        { name: nextName, value: nextValue },
      ], storage.write({ kind: "path", path: nextName })),
  }];
}

export function planRustDirectOperatorCallAssignment(
  targetNode: Node,
  target: RustExpr | undefined,
  value: RustExpr,
  assignment: Extract<RustAssignmentOperationPlan, { readonly kind: "operator-call" }>,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  if (context.syntheticNames === undefined) {
    failRustPlannerInvariant(
      "Fallible compound assignment requires a finalized hygienic-name scope.",
      targetNode,
    );
  }
  const promoted = planRustPromotedStorageLocation(
    targetNode,
    context,
    planExpression,
    false,
  );
  if (promoted.kind === "promoted") {
    if (promoted.expression === undefined) {
      failRustPlannerInvariant("An admitted promoted compound assignment requires its native location plan.", targetNode);
    }
    const locationName = allocateRustSyntheticName(context.syntheticNames, "location");
    const currentName = allocateRustSyntheticName(context.syntheticNames, "current");
    const valueName = allocateRustSyntheticName(context.syntheticNames, "value");
    const nextName = allocateRustSyntheticName(context.syntheticNames, "next");
    const locationPath: RustExpr = { kind: "path", path: locationName };
    const next = planRustCompoundAssignmentValue(
      assignment,
      { kind: "path", path: currentName },
      { kind: "path", path: valueName },
      targetNode,
      context,
    );
    return [{
      kind: "expr",
      expr: rustValueBlock([
          { name: locationName, value: promoted.expression },
          {
            name: currentName,
            value: promoted.read(locationPath),
          },
          { name: valueName, value },
          { name: nextName, value: next },
        ], promoted.write(locationPath, { kind: "path", path: nextName })),
    }];
  }

  if (target === undefined) {
    failRustPlannerInvariant("An admitted compound assignment requires its direct or promoted native storage owner.", targetNode);
  }
  const currentName = allocateRustSyntheticName(context.syntheticNames, "current");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "value");
  const nextName = allocateRustSyntheticName(context.syntheticNames, "next");
  const directIdentifier = context.input.program.source.ast.kindName(targetNode) === KindIdentifier;
  const locationName = directIdentifier
    ? undefined
    : allocateRustSyntheticName(context.syntheticNames, "location");
  const locationPath: RustExpr = locationName === undefined
    ? target
    : { kind: "dereference", pointer: { kind: "path", path: locationName } };
  const selection = context.input.program.records.assignmentValue.get(targetNode);
  if (selection === undefined) failRustPlannerInvariant("An admitted compound assignment requires its previous-value ownership.", targetNode);
  const current: RustExpr = selection.previous.kind === "clone"
    ? { kind: "method-call", receiver: locationPath, method: "clone", args: [] }
    : selection.previous.kind === "borrow" ? { kind: "reference", mutable: selection.previous.mutable, expr: locationPath } : locationPath;
  const next = planRustCompoundAssignmentValue(
    assignment,
    { kind: "path", path: currentName },
    { kind: "path", path: valueName },
    targetNode,
    context,
    selection.previous.kind === "borrow" ? "shared-reference" : "value",
  );
  return [{
    kind: "expr",
    expr: rustValueBlock([
        ...(locationName === undefined
          ? []
          : [{
              name: locationName,
              value: { kind: "reference" as const, expr: target, mutable: true },
            }]),
        { name: currentName, value: current },
        { name: valueName, value },
        { name: nextName, value: next },
      ], {
        kind: "assignment",
        operator: "=",
        target: locationPath,
        value: { kind: "path", path: nextName },
      }),
  }];
}

export function planRustSourceAccessorAssignment(
  target: Node,
  valueNode: Node,
  accessor: Extract<RustTargetOperationFact, { readonly kind: "source-accessor" }>,
  assignment: RustAssignmentOperationPlan,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const operator = assignment.operator;
  if (!isRustAssignmentOperator(operator)) {
    failRustPlannerInvariant("An admitted accessor assignment requires its native operator.", target);
  }
  const write = accessor.write;
  const read = operator === "=" ? undefined : accessor.read;
  if (write === undefined || (operator !== "=" && read === undefined)) {
    failRustPlannerInvariant("An admitted accessor assignment requires its selected native accessors.", target);
  }
  if (context.syntheticNames === undefined) {
    failRustPlannerInvariant(
      "Project accessor assignment requires a finalized hygienic-name scope.",
      target,
    );
  }
  const bindings: { name: string; value: RustExpr; mutable?: boolean }[] = [];
  let receiver: RustExpr | undefined;
  if (accessor.receiver.kind === "instance") {
    const evaluation = planRustSourceAccessorReceiver(target, [valueNode], context);
    if (evaluation === undefined) failRustPlannerInvariant("An admitted accessor assignment requires its native receiver plan.", target);
    bindings.push(...evaluation.bindings);
    receiver = evaluation.receiver;
  }
  let current: RustExpr | undefined;
  if (read !== undefined) {
    const plannedRead = planRustSourceAccessorCall(
      target,
      accessor,
      "read",
      [],
      context,
      receiver,
    );
    const finalizedRead = plannedRead === undefined
      ? undefined
      : finishRustSourceAccessorCall(target, read.declaration, "read", plannedRead, context);
    if (finalizedRead === undefined) {
      failRustPlannerInvariant("An admitted accessor assignment requires its native getter completion.", target);
    }
    const currentName = allocateRustSyntheticName(context.syntheticNames, "accessor_current");
    bindings.push({ name: currentName, value: finalizedRead });
    current = { kind: "path", path: currentName };
  }
  const plannedValue = planExpression(valueNode, context);
  if (plannedValue === undefined) {
    failRustPlannerInvariant("An admitted accessor assignment requires its native operand plan.", valueNode);
  }
  const valueName = allocateRustSyntheticName(context.syntheticNames, "accessor_value");
  bindings.push({ name: valueName, value: plannedValue });
  const selectedValue: RustExpr = { kind: "path", path: valueName };
  const next = operator === "="
    ? selectedValue
    : current === undefined
      ? undefined
      : planRustCompoundAssignmentValue(
          assignment,
          current,
          selectedValue,
          target,
          context,
        );
  if (next === undefined) {
    failRustPlannerInvariant("An admitted accessor assignment requires its native value operation.", target);
  }
  const plannedWrite = planRustSourceAccessorCall(
    target,
    accessor,
    "write",
    [next],
    context,
    receiver,
  );
  const finalizedWrite = plannedWrite === undefined
    ? undefined
    : finishRustSourceAccessorCall(target, write.declaration, "write", plannedWrite, context);
  if (finalizedWrite === undefined) failRustPlannerInvariant("An admitted accessor assignment requires its native setter completion.", target);
  return [{ kind: "expr", expr: rustValueBlock(bindings, finalizedWrite) }];
}

export function planRustCompoundAssignmentValue(
  assignment: RustAssignmentOperationPlan,
  current: RustExpr,
  value: RustExpr,
  node: Node,
  context: RustPlanContext,
  currentForm: "value" | "shared-reference" = "value",
): RustExpr {
  if (assignment.operator === "=") return value;
  const selection = context.input.program.records.assignmentValue.get(node);
  if (selection === undefined) failRustPlannerInvariant("An admitted assignment requires its sealed native value operation.", node);
  if (selection.kind === "plain") return value;
  if (selection.kind === "string-concat") return rustStringConcat([{ kind: "value", value: current }, { kind: "value", value }]);
  if (selection.kind === "call") {
    const planned = planRustOperatorCallExpression(selection.operation,
      { expression: current, form: currentForm }, { expression: value, form: "value" }, node, context);
    if (planned === undefined) failRustPlannerInvariant("An admitted assignment requires its native operator call plan.", node);
    return planned;
  }
  const left = applyRustValueConversion(context, { stage: "finalized", expression: current }, selection.leftConversion, node);
  const right = applyRustValueConversion(context, { stage: "finalized", expression: value }, selection.rightConversion, node);
  if (left === undefined || right === undefined) failRustPlannerInvariant("An admitted assignment requires its native operand conversions.", node);
  return { kind: "binary", operator: selection.operator, left, right };
}

export function planRustSourceIndexAssignment(
  target: Node,
  valueNode: Node,
  index: Extract<RustTargetOperationFact, { readonly kind: "source-index-signature" }>,
  assignment: RustAssignmentOperationPlan,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted index assignment requires its native name scope.", target);
  const receiverNode = Node_Expression(context.input.program.source.ast, target);
  const plannedReceiver = receiverNode === undefined
    ? undefined
    : planExpression(receiverNode, context);
  const key = planRustSourceIndexKey(target, index, context, planExpression, false);
  const value = planExpression(valueNode, context);
  const storage = planRustIndexedRecordStorage(index.receiverCarrier, index.keyCarrier, index.resultCarrier, index.storage, context);
  if (receiverNode === undefined || plannedReceiver === undefined || key === undefined || value === undefined || storage === undefined) {
    failRustPlannerInvariant("An admitted index assignment requires its native storage and operand plans.", target);
  }
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "index_receiver");
  const keyName = allocateRustSyntheticName(context.syntheticNames, "index_key");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "index_value");
  const receiverPath: RustExpr = { kind: "path", path: receiverName };
  const keyPath: RustExpr = { kind: "path", path: keyName };
  const valuePath: RustExpr = { kind: "path", path: valueName };
  const bindings: {
    readonly name: string;
    readonly value: RustExpr;
  }[] = [{
    name: receiverName,
    value: planRustMutableProjectReceiver(
      receiverNode,
      plannedReceiver,
      index.receiverCarrier,
      context,
    ),
  }, {
    name: keyName,
    value: key,
  }];
  let next: RustExpr = valuePath;
  if (assignment.operator !== "=") {
    const currentName = allocateRustSyntheticName(context.syntheticNames, "index_current");
    bindings.push({
      name: currentName,
      value: storage.read(
        receiverPath,
        { kind: "reference", expr: keyPath },
      ),
    }, {
      name: valueName,
      value,
    });
    const plannedNext = planRustCompoundAssignmentValue(
      assignment,
      { kind: "path", path: currentName },
      valuePath,
      target,
      context,
    );
    const nextName = allocateRustSyntheticName(context.syntheticNames, "index_next");
    bindings.push({ name: nextName, value: plannedNext });
    next = { kind: "path", path: nextName };
  } else {
    bindings.push({ name: valueName, value });
  }
  const write = storage.write(
    receiverPath,
    keyPath,
    next,
  );
  if (write === undefined) {
    failRustPlannerInvariant("An admitted index assignment requires its native write plan.", target);
  }
  return [{
    kind: "expr",
    expr: rustValueBlock(bindings, write),
  }];
}

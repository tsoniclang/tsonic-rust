import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { Node_Expression } from "@tsonic/target-api/source";
import {
  planRustMutableProjectReceiver,
  planRustPromotedStorageLocation,
  planRustPromotedStorageWrite,
  planRustModuleBindingStore,
  findRustLocationStorageRoot,
  rustRawLocationRoot,
} from "../expressions/typed-locations.js";

import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustActiveErrorType } from "../program/plan-context.js";
import { applyRustFallibleResultExpression } from "../types/fallible-shape.js";
import {
  isRustAssignmentOperator,
  rustStringPushMethod,
  rustStringPushStrMethod,
} from "../../../target-model/syntax/tokens.js";
import { isRustStringCarrier } from "../../../target-model/types/index.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planExpression } from "../expressions/index.js";
import { planRuntimeSetStatement } from "./statement-loops.js";
import { planRustCompoundAssignmentValue, planRustDirectOperatorCallAssignment, planRustSourceAccessorAssignment, planRustSourceIndexAssignment, planRustSourceMethodPropertyAssignment, planRustSourceStaticFieldAssignment } from "./assignments.js";
import { planRustBuiltinErrorAssignment } from "./assignments.js";
import { planRustSourceUnionFieldProjection, readRustUnionField, writeRustUnionField } from "../expressions/unions.js";
import { readRustProjectDispatchedField, writeRustProjectDispatchedField, withRustProjectStoredField } from "../objects/project-objects.js";
import { planRustProjectFieldDispatchRoles } from "../objects/project-field-dispatch.js";
import { readRustStoredObjectField, rustDirectProjectFieldStoragePath, rustProjectObjectRepresentation, writeRustStoredObjectField } from "../objects/project-storage.js";
import { rustStringConcat } from "../../target-ast/syntax/expressions.js";
import { planRustStringConcatOperand } from "../expressions/string-concat-parts.js";
import { planRustDirectStorage } from "../expressions/update-target.js";
import type { Node } from "@tsonic/tsts";
import type { RustAssignmentOperationPlan } from "../../../target-model/records/operations/operator-selection.js";
import type { RustExpr, RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";

import { planRustValueFieldInput, planRustValueFieldLocation, rustPreparedValueLocation } from "../objects/value-fields.js";
import { planRustFieldProjectionAssignment } from "./field-projection-assignment.js";
import { planRustCompoundRuntimeWrite } from "./compound-runtime-write.js";

import { prepareRustComputedMemberEvaluation } from "../expressions/computed-members.js";
import { planRustBorrowedElementRead } from "../expressions/borrowed-element-reads.js";

export function planRustAssignmentWrite(
  expression: Node,
  left: Node,
  valueNode: Node,
  fact: RustAssignmentOperationPlan,
  context: RustPlanContext,
): readonly RustStmt[] {
  const borrowed = context.input.program.records.borrowedElementRead.get(expression);
  if (borrowed !== undefined && context.expressionOverrides?.has(borrowed.receiver) !== true) {
    const planned = planRustBorrowedElementRead(expression, borrowed, context, (selectedExpression, selected) => {
      const statements = planRustAssignmentWrite(selectedExpression, left, valueNode, fact, selected);
      return { kind: "block", body: { statements } };
    });
    if (planned === undefined) failRustPlannerInvariant("An admitted guarded assignment requires its native write plan.", expression);
    return [{ kind: "expr", expr: planned }];
  }
  const evaluation = prepareRustComputedMemberEvaluation(left, context);
  if (evaluation === undefined) failRustPlannerInvariant("An admitted assignment requires its computed-member evaluation plan.", left);
  if (evaluation.bindings.length !== 0) {
    const statements = planRustAssignmentWrite(expression, left, valueNode, fact, evaluation.context);
    return [{ kind: "scope", body: {
      statements: [
        ...evaluation.bindings.map(binding => ({ kind: "let" as const,
          name: binding.name, mutable: binding.mutable ?? false, init: binding.value })),
        ...statements,
      ],
    } }];
  }
  const { ast } = context.input.program.source;
  const completion = context.input.program.records.assignmentWrite.get(expression);
  if (completion === undefined) failRustPlannerInvariant("An admitted assignment requires its sealed write completion.", expression);
  const operator = fact.operator;
  if (!isRustAssignmentOperator(operator)) {
    failRustPlannerInvariant("An admitted assignment requires its native assignment token.", expression);
  }
  const sourceField = context.input.program.records.targetOperation.get(left);
  const borrowedWrite = context.input.program.records.borrowedFieldWrite.get(expression);
  if (borrowedWrite !== undefined && context.expressionOverrides?.has(borrowedWrite.receiver) !== true) {
    const errorType = borrowedWrite.fallible ? rustActiveErrorType(context) : undefined;
    if (borrowedWrite.fallible && errorType === undefined) {
      failRustPlannerInvariant("An admitted guarded field write requires its native error boundary.", expression);
    }
    const write = (field: RustExpr): RustExpr => {
      const overrides = new Map(context.expressionOverrides ?? []);
      overrides.set(borrowedWrite.receiver, { expression: { kind: "reference", expr: field },
        carrier: borrowedWrite.field.resultCarrier, valueForm: "shared-reference" });
      const statements = planRustAssignmentWrite(expression, left, valueNode, fact,
        { ...context, expressionOverrides: overrides });
      return { kind: "block", body: {
        statements: errorType === undefined ? statements : [...statements, {
          kind: "tail", expr: applyRustFallibleResultExpression({ kind: "tuple-literal", elements: [] }, { errorType }),
        }],
      } };
    };
    const location = context.valueFieldLocations?.get(borrowedWrite.receiver) ??
      (borrowedWrite.location === "captured-field"
        ? planRustValueFieldLocation(borrowedWrite.receiver, context, "read") : undefined);
    let selected: RustExpr | undefined;
    if (location?.withRead !== undefined) {
      const body = location.withRead(write);
      if (body === undefined) failRustPlannerInvariant("An admitted guarded assignment requires its native location body.", expression);
      selected = location.bindings.length === 0 ? body
        : rustValueBlock(location.bindings, body);
    } else if (borrowedWrite.location === "stored-field") {
      const plannedOwner = planExpression(borrowedWrite.owner, context);
      const path = rustDirectProjectFieldStoragePath(borrowedWrite.field.receiverCarrier,
        borrowedWrite.field.storageIndex, context);
      const representation = rustProjectObjectRepresentation(borrowedWrite.field.receiverCarrier, context);
      if (plannedOwner === undefined || path === undefined || representation === undefined)
        failRustPlannerInvariant("An admitted guarded write requires its selected native owner, field path and representation.", left);
      const owner = plannedOwner;
      selected = withRustProjectStoredField(owner, path, representation, write);
    } else {
      failRustPlannerInvariant("An admitted captured field write requires its borrowed physical location.", expression);
    }
    if (selected === undefined) failRustPlannerInvariant("An admitted guarded assignment requires its native stored-field plan.", expression);
    return [{ kind: "expr", expr: errorType === undefined ? selected
      : { kind: "try", expr: selected, resultErrorType: errorType, operandErrorType: errorType } }];
  }
  if (sourceField?.kind === "builtin-error-property") return planRustBuiltinErrorAssignment(left, valueNode, sourceField, fact, context)
    ?? failRustPlannerInvariant("An admitted error-field assignment requires its native write plan.", left);
  const compoundWrite = context.input.program.records.compoundWrite.get(expression);
  if (compoundWrite !== undefined) {
    const statements = operator === "="
      ? planRuntimeSetStatement(expression, compoundWrite, context)
      : planRustCompoundRuntimeWrite(expression, left, valueNode, fact, context);
    return statements ?? failRustPlannerInvariant("An admitted compound assignment requires its native setter plan.", expression);
  }
  const storageOverride = context.expressionOverrides?.get(left);
  if (storageOverride?.valueForm !== "storage" && context.input.program.records.fieldProjectionAssignment.get(expression) !== undefined)
    return planRustFieldProjectionAssignment(expression, left, valueNode, fact, context)
      ?? failRustPlannerInvariant("An admitted projection assignment requires its native write plan.", left);
  const target = planRustDirectStorage(left, context);
  if (storageOverride?.valueForm !== "storage" && (completion.valueField || rustPreparedValueLocation(left, context) !== undefined)) {
    const location = planRustValueFieldLocation(left, context, "write");
    const value = location === undefined ? undefined : planRustValueFieldInput(location, valueNode, context);
    if (location === undefined || value === undefined || context.syntheticNames === undefined)
      failRustPlannerInvariant("An admitted value-field write requires its native location, input and name scope.", left);
    const currentName = allocateRustSyntheticName(context.syntheticNames, "field_previous");
    const valueName = allocateRustSyntheticName(context.syntheticNames, "field_value");
    const next = planRustCompoundAssignmentValue(fact, { kind: "path", path: currentName },
      { kind: "path", path: valueName }, left, context);
    const written = location.write(next, context);
    if (written === undefined) failRustPlannerInvariant("An admitted value-field assignment requires its native store plan.", left);
    return [{ kind: "expr", expr: rustValueBlock([...location.bindings, ...(operator === "=" ? [] : [{ name: currentName, value: location.read }]),
        { name: valueName, value }], written) }];
  }
  if (sourceField?.kind === "source-accessor") {
    return planRustSourceAccessorAssignment(
      left,
      valueNode,
      sourceField,
      fact,
      context,
    ) ?? failRustPlannerInvariant("An admitted accessor assignment requires its native write plan.", left);
  }
  if (sourceField?.kind === "source-method-property") {
    return planRustSourceMethodPropertyAssignment(
      left,
      valueNode,
      sourceField,
      fact,
      context,
    ) ?? failRustPlannerInvariant("An admitted method-property assignment requires its native write plan.", left);
  }
  if (sourceField?.kind === "source-static-field") {
    return planRustSourceStaticFieldAssignment(
      left,
      valueNode,
      sourceField,
      fact,
      context,
    ) ?? failRustPlannerInvariant("An admitted static-field assignment requires its native write plan.", left);
  }
  if (sourceField?.kind === "source-union-field") {
    const receiverNode = Node_Expression(ast, left);
    const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
    if (receiver === undefined || context.syntheticNames === undefined) {
      failRustPlannerInvariant("An admitted union-field write requires its native receiver and name scope.", left);
    }
    const syntheticNames = context.syntheticNames;
    const receiverName = allocateRustSyntheticName(syntheticNames, "union_receiver");
    const value = planExpression(valueNode, context);
    if (value === undefined) {
      failRustPlannerInvariant("An admitted union-field write requires its native value plan.", valueNode);
    }
    const valueName = allocateRustSyntheticName(syntheticNames, "union_value");
    const projected = planRustSourceUnionFieldProjection(
      left,
      { kind: "path", path: receiverName },
      sourceField,
      context,
      (payload, field, variantIndex) => {
        const receiverCarrier = sourceField.variants[variantIndex]!.carrier;
        if (fact.kind === "operator-call") {
          const currentName = allocateRustSyntheticName(syntheticNames, "union_current");
          const nextName = allocateRustSyntheticName(syntheticNames, "union_next");
          const next = planRustCompoundAssignmentValue(
            fact,
            { kind: "path", path: currentName },
            { kind: "path", path: valueName },
            left,
            context,
          );
          const current = readRustUnionField(
            field,
            receiverCarrier,
            payload,
            fact.resultCarrier,
            context,
          );
          const written = writeRustUnionField(
            field,
            receiverCarrier,
            payload,
            "=",
            { kind: "path", path: nextName },
            context,
          );
          if (current === undefined || written === undefined)
            failRustPlannerInvariant("An admitted union-field assignment requires its native read and write plans.", left);
          return rustValueBlock([
                  {
                    name: currentName,
                    value: current,
                  },
                  { name: valueName, value },
                  { name: nextName, value: next },
                ], written);
        }
        if (operator !== "=") {
          const currentName = allocateRustSyntheticName(
            syntheticNames,
            "union_current",
          );
          const current = readRustUnionField(
            field,
            receiverCarrier,
            payload,
            fact.resultCarrier,
            context,
          );
          if (current === undefined) {
            failRustPlannerInvariant("An admitted union-field update requires its native previous-value plan.", left);
          }
          const nextName = allocateRustSyntheticName(syntheticNames, "union_next");
          const next: RustExpr = operator === "+=" && isRustStringCarrier(fact.resultCarrier)
            ? rustStringConcat([{ kind: "value", value: { kind: "path", path: currentName } }, planRustStringConcatOperand(valueNode, value, context)])
            : { kind: "evaluate-then", discard: "unit", effect: { kind: "assignment", operator,
                target: { kind: "path", path: currentName }, value },
                value: { kind: "path", path: currentName } };
          const written = writeRustUnionField(
            field,
            receiverCarrier,
            payload,
            "=",
            { kind: "path", path: nextName },
            context,
          );
          if (written === undefined) {
            failRustPlannerInvariant("An admitted union-field update requires its native store plan.", left);
          }
          return rustValueBlock([{
              name: currentName,
              mutable: !(operator === "+=" && isRustStringCarrier(fact.resultCarrier)),
              value: current,
            }, { name: nextName, value: next }], written);
        }
        const written = writeRustUnionField(
          field,
          receiverCarrier,
          payload,
          operator,
          { kind: "path", path: valueName },
          context,
        );
        if (written === undefined) failRustPlannerInvariant("An admitted union-field assignment requires its native write plan.", left);
        return rustValueBlock([{ name: valueName, value }], written);
      },
    );
    if (projected === undefined) failRustPlannerInvariant("An admitted union-field assignment requires its native projection plan.", left);
    return [{
          kind: "expr",
          expr: rustValueBlock([
              { name: receiverName, value: receiver },
            ], projected),
        }];
  }
  if (storageOverride?.valueForm !== "storage" &&
    sourceField?.kind === "source-index-signature") {
    return planRustSourceIndexAssignment(
      left,
      valueNode,
      sourceField,
      fact,
      context,
    ) ?? failRustPlannerInvariant("An admitted indexed assignment requires its native write plan.", left);
  }
  if (storageOverride?.valueForm !== "storage" && sourceField?.kind === "source-field") {
    const receiverNode = Node_Expression(ast, left);
    const plannedReceiver = receiverNode === undefined
      ? undefined
      : planExpression(receiverNode, context);
    const receiver = receiverNode === undefined || plannedReceiver === undefined
      ? plannedReceiver
      : planRustMutableProjectReceiver(
          receiverNode,
          plannedReceiver,
          sourceField.receiverCarrier,
          context,
        );
    if (receiver === undefined) {
      failRustPlannerInvariant("An admitted field assignment requires its native receiver plan.", left);
    }
    if (context.syntheticNames === undefined) {
      failRustPlannerInvariant(
        "Project-source field assignment requires a finalized hygienic-name scope.",
        left,
      );
    }
    const dispatchPlan = sourceField.dispatch === undefined
      ? undefined
      : sourceField.declaration === undefined
        ? undefined
        : context.input.program.records.projectFieldDispatch.get(sourceField.declaration);
    if (sourceField.dispatch !== undefined && dispatchPlan?.write === undefined) {
      failRustPlannerInvariant("An admitted field write requires its native dispatch plan.", left);
    }
    const dispatchRoles = dispatchPlan === undefined
      ? undefined
      : planRustProjectFieldDispatchRoles(dispatchPlan, context);
    if ((dispatchPlan !== undefined && dispatchRoles === undefined) ||
      (dispatchPlan?.write !== undefined && dispatchRoles?.write === undefined)) {
      failRustPlannerInvariant("An admitted field assignment requires its native dispatch roles.", left);
    }
    const dispatchReadRole = dispatchRoles?.read;
    const receiverName = allocateRustSyntheticName(context.syntheticNames, "receiver");
    if (fact.kind === "operator-call") {
      const currentName = allocateRustSyntheticName(context.syntheticNames, "current");
      const valueName = allocateRustSyntheticName(context.syntheticNames, "value");
      const nextName = allocateRustSyntheticName(context.syntheticNames, "next");
      const selectedReceiver: RustExpr = { kind: "path", path: receiverName };
      const current = sourceField.dispatch === undefined
        ? readRustStoredObjectField(
            sourceField.storage,
            sourceField.receiverCarrier,
            selectedReceiver,
            sourceField.storageIndex,
            fact.resultCarrier,
            context,
            [],
            true,
          )
        : readRustProjectDispatchedField(
            selectedReceiver,
            sourceField.dispatch.read,
            dispatchReadRole!,
          );
      const value = planExpression(valueNode, context);
      if (value === undefined) {
        failRustPlannerInvariant("An admitted field update requires its native value plan.", valueNode);
      }
      const next = planRustCompoundAssignmentValue(
        fact,
        { kind: "path", path: currentName },
        { kind: "path", path: valueName },
        left,
        context,
      );
      const written = sourceField.dispatch === undefined
        ? writeRustStoredObjectField(
            sourceField.storage,
            sourceField.receiverCarrier,
            selectedReceiver,
            sourceField.storageIndex,
            "=",
            { kind: "path", path: nextName },
            context,
            [],
            true,
          )
        : writeRustProjectDispatchedField(
            selectedReceiver,
            allocateRustSyntheticName(context.syntheticNames, "dispatch_receiver"),
            sourceField.dispatch.read,
            sourceField.dispatch.write,
            "=",
            { kind: "path", path: nextName },
            { read: dispatchRoles!.read, write: dispatchRoles!.write! },
          );
      if (current === undefined || next === undefined || written === undefined) {
        failRustPlannerInvariant("An admitted field update requires its native previous-value, operation and store plans.", left);
      }
      return [{
        kind: "expr",
        expr: rustValueBlock([
            { name: receiverName, value: receiver },
            { name: currentName, value: current },
            { name: valueName, value },
            { name: nextName, value: next },
          ], written),
      }];
    }
    const value = planExpression(valueNode, context);
    if (value === undefined) {
      failRustPlannerInvariant("An admitted field assignment requires its native value plan.", valueNode);
    }
    const valueName = allocateRustSyntheticName(context.syntheticNames, "value");
    if (operator === "+=" && isRustStringCarrier(fact.resultCarrier)) {
      const currentName = allocateRustSyntheticName(context.syntheticNames, "current");
      const selectedReceiver: RustExpr = { kind: "path", path: receiverName };
      const current = sourceField.dispatch === undefined
        ? readRustStoredObjectField(
            sourceField.storage,
            sourceField.receiverCarrier,
            selectedReceiver,
            sourceField.storageIndex,
            fact.resultCarrier,
            context,
            [],
            true,
          )
        : readRustProjectDispatchedField(
            selectedReceiver,
            sourceField.dispatch.read,
            dispatchReadRole!,
          );
      const concatenated = rustStringConcat([
        { kind: "value", value: { kind: "path", path: currentName } },
        planRustStringConcatOperand(valueNode, value, context),
      ]);
      const written = sourceField.dispatch === undefined
        ? writeRustStoredObjectField(
            sourceField.storage,
            sourceField.receiverCarrier,
            selectedReceiver,
            sourceField.storageIndex,
            "=",
            concatenated,
            context,
            [],
            true,
          )
        : writeRustProjectDispatchedField(
            selectedReceiver,
            allocateRustSyntheticName(context.syntheticNames, "dispatch_receiver"),
            sourceField.dispatch.read,
            sourceField.dispatch.write,
            "=",
            concatenated,
            { read: dispatchRoles!.read, write: dispatchRoles!.write! },
          );
      if (current === undefined || written === undefined) {
        failRustPlannerInvariant("An admitted string-field update requires its native previous-value and store plans.", left);
      }
      return [{
        kind: "expr",
        expr: rustValueBlock([
            { name: receiverName, value: receiver },
            { name: currentName, value: current },
          ], written),
      }];
    }
    if (operator !== "=") {
      const currentName = allocateRustSyntheticName(context.syntheticNames, "current");
      const selectedReceiver: RustExpr = { kind: "path", path: receiverName };
      const current = sourceField.dispatch === undefined
        ? readRustStoredObjectField(sourceField.storage, sourceField.receiverCarrier, selectedReceiver,
            sourceField.storageIndex, fact.resultCarrier, context, [], true)
        : readRustProjectDispatchedField(selectedReceiver, sourceField.dispatch.read, dispatchReadRole!);
      const next: RustExpr = { kind: "path", path: currentName };
      const written = sourceField.dispatch === undefined
        ? writeRustStoredObjectField(sourceField.storage, sourceField.receiverCarrier, selectedReceiver,
            sourceField.storageIndex, "=", next, context, [], true)
        : writeRustProjectDispatchedField(selectedReceiver,
            allocateRustSyntheticName(context.syntheticNames, "dispatch_receiver"), sourceField.dispatch.read,
            sourceField.dispatch.write, "=", next, { read: dispatchRoles!.read, write: dispatchRoles!.write! });
      if (current === undefined || written === undefined)
        failRustPlannerInvariant("An admitted field update requires its native previous-value and store plans.", left);
      return [{ kind: "expr", expr: rustValueBlock([
        { name: receiverName, value: receiver }, { name: currentName, mutable: true, value: current },
        { name: valueName, value },
      ], { kind: "evaluate-then", discard: "unit",
        effect: { kind: "assignment", operator, target: next, value: { kind: "path", path: valueName } },
        value: written,
      }) }];
    }
    const written = sourceField.dispatch === undefined
      ? writeRustStoredObjectField(
          sourceField.storage,
          sourceField.receiverCarrier,
          { kind: "path", path: receiverName },
          sourceField.storageIndex,
          operator,
          { kind: "path", path: valueName },
          context,
          [],
          true,
        )
      : writeRustProjectDispatchedField(
          { kind: "path", path: receiverName },
          allocateRustSyntheticName(context.syntheticNames, "dispatch_receiver"),
          sourceField.dispatch.read,
          sourceField.dispatch.write,
          operator,
          { kind: "path", path: valueName },
          { read: dispatchRoles!.read, write: dispatchRoles!.write! },
        );
    if (written === undefined) {
      failRustPlannerInvariant("An admitted field assignment requires its native store plan.", left);
    }
    return [{
      kind: "expr",
      expr: rustValueBlock(completion.deferReceiverBorrow
          ? [{ name: valueName, value }, { name: receiverName, value: receiver }]
          : [{ name: receiverName, value: receiver }, { name: valueName, value }], written),
    }];
  }
  if (operator === "+=" && completion.stringAppend !== undefined) {
    const append = completion.stringAppend;
    let receiver = target;
    if (append.receiver === "borrow-cell") {
      const root = findRustLocationStorageRoot(left, context);
      const location = root === undefined ? undefined : rustRawLocationRoot(root.expression, context);
      if (location === undefined)
        failRustPlannerInvariant("An admitted string append requires its selected promoted receiver.", left);
      receiver = { kind: "method-call", receiver: location, method: "borrow_mut", args: [] };
    }
    if (receiver === undefined) failRustPlannerInvariant("An admitted string append requires its selected native receiver.", left);
    return append.parts.map(part => {
      const argument: RustExpr | undefined = part.kind === "character" ? { kind: "char-literal", value: part.value }
        : part.kind === "literal" ? { kind: "str-literal", value: part.value }
        : planExpression(part.expression, context, "value", "shared-reference");
      if (argument === undefined) failRustPlannerInvariant("An admitted string append requires its selected source operand.", valueNode);
      return { kind: "expr", expr: { kind: "method-call", receiver, receiverMode: "mut-ref",
        method: part.kind === "character" ? rustStringPushMethod : rustStringPushStrMethod, args: [argument] } };
    });
  }
  const value = planExpression(valueNode, context);
  if (value === undefined) failRustPlannerInvariant("An admitted assignment requires its native value plan.", valueNode);
  if (fact.kind === "operator-call") {
    return planRustDirectOperatorCallAssignment(left, target, value, fact, context)
      ?? failRustPlannerInvariant("An admitted operator assignment requires its native write plan.", left);
  }
  if (operator === "+=" && isRustStringCarrier(fact.resultCarrier)) {
    if (context.syntheticNames === undefined) {
      failRustPlannerInvariant(
        "String compound assignment requires one finalized hygienic-name scope.",
        expression,
      );
    }
    const currentName = allocateRustSyntheticName(context.syntheticNames, "current");
    const concatenated = rustStringConcat([
      { kind: "value", value: { kind: "path", path: currentName } },
      planRustStringConcatOperand(valueNode, value, context),
    ]);
    const promotedLocation = planRustPromotedStorageLocation(
      left,
      context,
      planExpression,
    );
    if (promotedLocation.kind === "promoted") {
      if (promotedLocation.expression === undefined) {
        failRustPlannerInvariant("An admitted string assignment requires its native promoted location plan.", left);
      }
      const locationName = allocateRustSyntheticName(context.syntheticNames, "location");
      const nextName = allocateRustSyntheticName(context.syntheticNames, "next");
      const location: RustExpr = { kind: "path", path: locationName };
      return [{
        kind: "expr",
        expr: rustValueBlock([
            { name: locationName, value: promotedLocation.expression },
            {
              name: currentName,
              value: promotedLocation.read(location),
            },
            { name: nextName, value: concatenated },
          ], promotedLocation.write(location, { kind: "path", path: nextName })),
      }];
    }
    if (target === undefined) failRustPlannerInvariant("An admitted string assignment requires its native storage plan.", left);
    const selection = context.input.program.records.assignmentValue.get(left);
    if (selection === undefined) failRustPlannerInvariant("An admitted string assignment requires its previous-value ownership.", left);
    const previous: RustExpr = selection.previous.kind === "clone"
      ? { kind: "method-call", receiver: target, method: "clone", args: [] }
      : selection.previous.kind === "borrow" ? { kind: "reference", expr: target, mutable: selection.previous.mutable } : target;
    return [{
      kind: "expr",
      expr: rustValueBlock([
          {
            name: currentName,
            value: previous,
          },
        ], { kind: "assignment", operator: "=", target, value: concatenated }),
    }];
  }
  if (operator === "=") {
    const moduleStore = planRustModuleBindingStore(left, value, context);
    if (moduleStore !== undefined) return [{ kind: "expr", expr: moduleStore }];
  }
  const promoted = planRustPromotedStorageWrite(
    left,
    operator,
    value,
    context,
    planExpression,
  );
  if (promoted.handled) {
    if (promoted.statement === undefined) failRustPlannerInvariant("An admitted promoted assignment requires its native write plan.", left);
    return [promoted.statement];
  }
  if (target === undefined) {
    failRustPlannerInvariant("An admitted assignment requires its direct, promoted or module storage plan.", left);
  }
  return [{ kind: "assign", target, operator, value }];
}

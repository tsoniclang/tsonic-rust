import {
  KindIdentifier,
  KindNumericLiteral,
  KindParenthesizedExpression,
  KindPostfixUnaryExpression,
  ElementAccessExpression_ArgumentExpression,
  Node_Expression,
  Node_Operand,
} from "@tsonic/target-api/source";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { diagnosticInput } from "../../program/plan-context.js";
import { expressionCarrier, negateRustPlannedBooleanExpression, planNumericLiteralWithCarrier, requireExpressionCarrier, rustOperationFact, selectedOperationMatches } from "../fundamentals.js";
import { findRustUpdateProjectField, planRustBorrowedUpdateLocation, planRustDirectUpdateTarget, planRustOwnedUpdateLocation, planRustSourceFieldUpdate, planRustUpdateProjectionArguments, planRustUpdateValue } from "./target.js";
import { finishRustSourceAccessorCall, planRustSourceAccessorCall, sourceAccessorSelectedOperationMatches, sourceIndexSelectedOperationMatches, sourceStaticFieldSelectedOperationMatches, sourceUnionFieldSelectedOperationMatches } from "../properties.js";
import { isRustBigIntCarrier } from "../../../../policy/types/target-types.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../../diagnostics.js";
import { mutateRustStoredObjectField, rustProjectObjectRepresentation } from "../../objects/project-storage.js";
import { planExpression } from "../entry.js";
import { planRustMutableProjectReceiver, planRustSharedReceiver, planRustPromotedStorageLocation } from "../typed-locations.js";
import { planRustSourceUnionFieldProjection } from "../unions.js";
import { readRustProjectObjectIndex, writeRustProjectObjectIndex } from "../../objects/project-objects.js";
import { rustSourceStaticFieldLocation } from "../../declarations/static-field-storage.js";
import { rustTargetOperationFactKey } from "../../../../analysis/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../../policy/types/equality.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../../rust-ast/nodes.js";
import type { RustExpressionResultUse } from "../entry.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../../analysis/facts/keys.js";

export function planUnaryExpression(
  node: Node,
  context: RustPlanContext,
  resultUse: RustExpressionResultUse,
): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  const operandNode = Node_Operand(context.input.ast, node);
  if (fact !== undefined && fact.kind === "source-conversion" && fact.conversion === undefined) {
    if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.operator-carrier")) {
      return undefined;
    }
    if (!selectedOperationMatches(
      context.input.facts.getSelectedTargetOperator(node),
      fact.operationId,
      "operator",
      fact.resultCarrier,
      fact.operationId,
    )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.operator-selected-evidence",
        "Unary identity operation conflicts with the TSTS-selected operator fact.",
      ));
      return undefined;
    }
    return operandNode === undefined
      ? undefined
      : context.input.ast.kindName(operandNode) === KindNumericLiteral
        ? planNumericLiteralWithCarrier(operandNode, fact.resultCarrier, context)
        : planExpression(operandNode, context);
  }
  if (fact === undefined || fact.kind !== "operator-token") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.operator",
      "Unary expression requires a finalized Rust operator fact.",
    ));
    return undefined;
  }
  if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.operator-carrier")) {
    return undefined;
  }
  if (!selectedOperationMatches(
    context.input.facts.getSelectedTargetOperator(node),
    fact.operationId,
    "operator",
    fact.resultCarrier,
    fact.operator,
  )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.operator-selected-evidence",
      "Unary Rust operator fact conflicts with the TSTS-selected operator fact.",
    ));
    return undefined;
  }
  if (fact.operator !== "-" && fact.operator !== "!") {
    if ((fact.operator === "+=" || fact.operator === "-=") && operandNode !== undefined) {
      return planRustUpdateExpression(node, operandNode, fact, resultUse, context);
    }
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.operator",
      `Unary operator '${fact.operator}' is only supported in statement position.`,
    ));
    return undefined;
  }
  const operand = operandNode === undefined
    ? undefined
    : context.input.ast.kindName(operandNode) === KindNumericLiteral
      ? planNumericLiteralWithCarrier(operandNode, fact.resultCarrier, context)
      : planExpression(operandNode, context);
  return operand === undefined
    ? undefined
    : fact.operator === "!"
      ? negateRustPlannedBooleanExpression(operandNode, operand, context)
      : { kind: "unary", operator: fact.operator, operand };
}

function planRustUpdateExpression(
  expression: Node,
  operand: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>,
  resultUse: RustExpressionResultUse,
  context: RustPlanContext,
): RustExpr | undefined {
  if ((fact.operator !== "+=" && fact.operator !== "-=") ||
    context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.update-name-state",
      "Increment/decrement lowering requires the compilation-owned synthetic-name state.",
    ));
    return undefined;
  }
  const step: RustExpr = isRustBigIntCarrier(fact.resultCarrier)
    ? {
        kind: "call",
        path: "rt::BigInt::from_decimal_literal",
        args: [{ kind: "str-literal", value: "1" }],
      }
    : fact.resultCarrier.kind === "source-primitive" &&
        (fact.resultCarrier.name === "float32" || fact.resultCarrier.name === "float64")
      ? { kind: "float-literal", text: "1.0" }
      : { kind: "int-literal", text: "1" };
  if (isRustBigIntCarrier(fact.resultCarrier)) {
    context.usedAliases?.add("rt");
  }
  const returnsPrevious = resultUse === "value" &&
    context.input.ast.kindName(expression) === KindPostfixUnaryExpression;
  const sourceAccessor = findRustUpdateSourceAccessor(operand, context);
  if (sourceAccessor !== undefined) {
    return planRustSourceAccessorUpdate(
      sourceAccessor.expression,
      sourceAccessor.fact,
      fact,
      step,
      returnsPrevious,
      context,
    );
  }
  const sourceStaticField = findRustUpdateSourceStaticField(operand, context);
  if (sourceStaticField !== undefined) {
    if (!sourceStaticFieldSelectedOperationMatches(
        sourceStaticField.expression,
        sourceStaticField.fact,
        context,
      )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, sourceStaticField.expression),
        "rust.backend.source-static-field-selected-evidence",
        "Project static-field update conflicts with the TSTS-selected property fact.",
      ));
      return undefined;
    }
    const location = rustSourceStaticFieldLocation(sourceStaticField.fact, context);
    return location === undefined
      ? undefined
      : planRustOwnedUpdateLocation(
          location,
          fact,
          step,
          returnsPrevious,
          context,
        );
  }
  const sourceIndex = findRustUpdateSourceIndex(operand, context);
  if (sourceIndex !== undefined) {
    return planRustSourceIndexUpdate(
      sourceIndex.expression,
      sourceIndex.fact,
      fact,
      step,
      returnsPrevious,
      context,
    );
  }
  const sourceField = findRustUpdateProjectField(operand, context);
  if (sourceField !== undefined) {
    return sourceField.fact.kind === "source-union-field"
      ? planRustSourceUnionFieldUpdate(
          operand,
          sourceField.expression,
          sourceField.fact,
          fact,
          step,
          returnsPrevious,
          context,
        )
      : planRustSourceFieldUpdate(
          operand,
          sourceField.expression,
          sourceField.fact,
          fact,
          step,
          returnsPrevious,
          context,
        );
  }
  const promoted = planRustPromotedStorageLocation(
    operand,
    context,
    planExpression,
  );
  if (promoted.kind === "promoted") {
    return promoted.expression === undefined
      ? undefined
      : planRustOwnedUpdateLocation(
          promoted.expression,
          fact,
          step,
          returnsPrevious,
          context,
        );
  }
  const target = planRustDirectUpdateTarget(operand, context);
  if (target === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.update-location",
      "Increment/decrement requires a finalized writable Rust location.",
    ));
    return undefined;
  }
  if (resultUse === "discarded" &&
    context.input.ast.kindName(operand) === KindIdentifier) {
    return {
      kind: "assignment",
      operator: fact.operator,
      target,
      value: step,
    };
  }
  return planRustBorrowedUpdateLocation(
    target,
    fact,
    step,
    returnsPrevious,
    context,
  );
}

function findRustUpdateSourceIndex(
  operand: Node,
  context: RustPlanContext,
): {
  readonly expression: Node;
  readonly fact: Extract<RustTargetOperationFact, { readonly kind: "source-index-signature" }>;
} | undefined {
  let current: Node | undefined = operand;
  while (current !== undefined) {
    const fact = context.input.facts.getFact(current, rustTargetOperationFactKey);
    if (fact?.kind === "source-index-signature") {
      return { expression: current, fact };
    }
    if (context.input.ast.kindName(current) !== KindParenthesizedExpression) {
      return undefined;
    }
    current = Node_Expression(context.input.ast, current);
  }
  return undefined;
}

function planRustSourceIndexUpdate(
  expression: Node,
  index: Extract<RustTargetOperationFact, { readonly kind: "source-index-signature" }>,
  update: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>,
  step: RustExpr,
  returnsPrevious: boolean,
  context: RustPlanContext,
): RustExpr | undefined {
  if (!index.writable || !sourceIndexSelectedOperationMatches(expression, index, context) ||
    !rustTargetTypeRefEquals(index.resultCarrier, update.resultCarrier) ||
    context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.project-index-update-contract",
      "Project index update requires exact writable index, key, value, and update facts.",
    ));
    return undefined;
  }
  const receiverNode = Node_Expression(context.input.ast, expression);
  const keyNode = ElementAccessExpression_ArgumentExpression(context.input.ast, expression);
  const plannedReceiver = receiverNode === undefined
    ? undefined
    : planExpression(receiverNode, context);
  const key = keyNode === undefined ? undefined : planExpression(keyNode, context);
  const representation = rustProjectObjectRepresentation(index.receiverCarrier, context);
  if (receiverNode === undefined || plannedReceiver === undefined || keyNode === undefined ||
    key === undefined || representation === undefined ||
    !rustTargetTypeRefEquals(expressionCarrier(keyNode, context), index.keyCarrier)) {
    return undefined;
  }
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "index_update_receiver");
  const keyName = allocateRustSyntheticName(context.syntheticNames, "index_update_key");
  const receiver: RustExpr = { kind: "path", path: receiverName };
  const selectedKey: RustExpr = { kind: "path", path: keyName };
  return planRustUpdateValue({
    locationBindings: [{
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
    }],
    read: readRustProjectObjectIndex(
      receiver,
      index.storageName,
      selectedKey,
      index.resultCarrier,
      representation,
    ),
    write: (value) => writeRustProjectObjectIndex(
      receiver,
      index.storageName,
      selectedKey,
      value,
      representation,
    ),
    update,
    step,
    returnsPrevious,
    context,
  });
}

function findRustUpdateSourceStaticField(
  operand: Node,
  context: RustPlanContext,
): {
  readonly expression: Node;
  readonly fact: Extract<RustTargetOperationFact, { readonly kind: "source-static-field" }>;
} | undefined {
  let current: Node | undefined = operand;
  while (current !== undefined) {
    const fact = context.input.facts.getFact(current, rustTargetOperationFactKey);
    if (fact?.kind === "source-static-field") {
      return { expression: current, fact };
    }
    if (context.input.ast.kindName(current) !== KindParenthesizedExpression) {
      return undefined;
    }
    current = Node_Expression(context.input.ast, current);
  }
  return undefined;
}

function planRustSourceAccessorUpdate(
  accessorExpression: Node,
  accessor: Extract<RustTargetOperationFact, { readonly kind: "source-accessor" }>,
  update: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>,
  step: RustExpr,
  returnsPrevious: boolean,
  context: RustPlanContext,
): RustExpr | undefined {
  if (!sourceAccessorSelectedOperationMatches(accessorExpression, accessor, context) ||
    accessor.read === undefined || accessor.write === undefined ||
    !rustTargetTypeRefEquals(accessor.read.resultCarrier, update.resultCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, accessorExpression),
      "rust.backend.source-accessor-update",
      "Project accessor update requires exact selected getter, setter, and update carriers.",
    ));
    return undefined;
  }
  if (context.syntheticNames === undefined) {
    return undefined;
  }
  const locationBindings: { name: string; value: RustExpr }[] = [];
  let receiver: RustExpr | undefined;
  if (accessor.receiver.kind === "instance") {
    const receiverNode = Node_Expression(context.input.ast, accessorExpression);
    const plannedReceiver = receiverNode === undefined
      ? undefined
      : planExpression(receiverNode, context);
    if (receiverNode === undefined || plannedReceiver === undefined) {
      return undefined;
    }
    const receiverName = allocateRustSyntheticName(
      context.syntheticNames,
      "accessor_update_receiver",
    );
    locationBindings.push({
      name: receiverName,
      value: planRustSharedReceiver(receiverNode, plannedReceiver, context),
    });
    receiver = { kind: "path", path: receiverName };
  }
  const plannedRead = planRustSourceAccessorCall(
    accessorExpression,
    accessor,
    "read",
    [],
    context,
    receiver,
  );
  const read = plannedRead === undefined
    ? undefined
    : finishRustSourceAccessorCall(
        accessorExpression,
        "read",
        plannedRead,
        context,
      );
  if (read === undefined) {
    return undefined;
  }
  return planRustUpdateValue({
    locationBindings,
    read,
    write: (value) => {
      const plannedWrite = planRustSourceAccessorCall(
        accessorExpression,
        accessor,
        "write",
        [value],
        context,
        receiver,
      );
      return plannedWrite === undefined
        ? undefined
        : finishRustSourceAccessorCall(
            accessorExpression,
            "write",
            plannedWrite,
            context,
          );
    },
    update,
    step,
    returnsPrevious,
    context,
  });
}

export function findRustUpdateSourceAccessor(
  operand: Node,
  context: RustPlanContext,
): {
  readonly expression: Node;
  readonly fact: Extract<RustTargetOperationFact, { readonly kind: "source-accessor" }>;
} | undefined {
  let current: Node | undefined = operand;
  while (current !== undefined) {
    const fact = context.input.facts.getFact(current, rustTargetOperationFactKey);
    if (fact?.kind === "source-accessor") {
      return { expression: current, fact };
    }
    if (context.input.ast.kindName(current) !== KindParenthesizedExpression) {
      return undefined;
    }
    current = Node_Expression(context.input.ast, current);
  }
  return undefined;
}

function planRustSourceUnionFieldUpdate(
  operand: Node,
  fieldExpression: Node,
  field: Extract<RustTargetOperationFact, { readonly kind: "source-union-field" }>,
  update: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>,
  step: RustExpr,
  returnsPrevious: boolean,
  context: RustPlanContext,
): RustExpr | undefined {
  if (!sourceUnionFieldSelectedOperationMatches(fieldExpression, field, context)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, fieldExpression),
      "rust.backend.source-union-field-selected-evidence",
      "Source-union field update conflicts with the TSTS-selected property fact.",
    ));
    return undefined;
  }
  const receiverNode = Node_Expression(context.input.ast, fieldExpression);
  const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
  if (receiver === undefined || context.syntheticNames === undefined) {
    return undefined;
  }
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "union_update_receiver");
  const projection = planRustUpdateProjectionArguments(operand, fieldExpression, context);
  if (projection === undefined) {
    return undefined;
  }
  const projected = planRustSourceUnionFieldProjection(
    fieldExpression,
    { kind: "path", path: receiverName },
    field,
    context,
    (payload, selectedField, variantIndex) => {
      const overrides = new Map(context.expressionOverrides ?? []);
      for (const override of projection.overrides) {
        overrides.set(override.node, override.value);
      }
      const mutate = (storage: RustExpr): RustExpr | undefined => {
          overrides.set(fieldExpression, {
            expression: storage,
            carrier: field.resultCarrier,
            valueForm: "value",
          });
          const target = operand === fieldExpression
            ? storage
            : planRustDirectUpdateTarget(operand, {
                ...context,
                expressionOverrides: overrides,
              }, projection.inputOverrides);
          return target === undefined
            ? undefined
            : planRustBorrowedUpdateLocation(
                target,
                update,
                step,
                returnsPrevious,
                context,
              );
      };
      const mutation = mutateRustStoredObjectField(
        selectedField.storage,
        field.variants[variantIndex]!.carrier,
        payload,
        selectedField.storageIndex,
        mutate,
        context,
      );
      return mutation;
    },
  );
  return projected === undefined
    ? undefined
    : {
        kind: "block",
        bindings: [
          { name: receiverName, value: receiver },
          ...projection.bindings,
        ],
        value: projected,
      };
}

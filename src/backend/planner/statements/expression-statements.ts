import {
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  BinaryExpression_Right,
  KindAsteriskEqualsToken,
  KindMinusEqualsToken,
  KindPercentEqualsToken,
  KindPlusEqualsToken,
  KindSlashEqualsToken,
  KindBinaryExpression,
  KindCallExpression,
  KindDeleteExpression,
  KindEqualsToken,
  KindIdentifier,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindVoidExpression,
  Node_Expression,
} from "@tsonic/target-api/source";
import {
  planRustMutableProjectReceiver,
  planRustNonConsumingValue,
  planRustPromotedStorageLocation,
  planRustPromotedStorageWrite,
  planRustSharedReceiver,
} from "../expressions/typed-locations.js";
import {
  rustTargetOperationFactKey,
} from "../../../analysis/facts/keys.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { diagnosticInput } from "../program/plan-context.js";
import {
  isRustAssignmentOperator,
  rustStringPushMethod,
  rustStringPushStrMethod,
} from "../../../target-model/syntax/tokens.js";
import { singleRustUnicodeScalar } from "../../../target-model/syntax/literals.js";
import { isRustStringCarrier } from "../../../target-model/types/index.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planExpression, sourceFieldSelectedOperationMatches, sourceUnionFieldSelectedOperationMatches } from "../expressions/index.js";
import { planRuntimeSetStatement, selectedOperatorMatches } from "./iteration.js";
import { planRustCompoundAssignmentValue, planRustDirectOperatorCallAssignment, planRustSourceAccessorAssignment, planRustSourceIndexAssignment, planRustSourceMethodPropertyAssignment, planRustSourceStaticFieldAssignment } from "./assignments.js";
import { planRustSourceUnionFieldProjection } from "../expressions/unions.js";
import { readRustProjectDispatchedField, writeRustProjectDispatchedField } from "../objects/project-objects.js";
import { planRustProjectFieldDispatchRoles } from "../objects/project-field-dispatch.js";
import { readRustStoredObjectField, writeRustStoredObjectField } from "../objects/project-storage.js";
import { rustStringConcat } from "../../target-ast/expressions.js";
import { planRustDirectStorage } from "../expressions/updates/target.js";
import type { Node } from "@tsonic/tsts";
import type { RustAssignmentOperationFact } from "./core.js";
import type { RustExpr, RustStmt } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";

export function planExpressionStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const expression = Node_Expression(context.input.program.source.ast, node);
  return expression === undefined
    ? undefined
    : planExpressionAsStatement(expression, context);
}

export function planExpressionAsStatement(
  expression: Node,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const { ast } = context.input.program.source;
  const expressionKind = ast.kindName(expression);
  if (expressionKind === KindBinaryExpression) {
    const operatorToken = BinaryExpression_OperatorToken(context.input.program.source.ast, expression);
    const operatorKind = operatorToken === undefined ? "" : ast.kindName(operatorToken);
    const compoundTokens = [
      KindPlusEqualsToken,
      KindMinusEqualsToken,
      KindAsteriskEqualsToken,
      KindSlashEqualsToken,
      KindPercentEqualsToken,
    ];
    let selectedAssignmentFact: RustAssignmentOperationFact | undefined;
    if (operatorKind === KindEqualsToken) {
      const assignment = context.input.program.facts.getFact(expression, rustTargetOperationFactKey);
      if (assignment !== undefined && assignment.kind === "runtime-set") {
        return planRuntimeSetStatement(expression, assignment, context);
      }
      if (assignment === undefined || assignment.kind !== "operator-token" ||
        !["=", "+=", "-=", "*=", "/=", "%="].includes(assignment.operator)) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.assignment",
          "Assignment requires a finalized Rust assignment fact.",
        ));
        return undefined;
      }
      if (!selectedOperatorMatches(expression, assignment, context)) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.assignment-selected-evidence",
          "Assignment operation fact conflicts with the TSTS-selected operator fact.",
        ));
        return undefined;
      }
      selectedAssignmentFact = assignment;
    }
    if (operatorKind === KindEqualsToken || compoundTokens.includes(operatorKind)) {
      const left = BinaryExpression_Left(context.input.program.source.ast, expression);
      const right = BinaryExpression_Right(context.input.program.source.ast, expression);
      if (left === undefined || right === undefined) {
        return undefined;
      }
      const sourceField = context.input.program.facts.getFact(left, rustTargetOperationFactKey);
      const storageOverride = context.expressionOverrides?.get(left);
      const target = planRustDirectStorage(left, context);
      if (target === undefined && sourceField?.kind !== "source-accessor" &&
        sourceField?.kind !== "source-static-field" &&
        sourceField?.kind !== "source-field" &&
        sourceField?.kind !== "source-index-signature" &&
        sourceField?.kind !== "source-method-property" &&
        sourceField?.kind !== "source-union-field") {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.assignment",
          "Assignments require a plain binding or a finalized direct Rust location.",
        ));
        return undefined;
      }
      const fact = selectedAssignmentFact ??
        context.input.program.facts.getFact(expression, rustTargetOperationFactKey);
      if (fact === undefined || (fact.kind !== "operator-token" && fact.kind !== "operator-call")) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.operator",
          "Compound assignment requires a finalized Rust operator fact.",
        ));
        return undefined;
      }
      if (!selectedOperatorMatches(expression, fact, context)) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.operator-selected-evidence",
          "Compound assignment fact conflicts with the TSTS-selected operator fact.",
        ));
        return undefined;
      }
      const operator = fact.operator;
      if (!isRustAssignmentOperator(operator)) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.assignment-operator",
          "Finalized assignment fact does not contain a Rust assignment operator.",
        ));
        return undefined;
      }
      const valueNode = operatorKind === KindEqualsToken && operator !== "="
        ? BinaryExpression_Right(context.input.program.source.ast, right)
        : right;
      if (valueNode === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.assignment-shape",
          "Finalized equivalent assignment requires the proven binary value operand.",
        ));
        return undefined;
      }
      if (sourceField?.kind === "source-accessor") {
        return planRustSourceAccessorAssignment(
          left,
          valueNode,
          sourceField,
          fact,
          context,
        );
      }
      if (sourceField?.kind === "source-method-property") {
        return planRustSourceMethodPropertyAssignment(
          left,
          valueNode,
          sourceField,
          fact,
          context,
        );
      }
      if (sourceField?.kind === "source-static-field") {
        return planRustSourceStaticFieldAssignment(
          left,
          valueNode,
          sourceField,
          fact,
          context,
        );
      }
      if (sourceField?.kind === "source-union-field") {
        if (!sourceUnionFieldSelectedOperationMatches(left, sourceField, context)) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, left),
            "rust.backend.source-union-field-selected-evidence",
            "Source-union field assignment conflicts with the TSTS-selected property fact.",
          ));
          return undefined;
        }
        const receiverNode = Node_Expression(ast, left);
        const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
        if (receiverNode === undefined || receiver === undefined || context.syntheticNames === undefined) {
          return undefined;
        }
        const syntheticNames = context.syntheticNames;
        const receiverName = allocateRustSyntheticName(syntheticNames, "union_receiver");
        const value = planExpression(valueNode, context);
        if (value === undefined) {
          return undefined;
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
              const current = readRustStoredObjectField(
                field.storage,
                receiverCarrier,
                payload,
                field.storageIndex,
                fact.resultCarrier,
                context,
              );
              const written = writeRustStoredObjectField(
                field.storage,
                receiverCarrier,
                payload,
                field.storageIndex,
                "=",
                { kind: "path", path: nextName },
                context,
              );
              return next === undefined || current === undefined || written === undefined
                ? undefined
                : {
                    kind: "block",
                    bindings: [
                      {
                        name: currentName,
                        value: current,
                      },
                      { name: valueName, value },
                      { name: nextName, value: next },
                    ],
                    value: written,
                  };
            }
            const selectedValue: RustExpr = { kind: "path", path: valueName };
            if (operator === "+=" && isRustStringCarrier(fact.resultCarrier)) {
              const currentName = allocateRustSyntheticName(
                syntheticNames,
                "union_current",
              );
              const current = readRustStoredObjectField(
                field.storage,
                receiverCarrier,
                payload,
                field.storageIndex,
                fact.resultCarrier,
                context,
              );
              if (current === undefined) {
                return undefined;
              }
              const written = writeRustStoredObjectField(
                field.storage,
                receiverCarrier,
                payload,
                field.storageIndex,
                "=",
                rustStringConcat([
                  { kind: "path", path: currentName },
                  selectedValue,
                ]),
                context,
              );
              if (written === undefined) {
                return undefined;
              }
              return {
                kind: "block",
                bindings: [{
                  name: currentName,
                  value: current,
                }],
                value: written,
              };
            }
            return writeRustStoredObjectField(
              field.storage,
              receiverCarrier,
              payload,
              field.storageIndex,
              operator,
              selectedValue,
              context,
            );
          },
        );
        return projected === undefined
          ? undefined
          : [{
              kind: "expr",
              expr: {
                kind: "block",
                bindings: [
                  { name: receiverName, value: planRustSharedReceiver(receiverNode, receiver, context) },
                  ...(fact.kind === "operator-token" ? [{ name: valueName, value }] : []),
                ],
                value: projected,
              },
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
        );
      }
      if (storageOverride?.valueForm !== "storage" && sourceField?.kind === "source-field") {
        if (sourceField.fieldLayout === "native-union" && operator !== "=" &&
          (context.explicitUnsafeContextDepth ?? 0) === 0) {
          context.diagnostics.push({
            code: "RUST_NATIVE_UNION_FIELD_UNSAFE_CONTEXT_REQUIRED",
            category: "error",
            source: "tsonic-rust",
            message: "Reading a native Rust union field during compound assignment requires an explicit unsafeContext() source region.",
            sourceNode: left,
          });
          return undefined;
        }
        if (!sourceFieldSelectedOperationMatches(left, sourceField, context)) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, left),
            "rust.backend.source-field-selected-evidence",
            "Project-source field assignment conflicts with the TSTS-selected property fact.",
          ));
          return undefined;
        }
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
          return undefined;
        }
        if (context.syntheticNames === undefined) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, left),
            "rust.backend.project-field-temporary",
            "Project-source field assignment requires a finalized hygienic-name scope.",
          ));
          return undefined;
        }
        const dispatchPlan = sourceField.dispatch === undefined
          ? undefined
          : sourceField.declaration === undefined
            ? undefined
            : context.input.program.projectFieldDispatch.planFor(sourceField.declaration);
        if (sourceField.dispatch !== undefined && dispatchPlan?.write === undefined) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, left),
            "rust.backend.project-field-dispatch-plan",
            "Project-source field assignment has no exact finalized writable dispatch plan.",
          ));
          return undefined;
        }
        const dispatchRoles = dispatchPlan === undefined
          ? undefined
          : planRustProjectFieldDispatchRoles(dispatchPlan, context);
        if ((dispatchPlan !== undefined && dispatchRoles === undefined) ||
          (dispatchPlan?.write !== undefined && dispatchRoles?.write === undefined)) {
          return undefined;
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
              )
            : readRustProjectDispatchedField(
                selectedReceiver,
                sourceField.dispatch.read,
                dispatchReadRole!,
              );
          const value = planExpression(valueNode, context);
          if (value === undefined) {
            return undefined;
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
            return undefined;
          }
          return [{
            kind: "expr",
            expr: {
              kind: "block",
              bindings: [
                { name: receiverName, value: receiver },
                { name: currentName, value: current },
                { name: valueName, value },
                { name: nextName, value: next },
              ],
              value: written,
            },
          }];
        }
        const value = planExpression(valueNode, context);
        if (value === undefined) {
          return undefined;
        }
        if (fact.kind === "operator-token" && operator === "=" &&
          sourceField.dispatch === undefined &&
          ast.kindName(receiverNode) === KindIdentifier && plannedReceiver?.kind === "path" &&
          ast.kindName(valueNode) === KindIdentifier && value.kind === "path") {
          const direct = writeRustStoredObjectField(
            sourceField.storage,
            sourceField.receiverCarrier,
            plannedReceiver,
            sourceField.storageIndex,
            operator,
            value,
            context,
          );
          if (direct !== undefined) {
            return [{ kind: "expr", expr: direct }];
          }
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
              )
            : readRustProjectDispatchedField(
                selectedReceiver,
                sourceField.dispatch.read,
                dispatchReadRole!,
              );
          const concatenated = rustStringConcat([
            { kind: "path", path: currentName },
            value,
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
            return undefined;
          }
          return [{
            kind: "expr",
            expr: {
              kind: "block",
              bindings: [
                { name: receiverName, value: receiver },
                { name: currentName, value: current },
              ],
              value: written,
            },
          }];
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
          return undefined;
        }
        return [{
          kind: "expr",
          expr: {
            kind: "block",
            bindings: [
              { name: receiverName, value: receiver },
              { name: valueName, value },
            ],
            value: written,
          },
        }];
      }
      const value = planExpression(valueNode, context);
      if (value === undefined || target === undefined) {
        return undefined;
      }
      if (fact.kind === "operator-call") {
        return planRustDirectOperatorCallAssignment(
          left,
          target,
          value,
          fact,
          context,
        );
      }
      if (operator === "+=" && isRustStringCarrier(fact.resultCarrier)) {
        if (fact.writeStrategy === "in-place-string-append-parts" ||
          fact.writeStrategy === "in-place-string-append-value") {
          return planInPlaceStringAppend(
            target,
            planRustNonConsumingValue(valueNode, value, context),
            fact.writeStrategy === "in-place-string-append-parts",
          );
        }
        if (context.syntheticNames === undefined) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, expression),
            "rust.backend.string-append-temporary",
            "String compound assignment requires one finalized hygienic-name scope.",
          ));
          return undefined;
        }
        const currentName = allocateRustSyntheticName(context.syntheticNames, "current");
        const concatenated = rustStringConcat([
          { kind: "path", path: currentName },
          value,
        ]);
        const promotedLocation = planRustPromotedStorageLocation(
          left,
          context,
          planExpression,
        );
        if (promotedLocation.kind === "promoted") {
          if (promotedLocation.expression === undefined) {
            return undefined;
          }
          const locationName = allocateRustSyntheticName(context.syntheticNames, "location");
          const location: RustExpr = { kind: "path", path: locationName };
          return [{
            kind: "expr",
            expr: {
              kind: "block",
              bindings: [
                { name: locationName, value: promotedLocation.expression },
                {
                  name: currentName,
                  value: { kind: "method-call", receiver: location, method: "load", args: [] },
                },
              ],
              value: {
                kind: "method-call",
                receiver: location,
                method: "store",
                args: [concatenated],
              },
            },
          }];
        }
        if (ast.kindName(left) !== KindIdentifier) {
          context.diagnostics.push(unsupportedConstructDiagnostic(
            diagnosticInput(context, expression),
            "rust.backend.string-append-location",
            "String compound assignment requires a binding or finalized Rust location plan.",
          ));
          return undefined;
        }
        return [{
          kind: "expr",
          expr: {
            kind: "block",
            bindings: [
              {
                name: currentName,
                value: { kind: "method-call", receiver: target, method: "clone", args: [] },
              },
            ],
            value: { kind: "assignment", operator: "=", target, value: concatenated },
          },
        }];
      }
      const promoted = planRustPromotedStorageWrite(
        left,
        operator,
        value,
        context,
        planExpression,
      );
      if (promoted.handled) {
        return promoted.statement === undefined ? undefined : [promoted.statement];
      }
      return operator === "+=" || operator === "-=" || operator === "*=" || operator === "/=" || operator === "%="
        ? [{ kind: "assign", target, operator, value }]
        : operator === "="
          ? [{ kind: "assign", target, operator, value }]
          : undefined;
    }
  }
  if (expressionKind === KindPostfixUnaryExpression || expressionKind === KindPrefixUnaryExpression) {
    const planned = planExpression(expression, context, "discarded");
    return planned === undefined ? undefined : [{ kind: "expr", expr: planned }];
  }
  if (expressionKind === KindCallExpression || expressionKind === "KindAwaitExpression" ||
    expressionKind === "KindYieldExpression" || expressionKind === KindDeleteExpression ||
    expressionKind === KindVoidExpression) {
    const planned = planExpression(expression, context, "discarded");
    return planned === undefined ? undefined : [{ kind: "expr", expr: planned }];
  }
  const planned = planExpression(expression, context);
  return planned === undefined
    ? undefined
    : [{ kind: "let", name: "_", mutable: false, init: planned }];
}

function planInPlaceStringAppend(
  target: RustExpr,
  value: RustExpr,
  flattenParts: boolean,
): readonly RustStmt[] {
  const parts = flattenParts && value.kind === "string-concat"
    ? value.parts
    : [value];
  return parts.map((part) => {
    const character = (part.kind === "string-literal" ||
        part.kind === "str-literal")
      ? singleRustUnicodeScalar(part.value)
      : undefined;
    return {
      kind: "expr" as const,
      expr: {
        kind: "method-call" as const,
        receiver: target,
        receiverMode: "mut-ref" as const,
        method: character === undefined
          ? rustStringPushStrMethod
          : rustStringPushMethod,
        args: [character === undefined
          ? planStringAppendArgument(part)
          : { kind: "char-literal" as const, value: character }],
      },
    };
  });
}

function planStringAppendArgument(value: RustExpr): RustExpr {
  if (value.kind === "owned-string-from-borrowed-str") {
    return value.expression;
  }
  if (value.kind === "string-literal") {
    return { kind: "str-literal", value: value.value };
  }
  if (value.kind === "str-literal" || value.kind === "reference") {
    return value;
  }
  return { kind: "reference", expr: value };
}

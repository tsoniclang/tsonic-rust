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
  KindArrayBindingPattern,
  KindObjectBindingPattern,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindVoidExpression,
  Node_Expression,
  Node_Initializer,
  Node_Name,
  Node_Type,
} from "@tsonic/target-api/source";
import {
  planRustSharedReceiver,
  planRustPromotedStorageLocation,
  planRustPromotedStorageWrite,
  rustLocationStorageForDeclaration,
} from "../expressions/typed-locations.js";
import {
  rustMutatedBindingFactKey,
  rustMutatedReferentFactKey,
  rustResourceManagementFactKey,
  rustSourceBindingFactKey,
  rustTargetOperationFactKey,
} from "../../../analysis/facts/keys.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { collectVariableDeclarations, resourceDisposalReceiverMode } from "./resources.js";
import { diagnosticInput, isValidRustIdentifier } from "../program/plan-context.js";
import { isRustAssignmentOperator } from "../../model/syntax.js";
import { isRustStringCarrier, rustLocationTargetType, rustOptionElementCarrier } from "../../../policy/types/target-types.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planExpression, sourceFieldSelectedOperationMatches, sourceUnionFieldSelectedOperationMatches } from "../expressions/index.js";
import { planRuntimeSetStatement, selectedOperatorMatches } from "./iteration.js";
import { planRustBindingPattern } from "../bindings/patterns.js";
import { planRustCompoundAssignmentValue, planRustDirectOperatorCallAssignment, planRustSourceAccessorAssignment, planRustSourceIndexAssignment, planRustSourceMethodPropertyAssignment, planRustSourceStaticFieldAssignment } from "./assignments.js";
import { planRustSourceUnionFieldProjection } from "../expressions/unions.js";
import { readRustProjectDispatchedField, writeRustProjectDispatchedField } from "../objects/project-objects.js";
import { readRustStoredObjectField, writeRustStoredObjectField } from "../objects/project-storage.js";
import { requireRustLocationValueCarrier } from "../types/generic-requirements.js";
import { rustStringConcat } from "../../rust-ast/expressions.js";
import { rustTargetOperationIsDirectLocation } from "../../../analysis/facts/target-operation.js";
import { rustTargetTypeRefEquals } from "../../../policy/types/equality.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import type { Node } from "@tsonic/tsts";
import type { RustAssignmentOperationFact } from "./core.js";
import type { RustExpr, RustStmt } from "../../rust-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";

export function planVariableStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const declarations = collectVariableDeclarations(node, context);
  if (declarations.length === 0) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.variable",
      "Variable statement has no exact variable declaration.",
    ));
    return undefined;
  }
  const statements: RustStmt[] = [];
  for (const declaration of declarations) {
    const planned = planVariableDeclaration(declaration, context);
    if (planned === undefined) {
      return undefined;
    }
    statements.push(...planned);
  }
  return statements;
}

function planVariableDeclaration(
  declaration: Node,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const nameNode = Node_Name(context.input.ast, declaration);
  const nameKind = nameNode === undefined ? "" : ast.kindName(nameNode);
  if (nameNode !== undefined && (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern)) {
    return planBindingVariableDeclaration(declaration, nameNode, context);
  }
  const name = context.input.names.nameForDeclaration(declaration) ?? "";
  if (!isValidRustIdentifier(name)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.variable",
      "Variable declarations require a plain identifier that is valid in Rust.",
    ));
    return undefined;
  }
  const initializer = Node_Initializer(context.input.ast, declaration);
  const locationStorage = rustLocationStorageForDeclaration(declaration, context);
  if (initializer === undefined && locationStorage !== undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.typed-location-storage",
      "Promoted Rust location storage requires an initialized source binding.",
    ));
    return undefined;
  }
  const planned = initializer === undefined ? undefined : planExpression(initializer, context);
  if (initializer !== undefined && planned === undefined) {
    return undefined;
  }
  const typeNode = Node_Type(context.input.ast, declaration);
  const annotatedCarrier = typeNode === undefined
    ? undefined
    : context.input.facts.getRuntimeCarrierFact(typeNode)?.carrier;
  let rustType;
  if (typeNode !== undefined) {
    const renderedCarrier = locationStorage === undefined
      ? annotatedCarrier
      : rustLocationTargetType(locationStorage.valueCarrier);
    rustType = rustTypeFromCarrierInContext(renderedCarrier, context);
    if (rustType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, typeNode),
        "rust.backend.variable",
        "Variable type annotation has no supported Rust carrier fact.",
      ));
      return undefined;
    }
  }
  const declarationCarrier = context.input.facts.getRuntimeCarrierFact(declaration)?.carrier;
  if (declarationCarrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.variable-carrier",
      "Variable declaration has no finalized Rust carrier fact.",
    ));
    return undefined;
  }
  if (rustType === undefined) {
    const renderedCarrier = locationStorage === undefined
      ? declarationCarrier
      : rustLocationTargetType(locationStorage.valueCarrier);
    rustType = rustTypeFromCarrierInContext(renderedCarrier, context);
    if (rustType === undefined && initializer === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.variable",
        "Uninitialized variable declaration has no renderable finalized Rust carrier.",
      ));
      return undefined;
    }
  }
  if (locationStorage !== undefined &&
    (!rustTargetTypeRefEquals(declarationCarrier, locationStorage.valueCarrier) ||
      (annotatedCarrier !== undefined &&
        !rustTargetTypeRefEquals(annotatedCarrier, locationStorage.valueCarrier)))) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.typed-location-storage-carrier",
      "Promoted Rust storage conflicts with its finalized declaration carrier.",
    ));
    return undefined;
  }
  const ownedBinding = declarationCarrier.kind !== "pointer" && declarationCarrier.kind !== "reference";
  const resourceFact = context.input.facts.getFact(declaration, rustResourceManagementFactKey);
  const mutable = locationStorage === undefined &&
    (context.input.facts.getFact(declaration, rustMutatedBindingFactKey) !== undefined ||
      (ownedBinding && context.input.facts.getFact(declaration, rustMutatedReferentFactKey) !== undefined) ||
      resourceFact !== undefined && resourceDisposalReceiverMode(resourceFact) === "mut-ref");
  let init: RustExpr | undefined;
  if (initializer !== undefined) {
    if (planned === undefined) {
      return undefined;
    }
    if (locationStorage === undefined) {
      init = planned;
    } else {
      if (!requireRustLocationValueCarrier(
        locationStorage.valueCarrier,
        declaration,
        context,
      )) {
        return undefined;
      }
      context.usedAliases?.add("rt");
      init = { kind: "call", path: "rt::Location::allocate", args: [planned] };
    }
  } else if (rustOptionElementCarrier(declarationCarrier) !== undefined && rustType !== undefined) {
    init = { kind: "associated-value", owner: rustType, name: "None" };
  }
  if (initializer !== undefined && init === undefined) {
    return undefined;
  }
  return [{
    kind: "let",
    name,
    mutable,
    ...(rustType === undefined ? {} : { type: rustType }),
    ...(init === undefined ? {} : { init }),
  }];
}

function planBindingVariableDeclaration(
  declaration: Node,
  pattern: Node,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const initializer = Node_Initializer(context.input.ast, declaration);
  const sourceCarrier = context.input.facts.getRuntimeCarrierFact(declaration)?.carrier;
  if (initializer === undefined || sourceCarrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.binding-declaration",
      "Binding-pattern declaration requires an initializer and one finalized source carrier.",
    ));
    return undefined;
  }
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, pattern),
      "rust.backend.binding-temporary",
      "Binding-pattern declaration requires a finalized hygienic-name scope.",
    ));
    return undefined;
  }
  const value = planExpression(initializer, context);
  if (value === undefined) {
    return undefined;
  }
  const temporary = allocateRustSyntheticName(context.syntheticNames, "binding");
  const bindings = planRustBindingPattern(
    pattern,
    { kind: "path", path: temporary },
    sourceCarrier,
    context,
    planExpression,
  );
  return bindings === undefined
    ? undefined
    : [{ kind: "let", name: temporary, mutable: false, init: value }, ...bindings];
}

export function planExpressionStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const expression = Node_Expression(context.input.ast, node);
  return expression === undefined
    ? undefined
    : planExpressionAsStatement(expression, context);
}

export function planExpressionAsStatement(
  expression: Node,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const expressionKind = ast.kindName(expression);
  if (expressionKind === KindBinaryExpression) {
    const operatorToken = BinaryExpression_OperatorToken(context.input.ast, expression);
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
      const assignment = context.input.facts.getFact(expression, rustTargetOperationFactKey);
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
      const left = BinaryExpression_Left(context.input.ast, expression);
      const right = BinaryExpression_Right(context.input.ast, expression);
      if (left === undefined || right === undefined) {
        return undefined;
      }
      const sourceField = context.input.facts.getFact(left, rustTargetOperationFactKey);
      const storageOverride = context.expressionOverrides?.get(left);
      const target = storageOverride?.valueForm === "storage"
        ? storageOverride.expression
        : ast.kindName(left) === KindIdentifier
        ? (() => {
            const declaration = context.input.facts.getFact(
              left,
              rustSourceBindingFactKey,
            )?.sourceDeclaration;
            const path = context.input.names.nameForDeclaration(declaration) ?? "";
            return isValidRustIdentifier(path) ? { kind: "path" as const, path } : undefined;
          })()
        : rustTargetOperationIsDirectLocation(
            context.input.facts.getFact(left, rustTargetOperationFactKey),
          )
          ? planExpression(left, context)
          : undefined;
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
        context.input.facts.getFact(expression, rustTargetOperationFactKey);
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
        ? BinaryExpression_Right(context.input.ast, right)
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
        if (receiver === undefined || context.syntheticNames === undefined) {
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
                  { name: receiverName, value: receiver },
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
          : planRustSharedReceiver(receiverNode, plannedReceiver, context);
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
            : context.input.projectFieldDispatch.planFor(sourceField.declaration);
        if (sourceField.dispatch !== undefined && dispatchPlan?.write === undefined) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, left),
            "rust.backend.project-field-dispatch-plan",
            "Project-source field assignment has no exact finalized writable dispatch plan.",
          ));
          return undefined;
        }
        const dispatchRoles = dispatchPlan?.write === undefined
          ? undefined
          : {
              read: dispatchPlan.read,
              write: dispatchPlan.write,
              errorDomain: context.errorDomain,
            };
        const dispatchReadRole = dispatchPlan === undefined
          ? undefined
          : {
              ...dispatchPlan.read,
              errorDomain: context.errorDomain,
            };
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
                dispatchRoles!,
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
                dispatchRoles!,
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
              dispatchRoles!,
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
    const planned = planExpression(expression, context);
    return planned === undefined ? undefined : [{ kind: "expr", expr: planned }];
  }
  const planned = planExpression(expression, context);
  return planned === undefined
    ? undefined
    : [{ kind: "let", name: "_", mutable: false, init: planned }];
}

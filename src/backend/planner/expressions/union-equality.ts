import type { Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right, BinaryExpression_OperatorToken } from "@tsonic/target-api/source";
import type { RustExpr, RustPattern } from "../../target-ast/nodes.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustUnionEqualityArm } from "../../../target-model/operations/binary.js";
import { isRustAbsenceCarrier } from "../../../target-model/types/carriers/native.js";
import { rustSourceOptionalElementCarrier } from "../../../target-model/types/carriers/optional.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import { rustUnionEqualityFactMatches } from "../../../analysis/facts/operations/union-equality.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustUnionPattern } from "./union-patterns.js";
import { planExpression } from "./entry.js";
import { effectivePlannedExpressionCarrier, requireExpressionCarrier, selectedOperationMatches } from "./fundamentals.js";
import { applyRustValueConversion } from "./value-conversions.js";
import { planRustOperatorCallExpression } from "./binary.js";
import { negateRustBooleanExpression } from "../../target-ast/expressions.js";

export function planRustUnionEquality(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "union-equality" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  const ast = context.input.program.source.ast;
  const leftNode = BinaryExpression_Left(ast, node);
  const rightNode = BinaryExpression_Right(ast, node);
  const token = BinaryExpression_OperatorToken(ast, node);
  const operator = token === undefined ? undefined : ast.kindName(token);
  if (leftNode === undefined || rightNode === undefined || context.syntheticNames === undefined ||
    !rustUnionEqualityFactMatches(fact, operator, effectivePlannedExpressionCarrier(leftNode, context),
      effectivePlannedExpressionCarrier(rightNode, context), context.input.program.typeDefinitions) ||
    !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.union-equality-result") ||
    !selectedOperationMatches(context.input.program.facts.getSelectedTargetOperator(node),
      fact.operationId, "operator", fact.resultCarrier, fact.operationId)) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.union-equality", "Union comparison requires exact sealed native operands, variants and equality operations."));
    return undefined;
  }
  const left = planExpression(leftNode, context, "value", "shared-reference");
  const right = planExpression(rightNode, context, "value", "shared-reference");
  if (left === undefined || right === undefined) return undefined;
  const arms: Extract<RustExpr, { readonly kind: "match" }>["arms"][number][] = [];
  for (const arm of fact.arms) {
    const leftName = allocateRustSyntheticName(context.syntheticNames, "left");
    const rightName = allocateRustSyntheticName(context.syntheticNames, "right");
    const leftPattern = planEqualityPattern(arm.left, fact.leftCarrier, leftName, context);
    const rightPattern = planEqualityPattern(arm.right, fact.rightCarrier, rightName, context);
    if (leftPattern === undefined || rightPattern === undefined) return undefined;
    if (isRustAbsenceCarrier(arm.left.carrier) && isRustAbsenceCarrier(arm.right.carrier)) {
      arms.push({ pattern: { kind: "tuple", elements: [leftPattern, rightPattern] }, expression: { kind: "bool-literal", value: true } });
      continue;
    }
    const operand = (side: typeof arm.left, name: string): RustExpr => {
      const variant = side.path[side.path.length - 1]?.variant;
      return variant?.kind === "constant" ? { kind: "bool-literal", value: variant.value }
        : { kind: "dereference", pointer: { kind: "path", path: name } };
    };
    const leftValue = operand(arm.left, leftName);
    const rightValue = operand(arm.right, rightName);
    let comparison: RustExpr | undefined;
    if (arm.operation.kind === "operator-call") {
      const argument = (value: RustExpr) => value.kind === "dereference"
        ? { expression: value.pointer, form: "shared-reference" as const }
        : { expression: value, form: "value" as const };
      comparison = planRustOperatorCallExpression({ ...arm.operation, operator: arm.operation.rustOperator,
        operationId: fact.operationId }, argument(leftValue), argument(rightValue), node, context);
    } else {
      const convertedLeft = applyRustValueConversion(context, leftValue, arm.operation.leftConversion, undefined);
      const convertedRight = applyRustValueConversion(context, rightValue, arm.operation.rightConversion, undefined);
      if (convertedLeft === undefined || convertedRight === undefined) return undefined;
      comparison = { kind: "binary", operator: "==", left: convertedLeft, right: convertedRight };
    }
    if (comparison === undefined) return undefined;
    arms.push({ pattern: { kind: "tuple", elements: [leftPattern, rightPattern] }, expression: comparison });
  }
  if (!fact.exhaustive) arms.push({ pattern: { kind: "wildcard" }, expression: { kind: "bool-literal", value: false } });
  const result: RustExpr = { kind: "match", expression: { kind: "tuple-literal", elements: [left, right] }, arms };
  return fact.negated ? negateRustBooleanExpression(result) : result;
}

function planEqualityPattern(
  arm: RustUnionEqualityArm["left"],
  storage: TargetTypeRef,
  name: string,
  context: RustPlanContext,
): RustPattern | undefined {
  const optional = storage.kind === "target-named" && rustSourceOptionalElementCarrier(storage) !== undefined;
  if (arm.path.length === 0 && isRustAbsenceCarrier(arm.carrier)) {
    return optional ? { kind: "path", path: "None" } : { kind: "wildcard" };
  }
  const pattern = planRustUnionPattern(arm.path, { kind: "binding", name }, context);
  return pattern === undefined || !optional ? pattern : { kind: "tuple-variant", path: "Some", elements: [pattern] };
}

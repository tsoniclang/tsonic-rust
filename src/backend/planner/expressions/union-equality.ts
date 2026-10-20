import type { Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import type { RustExpr, RustPattern } from "../../target-ast/syntax/nodes.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations.js";
import type { RustUnionEqualityOperand } from "../../../target-model/records/union-equality.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustUnionPattern } from "./union-patterns.js";
import { planExpression } from "./entry.js";
import { lowerNestedRustValueConversion } from "./value-conversions.js";
import { planRustOperatorCallExpression } from "./binary.js";
import { negateRustPlannedBooleanExpression } from "./fundamentals.js";

export function planRustUnionEquality(node: Node,
  _fact: Extract<RustTargetOperationFact, { readonly kind: "union-equality" }>, context: RustPlanContext): RustExpr {
  const selected = context.input.program.records.unionEquality.get(node)
    ?? failRustPlannerInvariant("An admitted union equality requires its native emission plan.", node);
  const fact = selected.fact;
  const leftNode = BinaryExpression_Left(context.input.program.source.ast, node);
  const rightNode = BinaryExpression_Right(context.input.program.source.ast, node);
  if (leftNode === undefined || rightNode === undefined || context.syntheticNames === undefined)
    failRustPlannerInvariant("An admitted union equality requires its source operands and native binding scope.", node);
  const left = planExpression(leftNode, context, "value", "shared-reference")
    ?? failRustPlannerInvariant("An admitted union equality requires its left operand.", leftNode);
  const right = planExpression(rightNode, context, "value", "shared-reference")
    ?? failRustPlannerInvariant("An admitted union equality requires its right operand.", rightNode);
  const arms: Extract<RustExpr, { readonly kind: "match" }>["arms"][number][] = [];
  for (const arm of selected.arms) {
    const leftName = allocateRustSyntheticName(context.syntheticNames, "left");
    const rightName = allocateRustSyntheticName(context.syntheticNames, "right");
    const leftPattern = planEqualityPattern(arm.left, leftName, context);
    const rightPattern = planEqualityPattern(arm.right, rightName, context);
    const operand = (side: RustUnionEqualityOperand, name: string): RustExpr => side.value.kind === "constant"
      ? { kind: "bool-literal", value: side.value.value } : { kind: "dereference", pointer: { kind: "path", path: name } };
    let comparison: RustExpr | undefined;
    if (arm.constant !== undefined) comparison = { kind: "bool-literal", value: arm.constant };
    else if (arm.booleanOperand !== undefined) {
      const value = arm.booleanOperand.side === "left" ? operand(arm.left, leftName) : operand(arm.right, rightName);
      comparison = arm.booleanOperand.negated ? { kind: "unary", operator: "!", operand: value } : value;
    } else if (arm.operation.kind === "operator-call") {
      const argument = (side: RustUnionEqualityOperand, name: string) => side.value.kind === "borrowed"
        ? { expression: { kind: "path" as const, path: name }, form: "shared-reference" as const }
        : { expression: operand(side, name), form: "value" as const };
      comparison = planRustOperatorCallExpression({ ...arm.operation, operator: arm.operation.rustOperator, operationId: fact.operationId },
        argument(arm.left, leftName), argument(arm.right, rightName), node, context);
    } else {
      const left = operand(arm.left, leftName);
      const right = operand(arm.right, rightName);
      const convertedLeft = arm.leftConversion === undefined ? left : lowerNestedRustValueConversion(arm.leftConversion, left, context, node);
      const convertedRight = arm.rightConversion === undefined ? right : lowerNestedRustValueConversion(arm.rightConversion, right, context, node);
      if (convertedLeft === undefined || convertedRight === undefined)
        failRustPlannerInvariant("An admitted union equality arm requires its native conversions.", node);
      comparison = { kind: "binary", operator: "==", left: convertedLeft, right: convertedRight };
    }
    if (comparison === undefined) failRustPlannerInvariant("An admitted union equality arm requires its native comparison.", node);
    arms.push({ pattern: { kind: "tuple", elements: [leftPattern, rightPattern] }, expression: comparison });
  }
  const input: RustExpr = { kind: "tuple-literal", elements: [left, right] };
  let result: RustExpr;
  if (selected.form === "constant") result = { kind: "evaluate-then", effect: input, discard: "value", value: { kind: "bool-literal", value: fact.exhaustive } };
  else if (selected.form === "matches") result = { kind: "matches", expression: input,
    pattern: arms.length === 1 ? arms[0]!.pattern : { kind: "or", alternatives: arms.map(arm => arm.pattern) } };
  else {
    if (!fact.exhaustive) arms.push({ pattern: { kind: "wildcard" }, expression: { kind: "bool-literal", value: false } });
    result = { kind: "match", expression: input, arms };
  }
  return fact.negated ? negateRustPlannedBooleanExpression(node, result, context) : result;
}

function planEqualityPattern(side: RustUnionEqualityOperand, name: string, context: RustPlanContext): RustPattern {
  if (side.arm.path.length === 0 && side.absence) return side.optional ? { kind: "path", path: "None" } : { kind: "wildcard" };
  const pattern = planRustUnionPattern(side.arm.path, side.absence ? { kind: "wildcard" } : { kind: "binding", name }, context)
    ?? failRustPlannerInvariant("An admitted union equality operand requires its native pattern.", context.callableDeclaration ?? context.sourceFile);
  return side.optional ? { kind: "tuple-variant", path: "Some", elements: [pattern] } : pattern;
}

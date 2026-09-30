import type { Node } from "@tsonic/tsts";
import type { RustSwitchComparison } from "../../../target-model/operations/switch.js";
import type { RustExpr, RustPattern } from "../../target-ast/nodes.js";
import { negateRustBooleanExpression, rustBorrowedStringView } from "../../target-ast/expressions.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { applyRustValueConversion } from "../expressions/value-conversions.js";
import { planRustOperatorCallExpression } from "../expressions/binary.js";

export function planRustSwitchComparison(
  left: RustExpr,
  right: RustExpr,
  comparison: RustSwitchComparison,
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  const evaluate = (effect: RustExpr, value: RustExpr): RustExpr => ({
    kind: "evaluate-then", effect, discard: "value", value,
  });
  if (comparison.kind === "constant") {
    return evaluate(left, evaluate(right, { kind: "bool-literal", value: comparison.value }));
  }
  if (comparison.kind === "absence") {
    const receiver = comparison.operand === "left" ? left : right;
    const check: RustExpr = { kind: "option-presence", receiver, present: false };
    return comparison.operand === "left" ? evaluate(right, check) : evaluate(left, check);
  }
  const borrowedRight = rustBorrowedStringView(right);
  const rightValue: RustExpr = borrowedRight.kind === "string-literal"
    ? { kind: "str-literal", value: borrowedRight.value } : borrowedRight;
  const operation = comparison.operation;
  if (!comparison.leftOptional && !comparison.rightOptional) {
    if (rightValue.kind === "bool-literal") return rightValue.value ? left : negateRustBooleanExpression(left);
    if (operation.kind === "operator-call") return planRustOperatorCallExpression(
      { ...operation, operator: operation.rustOperator, operationId: "tsonic.rust.control.switch.strict-equality" },
      { expression: left, form: "value" }, { expression: rightValue, form: "value" }, node, context);
    const convertedLeft = applyRustValueConversion(context, left, operation.leftConversion, undefined);
    const convertedRight = applyRustValueConversion(context, rightValue, operation.rightConversion, undefined);
    return convertedLeft === undefined || convertedRight === undefined ? undefined : {
      kind: "binary", operator: "==", left: convertedLeft, right: convertedRight,
    };
  }
  if (context.syntheticNames === undefined) return undefined;
  const leftName = allocateRustSyntheticName(context.syntheticNames, "switch_left");
  const rightName = allocateRustSyntheticName(context.syntheticNames, "switch_right");
  const pattern = (name: string, optional: boolean): RustPattern => optional
    ? { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name }] }
    : { kind: "binding", name };
  const leftReference: RustExpr = { kind: "path", path: leftName };
  const rightReference: RustExpr = { kind: "path", path: rightName };
  let value: RustExpr | undefined;
  if (operation.kind === "operator-call") {
    value = planRustOperatorCallExpression(
      { ...operation, operator: operation.rustOperator, operationId: "tsonic.rust.control.switch.strict-equality" },
      { expression: leftReference, form: "shared-reference" },
      { expression: rightReference, form: "shared-reference" }, node, context);
  } else {
    const convertedLeft = applyRustValueConversion(context,
      { kind: "dereference", pointer: leftReference }, operation.leftConversion, undefined);
    const convertedRight = applyRustValueConversion(context,
      { kind: "dereference", pointer: rightReference }, operation.rightConversion, undefined);
    if (convertedLeft !== undefined && convertedRight !== undefined) {
      value = { kind: "binary", operator: "==", left: convertedLeft, right: convertedRight };
    }
  }
  if (value === undefined) return undefined;
  const arms: { readonly pattern: RustPattern; readonly expression: RustExpr }[] = [{
    pattern: { kind: "tuple", elements: [pattern(leftName, comparison.leftOptional), pattern(rightName, comparison.rightOptional)] },
    expression: value,
  }];
  if (comparison.leftOptional && comparison.rightOptional) arms.push({
    pattern: { kind: "tuple", elements: [{ kind: "path", path: "None" }, { kind: "path", path: "None" }] },
    expression: { kind: "bool-literal", value: true },
  });
  arms.push({ pattern: { kind: "wildcard" }, expression: { kind: "bool-literal", value: false } });
  return { kind: "match", expression: { kind: "tuple-literal", elements: [
    { kind: "reference", expr: left }, { kind: "reference", expr: rightValue },
  ] }, arms };
}

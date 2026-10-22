import type { Node } from "@tsonic/tsts";
import type { RustSwitchComparison } from "../../../target-model/operations/switch.js";
import type { RustExpr, RustPattern } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { applyRustValueConversion } from "../expressions/value-conversions.js";
import { planRustOperatorCallExpression } from "../expressions/binary.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planRustSwitchComparison(
  left: RustExpr,
  right: RustExpr,
  comparison: RustSwitchComparison,
  node: Node,
  context: RustPlanContext,
): RustExpr {
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
  const rightValue = right;
  const operation = comparison.operation;
  if (!comparison.leftOptional && !comparison.rightOptional) {
    if (operation.kind === "operator-call") {
      const planned = planRustOperatorCallExpression(
      { ...operation, operator: operation.rustOperator, operationId: "tsonic.rust.control.switch.strict-equality" },
      { expression: left, form: "value" }, { expression: rightValue, form: "value" }, node, context);
      if (planned === undefined) failRustPlannerInvariant("An admitted switch comparison requires its native call plan.", node);
      return planned;
    }
    const convertedLeft = applyRustValueConversion(context, left, operation.leftConversion, undefined);
    const convertedRight = applyRustValueConversion(context, rightValue, operation.rightConversion, undefined);
    if (convertedLeft === undefined || convertedRight === undefined)
      failRustPlannerInvariant("An admitted switch comparison requires its operand conversions.", node);
    // A boolean discriminant compared with a boolean case literal is the discriminant itself (or its negation).
    if (convertedRight.kind === "bool-literal") {
      return convertedRight.value ? convertedLeft : { kind: "unary", operator: "!", operand: convertedLeft };
    }
    return {
      kind: "binary", operator: "==", left: convertedLeft, right: convertedRight,
    };
  }
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted optional switch comparison requires its native name scope.", node);
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
  if (value === undefined) failRustPlannerInvariant("An admitted optional switch comparison requires its native equality plan.", node);
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

import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";

export function expressionCarrier(node: Node, context: RustPlanContext): TargetTypeRef | undefined {
  return context.expressionOverrides?.get(node)?.carrier ?? context.input.program.records.valueRead.get(node)?.source;
}

export function effectivePlannedExpressionCarrier(node: Node, context: RustPlanContext): TargetTypeRef | undefined {
  return context.expressionOverrides?.get(node)?.carrier ?? context.input.program.records.valueRead.get(node)?.value;
}

export function negateRustPlannedBooleanExpression(_sourceExpression: Node | undefined, planned: RustExpr, _context: RustPlanContext): RustExpr {
  return { kind: "unary", operator: "!", operand: planned };
}

export function rustOperationFact(node: Node, context: RustPlanContext): RustTargetOperationFact | undefined {
  return context.input.program.records.targetOperation.get(node);
}

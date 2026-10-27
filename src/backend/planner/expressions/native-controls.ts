import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planRustReturnExpression } from "../statements/completion-exits.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planRustNativeControl(call: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "native-range" | "native-propagation" }>,
  context: RustPlanContext, planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined): RustExpr {
  const operands = fact.kind === "native-range" ? fact.operands : [fact.operandExpression];
  const values = operands.map(operand => planExpression(operand, context)
    ?? failRustPlannerInvariant("An admitted native control requires its selected operand.", operand));
  if (fact.kind === "native-range") return { kind: "range", start: values[0]!, end: values[1]! };
  if (context.callableDeclaration !== fact.callableDeclaration)
    failRustPlannerInvariant("An admitted native propagation requires its selected callable emission context.", call);
  const operandErrorType = rustTypeFromCarrierInContext(fact.operandErrorCarrier, context);
  const resultErrorType = rustTypeFromCarrierInContext(fact.resultErrorCarrier, context);
  if (operandErrorType === undefined || resultErrorType === undefined)
    failRustPlannerInvariant("An admitted native propagation requires its error carrier syntax.", call);
  const sourceFallible = context.input.program.records.fallible.get(fact.callableDeclaration) !== undefined;
  if (context.completionBoundary === undefined && !sourceFallible)
    return { kind: "try", expr: values[0]!, nativeReturn: true, operandErrorType, resultErrorType };
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted native propagation requires its name scope.", call);
  const success = allocateRustSyntheticName(context.syntheticNames, "result_value");
  const failure = allocateRustSyntheticName(context.syntheticNames, "result_error");
  return { kind: "match", expression: values[0]!, arms: [
    { pattern: { kind: "tuple-variant", path: "Ok", elements: [{ kind: "binding", name: success }] },
      expression: { kind: "path", path: success } },
    { pattern: { kind: "tuple-variant", path: "Err", elements: [{ kind: "binding", name: failure }] },
      expression: planRustReturnExpression({ kind: "call", path: "Err", args: [
        { kind: "associated-call", owner: resultErrorType,
          trait: { kind: "named", path: "core::convert::From", genericArguments: [{ kind: "type", type: operandErrorType }] },
          method: "from", args: [{ kind: "path", path: failure }] },
      ] }, context) },
  ] };
}

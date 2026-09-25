import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";

export function planRustNativeControl(
  call: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "native-range" | "native-propagation" }>,
  context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): RustExpr | undefined {
  const operands = fact.kind === "native-range" ? fact.operands : [fact.operandExpression];
  const expected = fact.kind === "native-range" ? fact.elementCarrier : fact.operandCarrier;
  const actual = context.input.program.source.ast.arguments(call);
  if (actual.length !== operands.length || operands.length !== (fact.kind === "native-range" ? 2 : 1) ||
    operands.some((operand, index) => operand !== actual[index] ||
      !rustTargetTypeRefEquals(context.input.program.facts.getRuntimeCarrierFact(operand)?.carrier, expected))) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, call),
      "rust.backend.native-control", "Native control operands conflict with the sealed operation."));
    return undefined;
  }
  const values = operands.map(operand => planExpression(operand, context));
  if (values.some(value => value === undefined)) return undefined;
  if (fact.kind === "native-range") {
    return { kind: "struct-literal", path: fact.path,
      fields: [{ name: "start", value: values[0]! }, { name: "end", value: values[1]! }] };
  }
  const operandErrorType = rustTypeFromCarrierInContext(fact.operandErrorCarrier, context);
  const resultErrorType = rustTypeFromCarrierInContext(fact.resultErrorCarrier, context);
  if (operandErrorType === undefined || resultErrorType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, call),
      "rust.backend.native-control-error", "Native propagation requires exact renderable error carriers."));
    return undefined;
  }
  return { kind: "try", expr: values[0]!, operandErrorType, resultErrorType };
}

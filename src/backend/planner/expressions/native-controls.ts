import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustAsyncFunctionFactKey, rustFallibleFactKey, rustSourceCallableReturnFactKey } from "../../../analysis/facts/keys.js";
import { rustNamedTypeCarrierValue, rustTargetGenericTypeArguments } from "../../../target-model/types/index.js";
import { planRustReturnExpression } from "../statements/completion-exits.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";

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
    return { kind: "range", start: values[0]!, end: values[1]! };
  }
  const callableReturn = context.callableDeclaration === undefined ? undefined :
    context.input.program.facts.getFact(context.callableDeclaration, rustAsyncFunctionFactKey)?.outputCarrier ??
    context.input.program.facts.getFact(context.callableDeclaration, rustSourceCallableReturnFactKey)?.returnCarrier;
  const operand = rustNamedTypeCarrierValue(fact.operandCarrier);
  const target = rustNamedTypeCarrierValue(callableReturn);
  const operandArguments = operand === undefined ? [] : rustTargetGenericTypeArguments(operand.genericArguments);
  const targetArguments = target === undefined ? [] : rustTargetGenericTypeArguments(target.genericArguments);
  if (context.callableDeclaration !== fact.callableDeclaration || !rustTargetTypeRefEquals(callableReturn, fact.callableReturnCarrier) ||
    operand === undefined || target === undefined || operand.id !== target.id ||
    operandArguments.length !== 2 || targetArguments.length !== 2 ||
    !rustTargetTypeRefEquals(operandArguments[0], fact.resultCarrier) ||
    !rustTargetTypeRefEquals(operandArguments[1], fact.operandErrorCarrier) ||
    !rustTargetTypeRefEquals(targetArguments[1], fact.resultErrorCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, call),
      "rust.backend.native-control-return", "Native propagation conflicts with its sealed callable return contract."));
    return undefined;
  }
  const operandErrorType = rustTypeFromCarrierInContext(fact.operandErrorCarrier, context);
  const resultErrorType = rustTypeFromCarrierInContext(fact.resultErrorCarrier, context);
  if (operandErrorType === undefined || resultErrorType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, call),
      "rust.backend.native-control-error", "Native propagation requires exact renderable error carriers."));
    return undefined;
  }
  const sourceFallible = context.callableDeclaration !== undefined &&
    context.input.program.facts.getFact(context.callableDeclaration, rustFallibleFactKey) !== undefined;
  if (context.completionBoundary === undefined && !sourceFallible) {
    return { kind: "try", expr: values[0]!, nativeReturn: true, operandErrorType, resultErrorType };
  }
  const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, call, []);
  const success = allocateRustSyntheticName(names, "result_value");
  const failure = allocateRustSyntheticName(names, "result_error");
  return { kind: "match", expression: values[0]!, arms: [
    { pattern: { kind: "tuple-variant", path: "Ok", elements: [{ kind: "binding", name: success }] },
      expression: { kind: "path", path: success } },
    { pattern: { kind: "tuple-variant", path: "Err", elements: [{ kind: "binding", name: failure }] },
      expression: planRustReturnExpression({ kind: "call", path: "Err", args: [
        { kind: "associated-call", owner: resultErrorType,
          trait: { kind: "named", path: "core::convert::From", genericArguments: [{ kind: "type", type: operandErrorType }] },
          method: "from", args: [{ kind: "path", path: failure }] },
      ] }, context, sourceFallible) },
  ] };
}

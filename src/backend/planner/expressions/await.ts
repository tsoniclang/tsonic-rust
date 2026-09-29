import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import { rustFutureValueFactKey } from "../../../analysis/facts/keys.js";
import { rustFutureValueMatchesCarrier } from "../../../analysis/facts/future-values.js";
import { rustAwaitCarrier, rustJsPromiseTargetId, isRustNeverCarrier, isRustUnitCarrier } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput, rustActiveErrorType } from "../program/plan-context.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { applyRustErrorBoundary } from "../types/error-boundary.js";
import { rustBottomAfterEffect, rustBottomExpression } from "../types/fallible-shape.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { applyFinalizedValueConversion } from "./value-conversions.js";
import { requireExpressionCarrier, rustOperationFact } from "./fundamentals.js";
import { planRustAbsentValue } from "./optional-storage.js";

export function planRustAwaitExpression(
  node: Node,
  context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): RustExpr | undefined {
  const awaitFact = rustOperationFact(node, context);
  if (awaitFact?.kind !== "await-op") {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.async", "Await expressions require a finalized future output fact."));
    return undefined;
  }
  if (!requireExpressionCarrier(node, awaitFact.resultCarrier, context, "rust.backend.await-carrier")) return undefined;
  const operand = Node_Expression(context.input.program.source.ast, node);
  const planned = operand === undefined ? undefined : planExpression(operand, context);
  if (planned === undefined) return undefined;
  const future = operand === undefined ? undefined : context.input.program.facts.getFact(operand, rustFutureValueFactKey);
  const operandCarrier = operand === undefined ? undefined : context.input.program.facts.getRuntimeCarrierFact(operand)?.carrier;
  const selection = rustAwaitCarrier(operandCarrier);
  if (selection === undefined || future === undefined || !rustFutureValueMatchesCarrier(future, operandCarrier, context.input.program.typeDefinitions) ||
    !rustTargetTypeRefEquals(awaitFact.resultCarrier, selection.resultCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.await-future-value", "Awaited expression requires one compatible finalized future-value fact."));
    return undefined;
  }
  const promise = selection.futureCarrier.kind === "target-named" && selection.futureCarrier.id === rustJsPromiseTargetId;
  if (promise && !requireRustCarrierRequirements(future.outputCarrier, ["clone"], node, context)) return undefined;
  const name = allocateRustSyntheticName(createRustSyntheticNameState(context.input.program.source.ast, node, []), "__tsonic_future");
  const value: RustExpr = selection.optional ? { kind: "path", path: name } : planned;
  const awaitOperand: RustExpr = promise
    ? { kind: "method-call", receiver: value, method: future.awaiting === "fallible" ? "into_result" : "into_value", args: [] }
    : value;
  let awaited: RustExpr = { kind: "await", expr: awaitOperand };
  if (future.awaiting === "fallible") {
    const activeErrorType = rustActiveErrorType(context);
    if (activeErrorType === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(diagnosticInput(context, node),
        "rust.error.call", "Fallible awaits require a finalized fallible lowering context."));
      return undefined;
    }
    if (future.errorBoundary === "none") {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
        "rust.backend.await-error-boundary", "A finalized fallible Rust future requires one exact error boundary."));
      return undefined;
    }
    awaited = applyRustErrorBoundary(awaited, future.errorBoundary, activeErrorType,
      rustTypeFromCarrierInContext(future.errorCarrier, context));
  }
  let converted = applyFinalizedValueConversion(context, awaited, future.awaitedConversion, node, "operation-result");
  if (converted === undefined) return undefined;
  if (isRustNeverCarrier(future.outputCarrier)) {
    converted = future.awaiting === "fallible"
      ? rustBottomAfterEffect(converted, "fallible never await returned") : rustBottomExpression(converted);
  }
  if (!selection.optional) return converted;
  const absent: RustExpr = isRustUnitCarrier(selection.resultCarrier)
    ? { kind: "tuple-literal", elements: [] } : planRustAbsentValue(selection.resultCarrier, context);
  const present: RustExpr = rustTargetTypeRefEquals(selection.outputCarrier, selection.resultCarrier)
    ? converted : { kind: "call", path: "Some", args: [converted] };
  return { kind: "match", expression: planned, arms: [
    { pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name }] }, expression: present },
    { pattern: { kind: "path", path: "None" }, expression: absent },
  ] };
}

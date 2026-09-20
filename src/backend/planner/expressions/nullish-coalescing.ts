import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import { rustTargetOperationText } from "../../../analysis/facts/target-operation.js";
import { rustOptionElementCarrier } from "../../../target-model/types/index.js";
import { rustOptionNestingDepth } from "../../../target-model/types/carriers/optional.js";
import { rustUnparenthesizedExpression } from "../../../target-model/syntax/expressions.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { diagnosticInput, rustActiveErrorType } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { applyRustFallibleResultExpression, rustExpressionUsesTryInCurrentRegion } from "../types/fallible-shape.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planExpression, planExpressionBeforeValueProjections } from "./entry.js";
import { effectivePlannedExpressionCarrier, requireExpressionCarrier, selectedOperationMatches } from "./fundamentals.js";

export function planNullishCoalescing(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "option-coalesce" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  const ast = context.input.program.source.ast;
  const leftSyntax = BinaryExpression_Left(ast, node);
  const rightSyntax = BinaryExpression_Right(ast, node);
  const leftNode = leftSyntax === undefined ? undefined : rustUnparenthesizedExpression(ast, leftSyntax);
  const rightNode = rightSyntax === undefined ? undefined : rustUnparenthesizedExpression(ast, rightSyntax);
  let left = leftNode === undefined
    ? undefined
    : planExpressionBeforeValueProjections(leftNode, context, "value");
  let right = rightNode === undefined ? undefined
    : fact.rightValueForm === "raw"
      ? planExpressionBeforeValueProjections(rightNode, context, "value")
      : planExpression(rightNode, context);
  if (left === undefined || right === undefined ||
    !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.option-coalesce-carrier") ||
    !selectedOperationMatches(
      context.input.program.facts.getSelectedTargetOperator(node),
      fact.operationId,
      "operator",
      fact.resultCarrier,
      rustTargetOperationText(fact),
    )) {
    return undefined;
  }
  const presentCarrier = fact.rightOptionDepth > 0
    ? rustOptionElementCarrier(fact.resultCarrier) : fact.resultCarrier;
  if (!Number.isSafeInteger(fact.leftOptionDepth) || fact.leftOptionDepth < 1 ||
    !Number.isSafeInteger(fact.rightOptionDepth) || fact.rightOptionDepth < 0 ||
    fact.rightValueForm !== "value" && fact.rightValueForm !== "raw" ||
    fact.rightValueForm === "raw" && fact.rightOptionDepth === 0 ||
    rustOptionNestingDepth(
      context.input.program.facts.getRuntimeCarrierFact(leftNode)?.carrier,
      presentCarrier,
    ) !== fact.leftOptionDepth ||
    rustOptionNestingDepth(rightNode === undefined ? undefined :
      fact.rightValueForm === "raw"
        ? context.input.program.facts.getRuntimeCarrierFact(rightNode)?.carrier
        : effectivePlannedExpressionCarrier(rightNode, context), presentCarrier) !== fact.rightOptionDepth) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.option-coalesce-depth",
      "Nullish coalescing requires exact finalized operand Option depths.",
    ));
    return undefined;
  }
  for (let depth = 1; depth < fact.leftOptionDepth; depth++) {
    left = { kind: "method-call", receiver: left, method: "flatten", args: [] };
  }
  for (let depth = 1; depth < fact.rightOptionDepth; depth++) {
    right = { kind: "method-call", receiver: right, method: "flatten", args: [] };
  }
  context.usedAliases?.add("rt");
  const fallbackIsFallible = rustExpressionUsesTryInCurrentRegion(right);
  const activeErrorType = rustActiveErrorType(context);
  if (fallbackIsFallible && activeErrorType === undefined) {
    return undefined;
  }
  const fallback: RustExpr = !fallbackIsFallible && right.kind === "call" && right.args.length === 0
    ? { kind: "path", path: right.path }
    : {
        kind: "closure",
        params: [],
        body: fallbackIsFallible
          ? applyRustFallibleResultExpression(right, {
              errorType: activeErrorType!,
            })
          : right,
      };
  const presentValueName = allocateRustSyntheticName(
    context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []),
    "present_value",
  );
  const present: RustExpr = fallbackIsFallible && fact.rightOptionDepth === 0
    ? { kind: "path", path: "Ok" }
    : fallbackIsFallible
      ? {
          kind: "closure",
          params: [{ name: presentValueName, byRefCopy: false }],
          body: {
            kind: "call",
            path: "Ok",
            args: [fact.rightOptionDepth > 0
              ? { kind: "call", path: "Some", args: [{ kind: "path", path: presentValueName }] }
              : { kind: "path", path: presentValueName }],
          },
        }
      : {
          kind: "path",
          path: fact.rightOptionDepth > 0 ? "Some" : "core::convert::identity",
        };
  const coalescedValueType = fallbackIsFallible ? rustTypeFromCarrierInContext(fact.resultCarrier, context) : undefined;
  if (fallbackIsFallible && coalescedValueType === undefined) return undefined;
  const coalesced: RustExpr = {
    kind: "call",
    path: "rt::option_coalesce",
    ...(fallbackIsFallible ? { genericArguments: [
      { kind: "type" as const, type: { kind: "infer" as const } },
      { kind: "type" as const, type: { kind: "named" as const, path: "core::result::Result", genericArguments: [
        { kind: "type" as const, type: coalescedValueType! },
        { kind: "type" as const, type: activeErrorType! },
      ] } },
    ] } : {}),
    args: [
      left,
      present,
      fallback,
    ],
  };
  if (!fallbackIsFallible) {
    return coalesced;
  }
  context.usedAliases?.add("rt");
  return {
    kind: "try",
    expr: coalesced,
    resultErrorType: activeErrorType!,
    operandErrorType: activeErrorType!,
  };
}

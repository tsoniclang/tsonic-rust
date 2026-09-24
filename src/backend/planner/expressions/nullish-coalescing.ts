import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import { rustTargetOperationText } from "../../../analysis/facts/target-operation.js";
import { isRustNeverCarrier, rustOptionElementCarrier } from "../../../target-model/types/index.js";
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
import { applyRustValueConversion } from "./value-conversions.js";
import { rustValueConversionContract } from "../../../target-model/conversions/contracts.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustOptionalStorageValue } from "../../../target-model/types/projections.js";

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
  const rightCarrier = rightNode === undefined ? undefined : fact.rightValueForm === "raw"
    ? context.input.program.facts.getRuntimeCarrierFact(rightNode)?.carrier
    : effectivePlannedExpressionCarrier(rightNode, context);
  const rightDepth = fact.rightValueForm === "value" && isRustNeverCarrier(rightCarrier)
    ? 0 : rustOptionNestingDepth(rightCarrier, presentCarrier);
  const conversion = fact.leftConversion === undefined ? undefined
    : rustValueConversionContract(fact.leftConversion, context.input.program.typeDefinitions);
  const exactPresentValue = fact.leftConversion === undefined
    ? rustTargetTypeRefEquals(fact.leftValueCarrier, presentCarrier)
    : conversion !== undefined && !conversion.fallible &&
      rustTargetTypeRefEquals(conversion.source, fact.leftValueCarrier) && rustTargetTypeRefEquals(conversion.target, presentCarrier);
  if (!Number.isSafeInteger(fact.leftOptionDepth) || fact.leftOptionDepth < 1 ||
    !Number.isSafeInteger(fact.rightOptionDepth) || fact.rightOptionDepth < 0 ||
    !exactPresentValue || fact.rightValueForm !== "value" && fact.rightValueForm !== "raw" ||
    fact.rightValueForm === "raw" && fact.rightOptionDepth === 0 ||
    rustOptionNestingDepth(
      context.input.program.facts.getRuntimeCarrierFact(leftNode)?.carrier,
      fact.leftValueCarrier,
    ) !== fact.leftOptionDepth ||
    rightDepth !== fact.rightOptionDepth) {
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
  const convertedPresent = fact.leftConversion === undefined ? undefined : applyRustValueConversion(context,
    { kind: "path", path: presentValueName }, fact.leftConversion, node, false);
  if (fact.leftConversion !== undefined && convertedPresent === undefined) return undefined;
  const present: RustExpr = convertedPresent !== undefined
    ? { kind: "closure", params: [{ name: presentValueName, byRefCopy: false }],
        body: fallbackIsFallible ? { kind: "call", path: "Ok", args: [convertedPresent] } : convertedPresent }
    : fallbackIsFallible && fact.rightOptionDepth === 0
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
  const leftCarrier = context.input.program.facts.getRuntimeCarrierFact(leftNode)?.carrier;
  const projected = rustOptionalStorageValue(leftCarrier);
  const projectedValueType = projected === undefined ? undefined : rustTypeFromCarrierInContext(projected, context);
  const projectedStorageType = projected === undefined ? undefined : rustTypeFromCarrierInContext(leftCarrier, context);
  if (projected !== undefined && (projectedValueType === undefined || projectedStorageType === undefined)) return undefined;
  const coalesced: RustExpr = {
    kind: "call",
    path: projected === undefined ? "rt::option_coalesce" : "rt::optional_storage_coalesce",
    ...(projected !== undefined ? { genericArguments: [
      { kind: "type" as const, type: projectedValueType! },
      { kind: "type" as const, type: projectedStorageType! },
      { kind: "type" as const, type: fallbackIsFallible ? { kind: "named" as const, path: "core::result::Result", genericArguments: [
        { kind: "type" as const, type: coalescedValueType! }, { kind: "type" as const, type: activeErrorType! },
      ] } : { kind: "infer" as const } },
    ] } : fallbackIsFallible ? { genericArguments: [
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

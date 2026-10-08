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
import { diagnosticInput } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planExpression, planExpressionBeforeOptionProjection, planExpressionBeforeValueProjections } from "./entry.js";
import { rustValueCarrierBeforeOptionProjection } from "../../../analysis/facts/value-carrier-queries.js";
import { effectivePlannedExpressionCarrier, requireExpressionCarrier, selectedOperationMatches } from "./fundamentals.js";
import { applyRustValueConversion } from "./value-conversions.js";
import { rustValueConversionContract } from "../../../target-model/conversions/contracts.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustOptionalStorageNestingDepth } from "../../../target-model/types/projections.js";
import { planRustOptionBranch } from "./option-branch.js";

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
    : planExpressionBeforeOptionProjection(leftNode, context);
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
    rustOptionalStorageNestingDepth(
      rustValueCarrierBeforeOptionProjection(context.input.program.facts, leftNode),
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
  const presentValueName = allocateRustSyntheticName(
    context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []),
    "present_value",
  );
  const convertedPresent = fact.leftConversion === undefined ? undefined : applyRustValueConversion(context,
    { kind: "path", path: presentValueName }, fact.leftConversion, node, false);
  if (fact.leftConversion !== undefined && convertedPresent === undefined) return undefined;
  const leftCarrier = context.input.program.facts.getRuntimeCarrierFact(leftNode)?.carrier;
  if (leftCarrier === undefined) return undefined;
  const value: RustExpr = convertedPresent ?? { kind: "path", path: presentValueName };
  return planRustOptionBranch(left, leftCarrier, presentValueName,
    fact.rightOptionDepth > 0 ? { kind: "call", path: "Some", args: [value] } : value, right, context);
}

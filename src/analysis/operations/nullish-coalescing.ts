import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustNullishCoalescingProducer } from "../program/records/operations/nullish-coalescing.js";
import { isRustNeverCarrier, rustOptionElementCarrier } from "../../target-model/types/index.js";
import { rustOptionNestingDepth } from "../../target-model/types/carriers/optional.js";
import { rustOptionalStorageNestingDepth } from "../../target-model/types/projections.js";
import { rustValueConversionContract } from "../../policy/conversions/contracts.js";
import { rustTargetOperationText } from "../../target-model/operations/text.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustEffectiveValueCarrier, rustValueCarrierBeforeOptionProjection } from "../conversions/value-carrier-queries.js";

export function analyzeRustNullishCoalescing(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustNullishCoalescingProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const { ast } = program.source;
  const unwrap = (node: Node | undefined): Node | undefined => {
    while (node !== undefined && ast.is.IsParenthesizedExpression(node)) node = Node_Expression(ast, node);
    return node;
  };
  const refuse = (node: Node, capability: string, message: string): void => {
    issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind !== "option-coalesce") continue;
    const left = unwrap(BinaryExpression_Left(ast, node));
    const right = unwrap(BinaryExpression_Right(ast, node));
    const selected = program.records.selectedOperation.get(node);
    if (left === undefined || right === undefined || !rustTargetTypeRefEquals(program.records.runtimeCarrier.get(node)?.carrier, fact.resultCarrier) ||
      selected?.operationId !== fact.operationId || selected.operationKind !== "operator" || selected.targetOperation !== rustTargetOperationText(fact) ||
      !rustTargetTypeRefEquals(selected.resultType, fact.resultCarrier)) {
      refuse(node, "rust.backend.option-coalesce-carrier", "Nullish coalescing requires exact finalized source operands and result evidence.");
      continue;
    }
    const presentCarrier = fact.rightOptionDepth > 0 ? rustOptionElementCarrier(fact.resultCarrier) : fact.resultCarrier;
    const rightCarrier = fact.rightValueForm === "raw" ? program.records.runtimeCarrier.get(right)?.carrier : rustEffectiveValueCarrier(program.records, right);
    const rightDepth = fact.rightValueForm === "value" && isRustNeverCarrier(rightCarrier) ? 0 : rustOptionNestingDepth(rightCarrier, presentCarrier);
    const conversion = fact.leftConversion === undefined ? undefined : rustValueConversionContract(fact.leftConversion, program.typeDefinitions);
    const exact = fact.leftConversion === undefined ? rustTargetTypeRefEquals(fact.leftValueCarrier, presentCarrier)
      : conversion !== undefined && !conversion.fallible && rustTargetTypeRefEquals(conversion.source, fact.leftValueCarrier) && rustTargetTypeRefEquals(conversion.target, presentCarrier);
    const leftCarrier = program.records.runtimeCarrier.get(left)?.carrier;
    if (!Number.isSafeInteger(fact.leftOptionDepth) || fact.leftOptionDepth < 1 || !Number.isSafeInteger(fact.rightOptionDepth) || fact.rightOptionDepth < 0 ||
      !exact || fact.rightValueForm !== "value" && fact.rightValueForm !== "raw" || fact.rightValueForm === "raw" && fact.rightOptionDepth === 0 ||
      rustOptionalStorageNestingDepth(rustValueCarrierBeforeOptionProjection(program.records, left), fact.leftValueCarrier) !== fact.leftOptionDepth ||
      rightDepth !== fact.rightOptionDepth || leftCarrier === undefined) {
      refuse(node, "rust.backend.option-coalesce-depth", "Nullish coalescing requires exact finalized operand Option depths.");
      continue;
    }
    producer.publish(node, { operation: fact, left, right, leftCarrier });
  }
  return Object.freeze(issues);
}

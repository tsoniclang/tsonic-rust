import type { Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustOptionEqualityProducer } from "../program/records/operations/option-equality.js";
import { rustStrictEqualityOperandCarrier } from "../conversions/value-carrier-queries.js";
import { rustOptionEqualityContract } from "../../policy/operations/operators/option-equality.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isRustOptionCarrier } from "../../target-model/types/index.js";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import { hasExactObjectKeys, isClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustSourcePrimitiveTargetType } from "../../target-model/types/index.js";

export function analyzeRustOptionEquality(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[], producer: RustOptionEqualityProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind !== "option-equality") continue;
    const left = BinaryExpression_Left(program.source.ast, node);
    const right = BinaryExpression_Right(program.source.ast, node);
    const leftCarrier = rustStrictEqualityOperandCarrier(program.records, left);
    const rightCarrier = rustStrictEqualityOperandCarrier(program.records, right);
    const contract = rustOptionEqualityContract(leftCarrier, rightCarrier);
    const selected = program.records.selectedOperation.get(node);
    // The exact record shape and its selected operator are checked as the checkpoint planner checked them.
    if (!isClosedMetadata(fact) || !hasExactObjectKeys(fact, ["kind", "operationId", "negated", "leftCarrier", "rightCarrier",
      "comparisonCarrier", "leftLiftDepth", "rightLiftDepth", "view"]) || typeof fact.negated !== "boolean" ||
      selected?.operationId !== fact.operationId || selected.operationKind !== "operator" ||
      !rustTargetTypeRefEquals(selected.resultType, rustSourcePrimitiveTargetType("bool")) ||
      left === undefined || right === undefined || contract === undefined ||
      program.source.ast.operatorKindName(node) !== (fact.negated ? "KindExclamationEqualsEqualsToken" : "KindEqualsEqualsEqualsToken") ||
      !rustTargetTypeRefEquals(leftCarrier, fact.leftCarrier) || !rustTargetTypeRefEquals(rightCarrier, fact.rightCarrier) ||
      !rustTargetTypeRefEquals(contract.comparisonCarrier, fact.comparisonCarrier) || contract.view !== fact.view ||
      contract.leftLiftDepth !== fact.leftLiftDepth || contract.rightLiftDepth !== fact.rightLiftDepth)
      failTargetAnalysisInvariant("tsonic-rust", "Option equality conflicts with its exact native operand carriers, borrowed view, presence depth or selected operation.", node);
    const leftRawOption = isRustOptionCarrier(program.records.valueRead.get(left)?.source);
    const read = program.records.readOwnership.get(left);
    if (read === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted optional comparison requires its completed native read.", left);
    const materialize = fact.view !== "value" && leftRawOption && read.readsStorage && !read.borrowedAcross.has(right);
    const acquisition = !materialize ? undefined : read.source.kind === "borrow" ? read.snapshot : read.source;
    if (materialize && acquisition === undefined || acquisition?.kind === "borrow") {
      issues.push({ code: "RUST_OPTION_EQUALITY_ACQUISITION_NOT_PROVEN", source: "tsonic-rust", category: "error",
        sourceNode: left, message: "An optional comparison across a later effect requires its exact owning native read.",
        evidence: ["target.capability=rust.option-equality.native-acquisition"] });
      continue;
    }
    producer.publish(node, { fact, left, right, leftRawOption,
      rightRawOption: isRustOptionCarrier(program.records.valueRead.get(right)?.source),
      leftOption: isRustOptionCarrier(fact.leftCarrier), rightOption: isRustOptionCarrier(fact.rightCarrier),
      precedingAcquisition: acquisition });
  }
  return issues;
}

import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../../program/model.js";
import type { RustStringComparisonViewProducer } from "../../program/records/operations/string-comparison-views.js";
import type { RustStringComparisonView } from "../../../target-model/records/operations/string-comparison-views.js";
import { BinaryExpression_Left, BinaryExpression_Right, sourceTransparentExpressionOperand } from "@tsonic/target-api/source";
import { rustContextualRuntimeConversionContract } from "../../../policy/conversions/contextual.js";
import { rustValueConversionContract } from "../../../policy/conversions/contracts.js";
import { rustBorrowValueIsUnconverted, rustBorrowValueIsUnprojected } from "../../storage/borrowed-element-purity.js";
import { isRustStringCarrier, rustStrTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustProgramNodeIsOutsideNativeCode } from "../../control-flow/compile-time-statements.js";

export function analyzeRustStringComparisonViews(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[], producer: RustStringComparisonViewProducer): void {
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    let selected: RustStringComparisonView = { kind: "value" };
    let value = node;
    for (;;) {
      const inner = sourceTransparentExpressionOperand(program.source.ast, value);
      if (inner === undefined) break;
      if (program.records.sourceAssertion.get(value)?.conversion !== undefined ||
        program.records.flowReadProjection.get(value) !== undefined ||
        program.records.optionProjection.get(value) !== undefined) break;
      value = inner;
    }
    const literal = program.records.literalValue.get(value);
    const contextual = program.records.contextualValueConversion.get(node);
    const contextualContract = contextual === undefined ? undefined
      : rustContextualRuntimeConversionContract(contextual.conversion, program.typeDefinitions);
    const parent = program.source.ast.parent(node);
    const operation = parent === undefined ? undefined : program.records.targetOperation.get(parent);
    // An optional equality operand is planned before its option projection and lifted into Some by the planner, so a
    // string literal there is borrowed as the literal itself.
    const optionOperand = operation?.kind === "option-equality" && isRustStringCarrier(program.records.runtimeCarrier.get(node)?.carrier) &&
      rustBorrowValueIsUnconverted(node, program.records);
    if ((literal?.form === "string" || literal?.form === "template") && (optionOperand ||
      contextualContract?.lowering === "borrowed-str-from-owned-string" ||
      isRustStringCarrier(program.records.valueRead.get(node)?.value) && rustBorrowValueIsUnprojected(node, program.records)))
      selected = { kind: "literal", value: literal.text };
    const field = program.records.errorFieldEmission.get(node);
    if (field?.kind === "property" && field.directRead && field.property !== "stack") selected = { kind: "error" };
    const source = program.records.sourceAssertion.get(node);
    if (source?.conversion !== undefined && rustValueConversionContract(source.conversion, program.typeDefinitions)?.lowering === "owned-string-from-borrowed-str")
      selected = { kind: "source", operand: source.operand };
    if (contextualContract?.lowering === "owned-string-from-borrowed-str")
      selected = { kind: "contextual" };
    const carrier = program.records.valueRead.get(node)?.value;
    const referent = carrier?.kind === "reference" ? carrier.referent : carrier;
    const binary = parent === undefined ? undefined : program.records.binaryEmission.get(parent);
    if (parent !== undefined && selected.kind === "value" && binary?.fact.kind === "operator-token" &&
      (binary.operator === "==" || binary.operator === "!=") &&
      (isRustStringCarrier(referent) || rustTargetTypeRefEquals(referent, rustStrTargetType()))) {
      const comparison = program.records.nativeComparison.get(parent)
        ?? failTargetAnalysisInvariant("tsonic-rust", "A native string comparison view requires its finalized native comparison recipe.", node);
      if (comparison.kind === "ordinary") {
        const shared = binary.left === node ? binary.leftShared : binary.right === node ? binary.rightShared
          : failTargetAnalysisInvariant("tsonic-rust", "A native string comparison view requires its exact finalized binary operand.", node);
        selected = program.records.targetOperation.get(value)?.kind === "typeof"
          ? { kind: "runtime-category", expression: value }
          : { kind: "native-str-reference", inputForm: shared ? "shared-reference" : "value" };
      }
    }
    if (parent !== undefined && operation?.kind === "operator-token" &&
      (BinaryExpression_Left(program.source.ast, parent) === node && operation.leftConversion !== undefined ||
        BinaryExpression_Right(program.source.ast, parent) === node && operation.rightConversion !== undefined)) selected = { kind: "value" };
    producer.publish(node, selected);
  }
}

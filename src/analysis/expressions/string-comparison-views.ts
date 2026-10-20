import type { Node } from "@tsonic/tsts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustStringComparisonViewProducer } from "../program/records/string-comparison-views.js";
import type { RustStringComparisonView } from "../../target-model/records/string-comparison-views.js";
import { Node_Expression, BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import { rustContextualRuntimeConversionContract } from "../../target-model/conversions/contextual.js";
import { rustValueConversionContract } from "../../target-model/conversions/contracts.js";
import { rustBorrowValueIsUnprojected } from "../storage/borrowed-element-purity.js";
import { isRustStringCarrier } from "../../target-model/types/index.js";

export function analyzeRustStringComparisonViews(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[], producer: RustStringComparisonViewProducer): void {
  for (const node of nodes) {
    let selected: RustStringComparisonView = { kind: "value" };
    let value = node;
    while (program.source.ast.is.IsParenthesizedExpression(value)) {
      const inner = Node_Expression(program.source.ast, value);
      if (inner === undefined) break;
      value = inner;
    }
    const literal = program.records.literalValue.get(value);
    if ((literal?.form === "string" || literal?.form === "template") && isRustStringCarrier(program.records.valueRead.get(node)?.value) && rustBorrowValueIsUnprojected(node, program.records))
      selected = { kind: "literal", value: literal.text };
    const field = program.records.errorFieldEmission.get(node);
    if (field?.kind === "property" && field.directRead && field.property !== "stack") selected = { kind: "error" };
    const source = program.records.sourceAssertion.get(node);
    if (source?.conversion !== undefined && rustValueConversionContract(source.conversion, program.typeDefinitions)?.lowering === "owned-string-from-borrowed-str")
      selected = { kind: "source", operand: source.operand };
    const contextual = program.records.contextualValueConversion.get(node);
    if (contextual !== undefined && rustContextualRuntimeConversionContract(contextual.conversion, program.typeDefinitions)?.lowering === "owned-string-from-borrowed-str")
      selected = { kind: "contextual" };
    const parent = program.source.ast.parent(node);
    const operation = parent === undefined ? undefined : program.records.targetOperation.get(parent);
    if (parent !== undefined && operation?.kind === "operator-token" &&
      (BinaryExpression_Left(program.source.ast, parent) === node && operation.leftConversion !== undefined ||
        BinaryExpression_Right(program.source.ast, parent) === node && operation.rightConversion !== undefined)) selected = { kind: "value" };
    producer.publish(node, selected);
  }
}

import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { TemplateExpression_Head, TemplateExpression_TemplateSpans, TemplateSpan_Expression, TemplateSpan_Literal } from "@tsonic/target-api/source";
import type { RustTargetProgram } from "../program/model.js";
import type { RustTemplateStringProducer } from "../program/records/template-strings.js";
import type { RustTemplateStringEmission } from "../../target-model/records/template-strings.js";
import { isRustStringCarrier } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function analyzeRustTemplateStrings(program: Omit<RustTargetProgram, "reachability">,
  nodes: readonly Node[], producer: RustTemplateStringProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const { ast } = program.source;
  const refuse = (node: Node, capability: string, message: string): void => {
    issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  for (const node of nodes) {
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind !== "template-string") continue;
    const head = TemplateExpression_Head(ast, node);
    const spans = TemplateExpression_TemplateSpans(ast, node);
    if (head === undefined || spans === undefined || spans.length !== operation.substitutions.length) {
      refuse(node, "rust.backend.template", "Template expression requires one exact finalized substitution contract."); continue;
    }
    const parts: RustTemplateStringEmission["parts"][number][] = [];
    for (const [index, span] of spans.entries()) {
      const expression = span === undefined ? undefined : TemplateSpan_Expression(ast, span);
      const literal = span === undefined ? undefined : TemplateSpan_Literal(ast, span);
      const selected = operation.substitutions[index];
      const carrier = expression === undefined ? undefined : program.records.valueRead.get(expression)?.value;
      if (expression === undefined || literal === undefined || selected === undefined || selected.expression !== expression ||
        carrier === undefined || !rustTargetTypeRefEquals(carrier, selected.carrier)) {
        refuse(span ?? node, "rust.backend.template-substitution", "Template substitution conflicts with its finalized expression identity or carrier."); continue;
      }
      parts.push(Object.freeze({ expression, string: isRustStringCarrier(selected.carrier), literal: ast.text(literal) }));
    }
    if (parts.length === spans.length) producer.publish(node, { head: ast.text(head), parts: Object.freeze(parts) });
  }
  return Object.freeze(issues);
}

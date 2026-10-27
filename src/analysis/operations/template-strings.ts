import { type Node, type SourceFile } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import { type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { TemplateExpression_Head, TemplateExpression_TemplateSpans, TemplateSpan_Expression, TemplateSpan_Literal } from "@tsonic/target-api/source";
import { type RustAnalysisProgram } from "../program/model.js";
import { type RustTemplateStringProducer } from "../program/records/operations/template-strings.js";
import { type RustTemplateStringEmission } from "../../target-model/records/operations/template-strings.js";
import { isRustStringCarrier, rustStringTargetType } from "../../target-model/types/index.js";
import { isRustSourceStringConvertibleCarrier } from "../../policy/operations/js-values/carrier-protocols.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { requireRustRecord } from "../program/records/objects/required-records.js";
import { appendRustDiagnostic, type RustFactWalk } from "../program/walk.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { setCarrierFact } from "./project-calls.js";
import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";
import { type TargetTypeRef } from "../../target-model/types/model.js";

export function analyzeRustTemplateStrings(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustTemplateStringProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const { ast } = program.source;
  const refuse = (node: Node, capability: string, message: string): void => {
    issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
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






































export function resolveTemplateExpressionCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
): TargetTypeRef | undefined {
  const spans = TemplateExpression_TemplateSpans(walk.context.ast, expression);
  if (spans === undefined || !isDenseDataArray(spans) || spans.some((span) => span === undefined)) {
    appendRustDiagnostic(
      walk,
      "RUST_TEMPLATE_STRUCTURE_INVALID",
      "Template expression requires a dense checked template-span sequence.",
      expression,
      ["target.capability=rust.syntax.template"],
    );
    return undefined;
  }
  const substitutions: { expression: Node; carrier: TargetTypeRef }[] = [];
  for (const span of spans as readonly Node[]) {
    const substitution = TemplateSpan_Expression(walk.context.ast, span);
    const carrier = substitution === undefined
      ? undefined
      : resolveExpressionCarrier(walk, substitution, sourceFile, undefined);
    if (substitution === undefined || carrier === undefined ||
      !isRustSourceStringConvertibleCarrier(carrier)) {
      appendRustDiagnostic(
        walk,
        "RUST_TEMPLATE_SUBSTITUTION_UNSUPPORTED",
        "Template substitution requires an exact closed primitive, string, or undefined carrier.",
        span,
        [
          "target.capability=rust.syntax.template",
          `substitution.carrier=${JSON.stringify(carrier)}`,
        ],
      );
      return undefined;
    }
    substitutions.push({ expression: substitution, carrier });
  }
  const resultCarrier = rustStringTargetType();
  requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "template-string", "analysis/source-evidence/types/resolution/expression-values.ts");
  walk.context.records.targetOperations.source(expression, {
    kind: "template-string",
    operationId: "tsonic.rust.syntax.template-string",
    resultCarrier,
    substitutions,
  });
  return setCarrierFact(walk, expression, resultCarrier);
}

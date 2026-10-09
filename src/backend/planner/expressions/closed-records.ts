import type { Node } from "@tsonic/tsts";
import { ObjectLiteralProperty_Value } from "@tsonic/target-api/source";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import { rustJsValueTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { diagnosticInput } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { requireExpressionCarrier } from "./fundamentals.js";
import { rustEffectiveValueCarrier } from "../../../analysis/facts/value-carrier-queries.js";
import { planExpression } from "./entry.js";

export function planRustClosedRecordLiteral(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "closed-record-literal" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  const { ast } = context.input.program.source;
  const properties = ast.properties(node);
  const invalid = (): undefined => {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.closed-record", "Closed record construction requires exact ordered data-property and carrier facts."));
    return undefined;
  };
  if (!rustTargetTypeRefEquals(fact.resultCarrier, rustJsValueTargetType()) ||
    !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.closed-record-carrier") ||
    properties.length === 0 || properties.length !== fact.fields.length ||
    new Set(fact.fields.map(field => field.sourceName)).size !== fact.fields.length) return invalid();
  const elements: RustExpr[] = [];
  for (const [index, field] of fact.fields.entries()) {
    const property = properties[index];
    const name = property === undefined ? undefined : ast.name(property);
    if (property === undefined || property !== field.property ||
      !ast.is.IsPropertyAssignment(property) && !ast.is.IsShorthandPropertyAssignment(property) ||
      name === undefined || ast.is.IsComputedPropertyName(name) || ast.text(name) !== field.sourceName ||
      ObjectLiteralProperty_Value(ast, property) !== field.expression ||
      !rustTargetTypeRefEquals(rustEffectiveValueCarrier(context.input.program.facts, field.expression),
        fact.resultCarrier)) return invalid();
    const value = planExpression(field.expression, context);
    if (value === undefined) return undefined;
    elements.push({ kind: "tuple-literal",
      elements: [{ kind: "str-literal", value: field.sourceName }, value] });
  }
  return { kind: "call", path: "js_abi::JsValue::object",
    args: [{ kind: "call", path: "js_abi::JsObject::from_pairs",
      args: [{ kind: "slice-literal", elements }] }] };
}

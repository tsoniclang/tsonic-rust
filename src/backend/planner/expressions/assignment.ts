import { BinaryExpression_Right } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import { rustValueCarrierBeforeContextualConversion } from "../../../analysis/facts/value-carrier-queries.js";
import { isRustCopyCarrier } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planExpressionAsStatement } from "../statements/expression-statements.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planExpressionBeforeContextualConversion } from "./entry.js";
import { expressionCarrier } from "./fundamentals.js";

export function planAssignmentExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const right = BinaryExpression_Right(context.input.program.source.ast, node);
  const carrier = rustValueCarrierBeforeContextualConversion(context.input.program.facts, right);
  const type = carrier === undefined ? undefined : rustTypeFromCarrierInContext(carrier, context);
  if (right === undefined || carrier === undefined || type === undefined ||
      context.syntheticNames === undefined ||
      !rustTargetTypeRefEquals(carrier, expressionCarrier(node, context))) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.assignment-value-carrier",
      "An assignment expression requires its exact finalized right-hand value carrier before storage projection.",
    ));
    return undefined;
  }
  const copy = isRustCopyCarrier(carrier);
  if (!copy && !requireRustCarrierRequirements(carrier, ["clone"], node, context)) {
    return undefined;
  }
  const value = planExpressionBeforeContextualConversion(right, context);
  if (value === undefined) return undefined;
  const resultName = allocateRustSyntheticName(context.syntheticNames, "assignment_result");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "assignment_value");
  const result: RustExpr = { kind: "path", path: resultName };
  const selected: RustExpr = { kind: "path", path: valueName };
  const overrides = new Map(context.expressionOverrides ?? []);
  overrides.set(right, {
    carrier,
    valueForm: "value",
    expression: {
      kind: "block",
      bindings: [{ name: valueName, value }],
      value: {
        kind: "evaluate-then",
        effect: {
          kind: "assignment", operator: "=", target: result,
          value: copy ? selected : { kind: "method-call", receiver: selected, method: "clone", args: [] },
        },
        discard: "unit",
        value: selected,
      },
    },
  });
  const statements = planExpressionAsStatement(node, { ...context, expressionOverrides: overrides });
  if (statements === undefined) return undefined;
  let expression: RustExpr = result;
  for (const statement of [...statements].reverse()) {
    const effect: RustExpr | undefined = statement.kind === "expr" ? statement.expr
      : statement.kind === "assign" ? { ...statement, kind: "assignment" }
      : undefined;
    if (effect === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.assignment-value-write",
        "An assignment value requires a finalized write expression in the current evaluation region.",
      ));
      return undefined;
    }
    expression = { kind: "evaluate-then", effect, discard: "unit", value: expression };
  }
  return { kind: "block", bindings: [{ name: resultName, type }], value: expression };
}

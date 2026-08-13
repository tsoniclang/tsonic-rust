import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import {
  isRustCopyCarrier,
  rustCarrierSupportsClone,
} from "../../source/rust-target-types.js";
import type { RustFlowReadProjectionFact } from "../../source/rust-facts/keys.js";
import type { RustExpr } from "../rust-ast/nodes.js";
import { missingFactDiagnostic } from "./diagnostics.js";
import { diagnosticInput } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { planRustProjectDowncastValue } from "./project-downcasts.js";
import { planRustProgramErrorFlowRead } from "./program-error-operations.js";

export function planRustFlowReadProjection(
  node: Node,
  expression: RustExpr,
  fact: RustFlowReadProjectionFact,
  context: RustPlanContext,
): RustExpr | undefined {
  const sourceCarrier = context.expressionOverrides?.get(node)?.carrier ??
    context.input.facts.getRuntimeCarrierFact(node)?.carrier;
  if (sourceCarrier === undefined ||
    !rustTargetTypeRefEquals(sourceCarrier, fact.sourceCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.flow-read-source",
      "The finalized flow-read projection conflicts with the expression's raw Rust carrier.",
    ));
    return undefined;
  }
  if (fact.kind === "option-value") {
    if (!rustCarrierSupportsClone(fact.selectedCarrier)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.flow-read-projection-clone",
        "A narrowed optional Rust value requires a selected carrier with a proven non-consuming clone contract.",
      ));
      return undefined;
    }
    return {
      kind: "match",
      expression: {
        kind: "method-call",
        receiver: expression,
        method: "as_ref",
        args: [],
      },
      arms: [
        {
          pattern: {
            kind: "tuple-variant",
            path: "Some",
            elements: [{ kind: "binding", name: "__tsonic_flow_value" }],
          },
          expression: isRustCopyCarrier(fact.selectedCarrier)
            ? {
                kind: "dereference",
                pointer: { kind: "path", path: "__tsonic_flow_value" },
              }
            : {
                kind: "method-call",
                receiver: { kind: "path", path: "__tsonic_flow_value" },
                method: "clone",
                args: [],
              },
        },
        {
          pattern: { kind: "path", path: "None" },
          expression: {
            kind: "unreachable",
            message: "checked flow selected a missing optional value",
          },
        },
      ],
    };
  }
  if (fact.kind === "program-error-variant") {
    return planRustProgramErrorFlowRead(node, expression, fact, context);
  }
  return planRustProjectDowncastValue(
    node,
    expression,
    fact.sourceCarrier,
    fact.dispatchCarrier,
    fact.selectedCarrier,
    context,
  );
}

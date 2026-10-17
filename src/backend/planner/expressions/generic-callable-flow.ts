import type { Node } from "@tsonic/tsts";
import type { RustGenericCallableConversion } from "../../../target-model/conversions/generic-callable.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput } from "../program/plan-context.js";

export function planRustGenericCallableFlow(
  node: Node, conversion: RustGenericCallableConversion, expression: RustExpr, context: RustPlanContext,
): RustExpr | undefined {
  const demanded = context.valueDestinations?.get(node);
  const application = context.input.program.callableValues.flowApplications.forNode(node, conversion, demanded);
  if (application.kind === "unavailable") return undefined;
  if (application.kind === "missing-destination") {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.generic-callable-destination",
      "A generic callable conversion requires the exact payload of its finalized physical value destination."));
    return undefined;
  }
  if (application.kind === "identity") return expression;
  const source = rustTypeFromCarrierInContext(application.source, context);
  const target = rustTypeFromCarrierInContext(application.destination, context);
  if (source?.kind !== "named" || target?.kind !== "named") return undefined;
  return { kind: "match", expression, arms: application.members.map(member => ({
    pattern: { kind: "tuple-variant", path: `${source.path}::${member.source}`,
      elements: [{ kind: "binding", name: "environment" }] },
    expression: { kind: "associated-call", owner: target, method: member.target,
      args: [{ kind: "path", path: "environment" }] },
  })) };
}

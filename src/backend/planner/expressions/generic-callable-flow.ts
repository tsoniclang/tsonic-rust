import type { Node } from "@tsonic/tsts";
import type { RustGenericCallableConversion } from "../../../target-model/conversions/generic-callable.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { failRustPlannerInvariant } from "../../invariants.js";

export function planRustGenericCallableFlow(
  node: Node, conversion: RustGenericCallableConversion, expression: RustExpr, context: RustPlanContext,
): RustExpr | undefined {
  const demanded = context.valueDestinations?.get(node);
  const application = context.input.program.records.genericCallableFlow.get(node, conversion, demanded);
  if (application === undefined || application.kind === "unavailable" || application.kind === "missing-destination")
    failRustPlannerInvariant("An admitted generic callable flow requires its exact physical destination application.", node);
  if (application.kind === "identity") return expression;
  const source = rustTypeFromCarrierInContext(application.source, context);
  const target = rustTypeFromCarrierInContext(application.destination, context);
  if (source?.kind !== "named" || target?.kind !== "named")
    failRustPlannerInvariant("An admitted generic callable flow requires its exact native variant type identities.", node);
  return { kind: "match", expression, arms: application.members.map(member => ({
    pattern: { kind: "tuple-variant", path: `${source.path}::${member.source}`,
      elements: [{ kind: "binding", name: "environment" }] },
    expression: { kind: "associated-call", owner: target, method: member.target,
      args: [{ kind: "path", path: "environment" }] },
  })) };
}

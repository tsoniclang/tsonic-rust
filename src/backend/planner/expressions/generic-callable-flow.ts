import type { Node } from "@tsonic/tsts";
import type { RustGenericCallableConversion } from "../../../target-model/conversions/generic-callable.js";
import { rustGenericCallableConversionMatches } from "../../../target-model/conversions/generic-callable.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";

export function planRustGenericCallableFlow(
  node: Node, conversion: RustGenericCallableConversion, expression: RustExpr, context: RustPlanContext,
): RustExpr | undefined {
  if (!rustGenericCallableConversionMatches(conversion, conversion.source, conversion.target)) return undefined;
  const storage = context.input.program.callableValues.nativeStorage;
  const selection = storage.operandFor(node);
  if (selection.kind === "unresolved") return undefined;
  const demanded = context.valueDestinations?.get(node);
  const selected = demanded === undefined ? storage.valueFor(node) : { kind: "identity" as const, carrier: demanded };
  if (selected.kind === "unresolved") return undefined;
  const destination = selected.carrier;
  if (rustTargetTypeRefEquals(selection.carrier, destination)) return expression;
  const physical = context.input.program.callableValues.generic.physical;
  const transition = physical.conversionFor(selection.carrier, destination);
  const source = rustTypeFromCarrierInContext(selection.carrier, context);
  const target = rustTypeFromCarrierInContext(destination, context);
  if (transition === undefined || source?.kind !== "named" || target?.kind !== "named") return undefined;
  return { kind: "match", expression, arms: transition.map(member => ({
    pattern: { kind: "tuple-variant", path: `${source.path}::${member.source.variantName}`,
      elements: [{ kind: "binding", name: "environment" }] },
    expression: { kind: "associated-call", owner: target, method: member.target.variantName,
      args: [{ kind: "path", path: "environment" }] },
  })) };
}

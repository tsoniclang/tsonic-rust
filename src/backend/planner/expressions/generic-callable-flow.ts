import type { RustGenericCallableConversion } from "../../../target-model/conversions/generic-callable.js";
import { rustGenericCallableConversionMatches } from "../../../target-model/conversions/generic-callable.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustExpr } from "../../target-ast/nodes.js";

export function planRustGenericCallableFlow(
  conversion: RustGenericCallableConversion, expression: RustExpr, context: RustPlanContext,
): RustExpr | undefined {
  if (!rustGenericCallableConversionMatches(conversion, conversion.source, conversion.target)) return undefined;
  const plan = context.input.program.callableValues.generic;
  const source = plan.definitionFor(conversion.source);
  const target = plan.definitionFor(conversion.target);
  return source !== undefined && source === target ? expression : undefined;
}

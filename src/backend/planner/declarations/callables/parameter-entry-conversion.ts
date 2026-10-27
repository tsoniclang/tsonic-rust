import type { Node } from "@tsonic/tsts";
import type { RustSourceParameterAbiFact } from "../../../../target-model/records/callables/callables-and-resources.js";

import type { RustExpr, RustStmt } from "../../../target-ast/syntax/nodes.js";
import { lowerRustValueConversion } from "../../expressions/value-conversions.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";

export function planRustParameterEntryConversion(
  parameter: Node,
  name: string,
  mutable: boolean,
  context: RustPlanContext,
): readonly RustStmt[] {
  const abi = context.input.program.records.sourceParameterAbi.get(parameter);
  if (abi === undefined) failRustPlannerInvariant("An admitted parameter requires its native source ABI.", parameter);
  if (abi.entryConversion === undefined) return [];
  const type = rustTypeFromCarrierInContext(abi.valueCarrier, context);
  const init = planRustParameterEntryValue(abi, { kind: "path", path: name }, parameter, context);
  if (type === undefined) failRustPlannerInvariant("An admitted parameter entry requires its renderable native value carrier.", parameter);
  return [{ kind: "let", name, type, mutable, init }];
}

export function planRustParameterEntryValue(
  abi: RustSourceParameterAbiFact,
  expression: RustExpr,
  parameter: Node | undefined,
  context: RustPlanContext,
): RustExpr {
  if (abi.entryConversion === undefined) return expression;
  return lowerRustValueConversion(abi.entryConversion.contract, expression, context, parameter)
    ?? failRustPlannerInvariant("An admitted parameter entry requires its native conversion plan.", parameter);
}

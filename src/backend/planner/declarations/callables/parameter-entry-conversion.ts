import type { Node } from "@tsonic/tsts";
import type { RustSourceParameterAbiFact } from "../../../../target-model/records/callables-and-resources.js";

import type { RustExpr, RustStmt } from "../../../target-ast/syntax/nodes.js";
import { lowerRustValueConversion } from "../../expressions/value-conversions.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";

export function planRustParameterEntryConversion(
  parameter: Node,
  name: string,
  mutable: boolean,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const abi = context.input.program.records.sourceParameterAbi.get(parameter);
  if (abi?.entryConversion === undefined) return [];
  const type = rustTypeFromCarrierInContext(abi.valueCarrier, context);
  const init = planRustParameterEntryValue(abi, { kind: "path", path: name }, parameter, context);
  return type === undefined || init === undefined ? undefined : [{ kind: "let", name, type, mutable, init }];
}

export function planRustParameterEntryValue(
  abi: RustSourceParameterAbiFact,
  expression: RustExpr,
  parameter: Node | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  if (abi.entryConversion === undefined) return expression;
  return lowerRustValueConversion(abi.entryConversion.contract, expression, context, parameter);
}

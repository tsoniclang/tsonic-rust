import type { Node } from "@tsonic/tsts";
import type { RustSourceParameterAbiFact } from "../../../analysis/facts/keys.js";
import { rustSourceParameterAbiFactKey } from "../../../analysis/facts/keys.js";
import { rustValueConversionContract } from "../../../target-model/conversions/contracts.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustExpr, RustStmt } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { applyRustValueConversion } from "../expressions/value-conversions.js";
import { diagnosticInput, type RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";

export function planRustParameterEntryConversion(
  parameter: Node,
  name: string,
  mutable: boolean,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const abi = context.input.program.facts.getFact(parameter, rustSourceParameterAbiFactKey);
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
  const contract = rustValueConversionContract(abi.entryConversion, context.input.program.typeDefinitions);
  if (contract === undefined || contract.fallible || abi.mode !== "value" ||
    abi.form !== "required" || !rustTargetTypeRefEquals(contract.source, abi.parameterCarrier) ||
    !rustTargetTypeRefEquals(contract.target, abi.valueCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, parameter ?? context.sourceFile),
      "rust.backend.parameter-entry-conversion", "The sealed parameter entry conversion conflicts with its native ABI."));
    return undefined;
  }
  return applyRustValueConversion(context, expression, abi.entryConversion, parameter, false);
}

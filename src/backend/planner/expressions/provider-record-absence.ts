import { rustProviderRecordAbsentFieldsMatch, type RustProviderRecordAbsentField } from "../../../target-model/conversions/provider-record-absence.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { planRustAbsentValue } from "./optional-storage.js";

export function planRustProviderRecordAbsentFields(
  fields: readonly RustProviderRecordAbsentField[], context: RustPlanContext,
): readonly { readonly name: string; readonly value: RustExpr }[] | undefined {
  if (!rustProviderRecordAbsentFieldsMatch(fields)) return undefined;
  const planned = fields.map(field => {
    const value = planRustAbsentValue(field.carrier, context);
    return value === undefined ? undefined : { name: field.targetName, value };
  });
  return planned.some(field => field === undefined) ? undefined
    : planned as readonly { readonly name: string; readonly value: RustExpr }[];
}

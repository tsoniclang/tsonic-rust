import type { RustProviderRecordAbsentField } from "../../../target-model/conversions/provider-record-absence.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { planRustAbsentValue } from "./optional-storage.js";

export function planRustProviderRecordAbsentFields(
  fields: readonly RustProviderRecordAbsentField[], context: RustPlanContext,
): readonly { readonly name: string; readonly value: RustExpr }[] {
  return fields.map(field => ({ name: field.targetName, value: planRustAbsentValue(field.carrier, context) }));
}

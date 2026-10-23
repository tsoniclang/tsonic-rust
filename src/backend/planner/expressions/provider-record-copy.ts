import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import type { Node } from "@tsonic/tsts";
import type { RustProviderRecordCopy } from "../../../target-model/conversions/provider-record.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { readRustStoredObjectField } from "../objects/project-storage.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { applyRustValueConversion } from "./value-conversions.js";
import { planRustProviderRecordAbsentFields } from "./provider-record-absence.js";

export function planProviderRecordCopy(
  conversion: RustProviderRecordCopy,
  expression: RustExpr,
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  const target = rustTypeFromCarrierInContext(conversion.target, context);
  if (target?.kind !== "named" || context.syntheticNames === undefined)
    failRustPlannerInvariant("An admitted native record copy requires its target type and name scope.", node);
  const name = allocateRustSyntheticName(context.syntheticNames, "record_source");
  const fields = conversion.fields.map(field => {
    const source = readRustStoredObjectField("structural-object", conversion.source,
      { kind: "path", path: name }, field.storageIndex, field.sourceCarrier, context);
    if (source === undefined) failRustPlannerInvariant("An admitted native record copy requires its selected source field.", node);
    const value = applyRustValueConversion(context, { stage: "finalized", expression: source }, field.conversion, node);
    if (value === undefined) failRustPlannerInvariant("An admitted native record copy requires its field conversion.", node);
    return { name: field.targetName, value };
  });
  const absentFields = planRustProviderRecordAbsentFields(conversion.absentFields, context);
  return rustValueBlock([{ name, value: expression }], {
    kind: "struct-literal", path: target.path,
    fields: [...fields, ...absentFields],
    ...(conversion.completion === "default"
      ? { base: { kind: "call" as const, path: "Default::default", args: [] } }
      : {}),
  });
}

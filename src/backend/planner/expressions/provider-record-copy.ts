import type { Node } from "@tsonic/tsts";
import type { RustProviderRecordCopy } from "../../../target-model/conversions/provider-record.js";
import { rustProviderRecordCopyMatches } from "../../../target-model/conversions/provider-record.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { readRustStoredObjectField } from "../objects/project-storage.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";

export function planProviderRecordCopy(
  conversion: RustProviderRecordCopy,
  expression: RustExpr,
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  if (!rustProviderRecordCopyMatches(conversion, conversion.source, conversion.target, context.input.program.typeDefinitions)) return undefined;
  const target = rustTypeFromCarrierInContext(conversion.target, context);
  if (target?.kind !== "named") return undefined;
  const name = allocateRustSyntheticName(context.syntheticNames ??
    createRustSyntheticNameState(context.input.program.source.ast, node, []), "record_source");
  const fields = conversion.fields.map(field => {
    const plan = context.input.program.structuralShapes.field(conversion.source, field.storageIndex);
    if (plan?.storage !== "stored" || plan.method === true ||
      !rustTargetTypeRefEquals(plan.carrier, field.carrier)) return undefined;
    const value = readRustStoredObjectField("structural-object", conversion.source,
      { kind: "path", path: name }, field.storageIndex, field.carrier, context);
    return value === undefined ? undefined : { name: field.targetName, value };
  });
  if (fields.some(field => field === undefined)) return undefined;
  return { kind: "block", bindings: [{ name, value: expression }], value: {
    kind: "struct-literal", path: target.path,
    fields: fields as { readonly name: string; readonly value: RustExpr }[],
    ...(conversion.completion === "default"
      ? { base: { kind: "call" as const, path: "Default::default", args: [] } }
      : {}),
  } };
}

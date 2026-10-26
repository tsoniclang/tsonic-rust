import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustOptionalStorageRequirement } from "../../../target-model/records/generic-requirements.js";
import type { RustGenericParameter, RustCallGenericArgument } from "../../target-ast/syntax/nodes.js";
import { rustTypeFromCarrierInContext, type RustTypeRenderingContext } from "./render.js";
import { rustGenericRequirementBounds } from "./generic-bounds.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";

export function rustOptionalStorageParameters(
  requirements: readonly RustOptionalStorageRequirement[], context: RustTypeRenderingContext,
): readonly RustGenericParameter[] {
  return requirements.map(entry => {
    const value = rustTypeFromCarrierInContext(entry.carrier.optionalStorageValue, context);
    if (value === undefined) failRustPlannerInvariant("An admitted optional storage bound requires its exact native value type.");
    context.usedAliases?.add("rt");
    return { kind: "type", name: context.typeParameterNames?.get(entry.carrier.identity) ?? entry.carrier.name, bounds: [
      { kind: "trait-type", reference: { trait: { kind: "named", path: "rt::OptionalStorage", genericArguments: [{ kind: "type", type: value }] } } },
      ...rustGenericRequirementBounds(entry.requirements),
    ] };
  });
}

export function rustOptionalStorageCallArguments(node: Node, context: RustTypeRenderingContext): readonly RustCallGenericArgument[] {
  const selected = context.input.program.records.optionalStorageCallArguments.get(node);
  if (selected === undefined) failRustPlannerInvariant("An admitted source call requires its exact sealed optional storage arguments.", node);
  return renderOptionalStorageArguments(selected, context, node);
}

export function rustOptionalStorageTypeArguments(
  carrier: TargetTypeRef, context: RustTypeRenderingContext, parameterIndexes?: readonly number[],
  position: "general" | "parameter" | "return" = "general",
): readonly RustCallGenericArgument[] {
  const selected = context.input.program.records.optionalStorageTypeArguments.get(carrier, parameterIndexes);
  if (selected === undefined) failRustPlannerInvariant(`An admitted native type requires its exact sealed optional storage arguments. key=${closedMetadataKey([carrier, parameterIndexes ?? null])}`);
  return renderOptionalStorageArguments(selected, context, undefined, position);
}

function renderOptionalStorageArguments(
  selected: readonly TargetTypeRef[], context: RustTypeRenderingContext, node?: Node,
  position: "general" | "parameter" | "return" = "general",
): readonly RustCallGenericArgument[] {
  return selected.map(carrier => {
    const type = rustTypeFromCarrierInContext(carrier, context, position);
    if (type === undefined) failRustPlannerInvariant("An admitted optional storage argument requires its exact native type.", node);
    return { kind: "type", type };
  });
}

import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustOptionalStorageRequirement } from "../../../analysis/declarations/type-projections.js";
import {
  selectRustOptionalStorageCallArguments,
  selectRustOptionalStorageTypeArguments,
} from "../../../analysis/declarations/type-projections.js";
import type { RustGenericParameter, RustCallGenericArgument } from "../../target-ast/syntax/nodes.js";
import { rustTypeFromCarrierInContext, type RustTypeRenderingContext } from "./render.js";
import { rustGenericRequirementBounds } from "./generic-bounds.js";

export function rustOptionalStorageParameters(
  requirements: readonly RustOptionalStorageRequirement[],
  context: RustTypeRenderingContext,
): readonly RustGenericParameter[] {
  return requirements.filter(entry => !entry.captured).map(entry => {
    const value = rustTypeFromCarrierInContext(entry.carrier.optionalStorageValue, context);
    if (value === undefined) throw new Error("A sealed optional storage bound has no renderable value type.");
    context.usedAliases?.add("rt");
    return { kind: "type", name: context.typeParameterNames?.get(entry.carrier.identity) ?? entry.carrier.name, bounds: [
      { kind: "trait-type", reference: { trait: { kind: "named", path: "rt::OptionalStorage",
        genericArguments: [{ kind: "type", type: value }] } } },
      ...rustGenericRequirementBounds(entry.requirements),
    ] };
  });
}

export function rustOptionalStorageCallArguments(
  declaration: Node,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
  context: RustTypeRenderingContext,
  typeParameterNames?: ReadonlySet<string>,
): readonly RustCallGenericArgument[] {
  const selected = selectRustOptionalStorageCallArguments(declaration, substitutions, {
    genericRequirements: context.input.program.declarationGenericRequirements,
    projectTypes: context.input.program.projectTypes,
    normalize: context.input.program.typeFamilies.normalize,
  }, typeParameterNames);
  return selected.map(argument => {
    const type = argument.kind !== "type" ? undefined : rustTypeFromCarrierInContext(argument.type, context);
    if (type === undefined) throw new Error("An optional storage argument has no exact native type.");
    return { kind: "type", type };
  });
}

export function rustOptionalStorageTypeArguments(
  carrier: TargetTypeRef,
  context: RustTypeRenderingContext,
  parameterIndexes?: readonly number[],
): readonly RustCallGenericArgument[] {
  const selected = selectRustOptionalStorageTypeArguments(carrier, {
    genericRequirements: context.input.program.declarationGenericRequirements,
    projectTypes: context.input.program.projectTypes,
    normalize: context.input.program.typeFamilies.normalize,
  }, parameterIndexes);
  return selected.map(argument => {
    const type = argument.kind !== "type" ? undefined : rustTypeFromCarrierInContext(argument.type, context);
    if (type === undefined) throw new Error("An optional storage argument has no exact native type.");
    return { kind: "type", type };
  });
}

import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustOptionalStorageRequirement } from "../../../analysis/declarations/type-projections.js";
import type { RustGenericParameter, RustCallGenericArgument } from "../../target-ast/nodes.js";
import { substituteRustTargetTypeParameters } from "../../../target-model/types/carriers/substitution.js";
import { rustTypeFromCarrierInContext, type RustTypeRenderingContext } from "./render.js";
import { rustGenericRequirementBounds } from "./generic-bounds.js";
import { rustSourceTypeCarrierValue } from "../../../target-model/types/carriers/source-types.js";
import { rustTargetTypeParameterNames } from "../../../target-model/types/carriers/generic-references.js";

export function rustOptionalStorageParameters(
  requirements: readonly RustOptionalStorageRequirement[],
  context: RustTypeRenderingContext,
): readonly RustGenericParameter[] {
  return requirements.filter(entry => !entry.captured).map(entry => {
    const value = rustTypeFromCarrierInContext(entry.carrier.optionalStorageValue, context);
    if (value === undefined) throw new Error("A sealed optional storage bound has no renderable value type.");
    context.usedAliases?.add("rt");
    return { kind: "type", name: entry.carrier.name, bounds: [
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
  const contract = context.input.program.declarationGenericRequirements.contractFor(declaration);
  if (contract === undefined) throw new Error("A source call lost its sealed generic requirements.");
  return contract.optionalStorage.filter(entry => !entry.captured && (typeParameterNames === undefined ||
    rustTargetTypeParameterNames(entry.carrier).every(name => typeParameterNames.has(name)))).map(entry => {
    const carrier = substituteRustTargetTypeParameters(entry.carrier, substitutions);
    const type = rustTypeFromCarrierInContext(carrier, context);
    if (type === undefined) throw new Error("An optional storage argument has no exact native type.");
    return { kind: "type", type };
  });
}

export function rustOptionalStorageTypeArguments(
  carrier: TargetTypeRef,
  context: RustTypeRenderingContext,
  parameterIndexes?: readonly number[],
): readonly RustCallGenericArgument[] {
  const definition = context.input.program.projectTypes.definitionForCarrier(carrier);
  if (definition === undefined) return [];
  const source = rustSourceTypeCarrierValue(carrier);
  if (source === undefined) throw new Error("A source storage projection lost its native class arguments.");
  const substitutions = new Map<string, TargetTypeRef>();
  for (const [index, parameter] of definition.genericParameters.entries()) {
    const argument = source.genericArguments[index];
    if (argument?.kind !== parameter.kind) throw new Error("A source storage projection has inconsistent class arity.");
    if (parameter.kind === "type" && argument.kind === "type") substitutions.set(parameter.targetName, argument.type);
  }
  const typeParameterNames = parameterIndexes === undefined ? undefined : new Set(parameterIndexes.flatMap(index => {
    const parameter = definition.genericParameters[index];
    if (parameter === undefined) throw new Error("A source storage projection selects an undeclared type parameter.");
    return parameter.kind === "type" ? [parameter.targetName] : [];
  }));
  return rustOptionalStorageCallArguments(definition.declaration, substitutions, context, typeParameterNames);
}

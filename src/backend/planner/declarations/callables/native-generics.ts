import type { Node } from "@tsonic/tsts";
import { rustNativeCallableInputUsesProtocol } from "../../../../analysis/callables/native-inputs.js";
import { allocateRustGeneratedName } from "../../../../target-model/names/generated.js";
import type { RustGenericParameter, RustGenerics } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type { RustCallableGenericPlan } from "./generics.js";

export function planRustNativeCallableGenerics(
  declaration: Node,
  source: RustCallableGenericPlan,
): RustCallableGenericPlan | undefined {
  const inputs = source.context.input.program.callableValues.native.inputsFor(declaration)
    .filter(rustNativeCallableInputUsesProtocol);
  if (inputs.length === 0) return source;
  const sourceGenerics = source.finalizeGenerics();
  const typeParameterNames = new Map(source.context.typeParameterNames);
  const usedNames = new Set([...typeParameterNames.values(), ...sourceGenerics.parameters.map(parameter => parameter.name)]);
  for (const input of inputs) typeParameterNames.set(input.implementation.identity,
    allocateRustGeneratedName(usedNames, input.implementation.name));
  const context: RustPlanContext = { ...source.context, typeParameterNames };
  const parameters: RustGenericParameter[] = [];
  for (const input of inputs) {
    const trait = rustTypeFromCarrierInContext(input.protocol.trait, context);
    if (trait === undefined) return undefined;
    parameters.push({ kind: "type", name: typeParameterNames.get(input.implementation.identity)!,
      bounds: [{ kind: "trait-type", reference: { trait } }] });
  }
  const generics: RustGenerics = { parameters: [...sourceGenerics.parameters, ...parameters],
    wherePredicates: sourceGenerics.wherePredicates };
  return { ...source, context, finalizeGenerics: () => generics };
}

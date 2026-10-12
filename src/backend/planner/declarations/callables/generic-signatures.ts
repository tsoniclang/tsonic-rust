import type { RustGenericCallableDefinition, RustGenericCallableImplementation } from "../../../../analysis/callables/generic-values.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustPlanContext } from "../../program/plan-context.js";

export function rustGenericCallableImplementationSubstitutions(
  definition: RustGenericCallableDefinition,
  implementation: RustGenericCallableImplementation,
  context: RustPlanContext,
): ReadonlyMap<string, TargetTypeRef> | undefined {
  const source = context.input.program.sourceLifetimes.contractFor(implementation.declaration);
  const parameters = source?.parameters ??
    (context.input.program.source.ast.typeParameters(implementation.declaration).length === 0 ? [] : undefined);
  if (parameters === undefined || parameters.length !== definition.signature.typeParameters.length ||
    parameters.some(parameter => parameter.kind !== "type")) return undefined;
  const substitutions = new Map(implementation.substitutions);
  for (const [index, parameter] of parameters.entries()) {
    if (parameter.kind !== "type") return undefined;
    substitutions.set(parameter.identity, definition.signature.typeParameters[index]!);
  }
  return substitutions;
}

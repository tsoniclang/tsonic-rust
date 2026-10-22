import type { RustProjectTypeDefinition } from "../../../target-model/types/project-types.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { authoredTypeParameterNames, generatedTypeParameterNames } from "@tsonic/target-api/source";
import { rustTypeParameterFromSourceContract } from "../../../target-model/types/carriers/generic-references.js";

export function rustGeneratedTypeParameterContext<Context extends { readonly typeParameterNames?: ReadonlyMap<string, string> }>(
  parameters: readonly { readonly identity: string; readonly name: string }[],
  authoredNames: Iterable<string>, context: Context,
): Context & { readonly typeParameterNames: ReadonlyMap<string, string> } {
  return { ...context, typeParameterNames: new Map([
    ...context.typeParameterNames ?? [], ...generatedTypeParameterNames(parameters, authoredNames),
  ]) };
}

export function rustProjectTypeParameterContext(
  definition: RustProjectTypeDefinition, context: RustPlanContext, scope: "declaration" | "implementation",
): RustPlanContext {
  const ast = context.input.program.source.ast;
  const parameters = definition.genericParameters.filter(parameter => parameter.kind === "type");
  const ownParameters = parameters.filter(parameter => ast.parent(parameter.declaration) === definition.declaration);
  const ownIdentities = new Set(ownParameters.map(parameter => parameter.identity));
  const generated = scope === "implementation" ? parameters : parameters.filter(parameter => !ownIdentities.has(parameter.identity));
  const reserved = authoredTypeParameterNames(definition.declaration, ast,
    scope === "implementation" ? ownIdentities : undefined);
  const names = new Map(context.typeParameterNames);
  for (const parameter of ownParameters) names.set(parameter.identity, parameter.targetName);
  return rustGeneratedTypeParameterContext(generated.map(rustTypeParameterFromSourceContract), reserved,
    { ...context, typeParameterNames: names });
}

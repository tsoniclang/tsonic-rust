import type { Type } from "@tsonic/tsts";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import { resolveRustTargetType } from "./target.js";

export function bindRustSourceAliasArguments(
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): RustTargetTypeResolutionContext | undefined {
  const application = context.currentSemantics.types.aliasApplication(type);
  if (application === undefined) return context;
  const substitutions = new Map(context.sourceTypeParameterSubstitutions);
  for (const binding of application.bindings) {
    const owner = context.ast.parent(binding.declaration);
    const parameter = owner === undefined ? undefined : context.sourceLifetimes.contractFor(owner)?.parameters
      .find(parameter => parameter.declaration === binding.declaration);
    if (parameter?.kind !== "type") continue;
    const existing = substitutions.get(binding.declaration);
    const carrier = existing?.sourceType === binding.argument ? existing.carrier
      : resolveRustTargetType(binding.argument, context, options, resolving);
    if (carrier === undefined) return undefined;
    substitutions.set(binding.declaration, { sourceType: binding.argument, carrier });
  }
  return { ...context, sourceTypeParameterSubstitutions: substitutions };
}

export function selectedRustSourceTypeArgument(type: Type, context: RustTargetTypeResolutionContext): Type {
  const symbol = context.currentSemantics.declarations.typeSymbol(type);
  const declaration = symbol === undefined ? undefined : context.currentSemantics.declarations.primarySymbolDeclaration(symbol);
  return declaration === undefined || context.ast.kindName(declaration) !== "KindTypeParameter"
    ? type : context.sourceTypeParameterSubstitutions?.get(declaration)?.sourceType ?? type;
}

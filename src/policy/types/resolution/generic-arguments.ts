import type { Node, Type } from "@tsonic/tsts";
import type { RustSelectedTargetSignature, RustTargetGenericArgument } from "../../../target-model/types/model.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import { resolveRustTargetType } from "./target.js";
import { resolveRustAuthoredTargetType } from "./tuples.js";

export function bindRustSelectedCallTypeArguments(
  sourceArguments: NonNullable<RustSelectedTargetSignature["sourceSelectedMethodTypeArguments"]>,
  targetArguments: readonly RustTargetGenericArgument[],
  context: RustTargetTypeResolutionContext,
): RustTargetTypeResolutionContext | undefined {
  if (sourceArguments.length !== targetArguments.length) return undefined;
  if (sourceArguments.length === 0) return context;
  const substitutions = new Map(context.sourceTypeParameterSubstitutions);
  const declarations = new Set<Node>();
  for (const [index, argument] of sourceArguments.entries()) {
    const target = targetArguments[index]!;
    if (target.kind !== "type") continue;
    const symbol = context.currentSemantics.declarations.typeSymbol(argument.typeParameter);
    const declaration = symbol === undefined ? undefined : context.currentSemantics.declarations.primarySymbolDeclaration(symbol);
    if (declaration === undefined || context.ast.kindName(declaration) !== "KindTypeParameter" ||
      declarations.has(declaration)) return undefined;
    declarations.add(declaration);
    substitutions.set(declaration, { sourceType: argument.selectedType, carrier: target.type });
  }
  return { ...context, sourceTypeParameterSubstitutions: substitutions };
}

export function bindRustSourceAliasArguments(
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
  authoredTypeNode?: Node,
): RustTargetTypeResolutionContext | undefined {
  const application = context.currentSemantics.types.aliasApplication(type);
  if (application === undefined) return context;
  const authoredType = authoredTypeNode === undefined ? undefined : context.semanticsFor(authoredTypeNode).types.authoredType(authoredTypeNode);
  const authoredApplication = authoredType === undefined ? undefined : context.currentSemantics.types.aliasApplication(authoredType);
  if (authoredApplication !== undefined && authoredApplication.declaration !== application.declaration) return undefined;
  const parameters = context.ast.typeParameters(application.declaration);
  const argumentNodes = authoredTypeNode !== undefined && authoredApplication !== undefined &&
    context.ast.is.IsTypeReferenceNode(authoredTypeNode) ? context.ast.typeArguments(authoredTypeNode) : [];
  const substitutions = new Map(context.sourceTypeParameterSubstitutions);
  for (const binding of application.bindings) {
    const owner = context.ast.parent(binding.declaration);
    const parameter = owner === undefined ? undefined : context.sourceLifetimes.contractFor(owner)?.parameters
      .find(parameter => parameter.declaration === binding.declaration);
    if (parameter?.kind !== "type") continue;
    const existing = substitutions.get(binding.declaration);
    const argumentNode = argumentNodes[parameters.indexOf(binding.declaration)];
    const authoredBinding = authoredApplication?.bindings.find(candidate => candidate.declaration === binding.declaration);
    const carrier = argumentNode !== undefined ? resolveRustAuthoredTargetType(argumentNode, context, options, resolving)
      : authoredBinding !== undefined ? resolveRustTargetType(authoredBinding.argument, context, options, resolving)
      : existing?.sourceType === binding.argument ? existing.carrier
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

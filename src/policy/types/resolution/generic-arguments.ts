import type { Node, Type } from "@tsonic/tsts";
import { TypeReferenceNode_TypeName } from "@tsonic/target-api/source";
import type { RustSelectedTargetSignature, RustTargetGenericArgument, TargetTypeRef } from "../../../target-model/types/model.js";
import { rustSourceTypeParameters } from "../../../target-model/names/type-parameters.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import { resolveRustTargetType } from "./target.js";
import { resolveRustAuthoredTargetType } from "./tuples.js";

export function rustSelectedCallTypeParameters(
  sourceArguments: NonNullable<RustSelectedTargetSignature["sourceSelectedMethodTypeArguments"]>,
  context: RustTargetTypeResolutionContext,
): readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[] | undefined {
  const declarations = sourceArguments.map(argument => sourceTypeParameterDeclaration(argument.typeParameter, context));
  if (declarations.some(declaration => declaration === undefined)) return undefined;
  return rustSourceTypeParameters(declarations.filter(declaration => declaration !== undefined), context.ast);
}

function sourceTypeParameterDeclaration(type: Type, context: RustTargetTypeResolutionContext): Node | undefined {
  const symbol = context.currentSemantics.declarations.typeSymbol(type);
  const declaration = symbol === undefined ? undefined : context.currentSemantics.declarations.primarySymbolDeclaration(symbol);
  return declaration !== undefined && context.ast.is.IsTypeParameterDeclaration(declaration) ? declaration : undefined;
}

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
    const declaration = sourceTypeParameterDeclaration(argument.typeParameter, context);
    if (declaration === undefined ||
      declarations.has(declaration)) return undefined;
    declarations.add(declaration);
    substitutions.set(declaration, { sourceType: argument.selectedType, carrier: target.type });
  }
  return { ...context, sourceTypeParameterSubstitutions: substitutions };
}

export function bindRustCallableTypeParameters(
  declaration: Node,
  targetParameters: readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[],
  context: RustTargetTypeResolutionContext,
): RustTargetTypeResolutionContext | undefined {
  const parameters = context.sourceLifetimes.contractFor(declaration)?.parameters ?? [];
  if (parameters.length !== targetParameters.length ||
    parameters.some(parameter => parameter.kind !== "type") ||
    new Set(targetParameters.map(parameter => parameter.identity)).size !== targetParameters.length) return undefined;
  if (parameters.length === 0) return context;
  const semantics = context.semanticsFor(declaration);
  const substitutions = new Map(context.sourceTypeParameterSubstitutions);
  const declarations = new Set<Node>();
  for (const [index, parameter] of parameters.entries()) {
    const sourceType = semantics.declarations.declaredType(parameter.declaration);
    const symbol = sourceType === undefined ? undefined : semantics.declarations.typeSymbol(sourceType);
    if (sourceType === undefined || symbol === undefined || declarations.has(parameter.declaration) ||
      semantics.declarations.primarySymbolDeclaration(symbol) !== parameter.declaration) return undefined;
    declarations.add(parameter.declaration);
    substitutions.set(parameter.declaration, { sourceType, carrier: targetParameters[index]! });
  }
  return { ...context, currentSemantics: semantics, sourceTypeParameterSubstitutions: substitutions };
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
  const reference = authoredTypeNode === undefined || !context.ast.is.IsTypeReferenceNode(authoredTypeNode)
    ? undefined : context.source.navigation.sourceReferenceFor(TypeReferenceNode_TypeName(context.ast, authoredTypeNode));
  const argumentNodes = authoredTypeNode !== undefined && reference?.declaration === application.declaration
    ? context.ast.typeArguments(authoredTypeNode) : [];
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
      : existing?.sourceType === binding.argument ? existing.carrier
      : authoredBinding !== undefined ? resolveRustTargetType(authoredBinding.argument, context, options, resolving)
      : resolveRustTargetType(binding.argument, context, options, resolving);
    if (carrier === undefined) return undefined;
    substitutions.set(binding.declaration, { sourceType: binding.argument, carrier });
  }
  return { ...context, sourceTypeParameterSubstitutions: substitutions };
}

export function bindRustSourceDeclarationArguments(
  declaration: Node,
  selectedType: Type,
  arguments_: readonly RustTargetGenericArgument[],
  context: RustTargetTypeResolutionContext,
): RustTargetTypeResolutionContext | undefined {
  const parameters = context.sourceLifetimes.contractFor(declaration)?.parameters ?? [];
  if (parameters.length !== arguments_.length ||
    parameters.some((parameter, index) => parameter.kind !== arguments_[index]?.kind)) return undefined;
  if (parameters.length === 0) return context;
  const substitutions = new Map(context.sourceTypeParameterSubstitutions);
  for (const [index, parameter] of parameters.entries()) {
    const argument = arguments_[index]!;
    if (parameter.kind !== "type" || argument.kind !== "type") continue;
    const sourceType = selectedRustSourceDeclarationArgument(selectedType, parameter.declaration, context);
    if (sourceType === undefined) return undefined;
    substitutions.set(parameter.declaration, { sourceType, carrier: argument.type });
  }
  return { ...context, sourceTypeParameterSubstitutions: substitutions };
}

export function selectedRustSourceDeclarationArgument(
  type: Type,
  parameter: Node,
  context: RustTargetTypeResolutionContext,
): Type | undefined {
  const alias = context.currentSemantics.types.aliasApplication(type)?.bindings
    .filter(binding => binding.declaration === parameter).map(binding => binding.argument) ?? [];
  const referenced = context.currentSemantics.types.typeArgumentBindings(type)
    ?.filter(binding => binding.declaration === parameter).map(binding => binding.argumentType) ?? [];
  if (alias.length > 1 || referenced.length > 1) return undefined;
  const arguments_ = [...new Set([...alias, ...referenced])];
  return arguments_.length === 1 ? arguments_[0] : undefined;
}

export function resolveRustSelectedTypeArguments(
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): readonly TargetTypeRef[] | undefined {
  const arguments_ = context.currentSemantics.types.effectiveTypeArguments(type);
  if (arguments_ === undefined) return undefined;
  const bindings = context.currentSemantics.types.typeArgumentBindings(type)
    ?.filter(binding => binding.scope === "local");
  if (bindings !== undefined && (bindings.length !== arguments_.length ||
    new Set(bindings.map(binding => binding.declaration)).size !== bindings.length ||
    bindings.some((binding, index) => binding.argumentType !== arguments_[index]))) return undefined;
  const carriers = arguments_.map((argument, index) => {
    const declaration = bindings?.[index]?.declaration;
    const selected = declaration === undefined ? undefined
      : context.sourceTypeParameterSubstitutions?.get(declaration);
    return selected?.sourceType === argument ? selected.carrier
      : resolveRustTargetType(argument, context, options, resolving);
  });
  return carriers.some(carrier => carrier === undefined)
    ? undefined : Object.freeze(carriers as readonly TargetTypeRef[]);
}

export function resolveRustSourceDeclarationArguments(
  argumentNodes: readonly Node[],
  contract: import("../../../target-model/lifetimes/index.js").RustSourceGenericContract,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
  selectedType: Type | undefined,
): import("./project.js").RustResolvedProjectGenericArguments | undefined {
  if (argumentNodes.length > contract.parameters.length) return undefined;
  const values: import("../../../target-model/types/model.js").RustTargetGenericArgument[] = [];
  for (const [index, parameter] of contract.parameters.entries()) {
    const argument = argumentNodes[index] ?? context.ast.as.AsTypeParameterDeclaration(parameter.declaration)?.DefaultType;
    if (argument === undefined) return undefined;
    if (parameter.kind === "lifetime") {
      const lifetime = context.sourceLifetimes.resolve(argument);
      if (lifetime === undefined) return undefined;
      values.push(Object.freeze({ kind: "lifetime", lifetime }));
    } else {
      const type = resolveRustAuthoredTargetType(argument, context, options, resolving);
      if (type === undefined) return undefined;
      values.push(Object.freeze({ kind: "type", type }));
      const sourceType = selectedType === undefined ? undefined
        : selectedRustSourceDeclarationArgument(selectedType, parameter.declaration, context);
      if (sourceType !== undefined) {
        const substitutions = new Map(context.sourceTypeParameterSubstitutions);
        substitutions.set(parameter.declaration, { sourceType, carrier: type });
        context = { ...context, sourceTypeParameterSubstitutions: substitutions };
      } else if (argumentNodes[index] === undefined) return undefined;
    }
  }
  return Object.freeze({ values: Object.freeze(values) });
}

export function selectedRustSourceTypeArgument(type: Type, context: RustTargetTypeResolutionContext): Type {
  const declaration = sourceTypeParameterDeclaration(type, context);
  return declaration === undefined
    ? type : context.sourceTypeParameterSubstitutions?.get(declaration)?.sourceType ?? type;
}

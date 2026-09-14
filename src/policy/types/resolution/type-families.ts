import type { Node, Type, TypeAliasApplicationInfo } from "@tsonic/tsts";
import { Node_Type, sourceNodeIdentity, TypeReferenceNode_TypeName } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustSourceTypeFamily } from "../type-families.js";
import { rustSourceTypeCarrierValue, rustStructuralObjectCarrierValue } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustTargetTypeParameterNames } from "../../../target-model/types/carriers/generic-references.js";
import { inferRustTargetTypeParameterBindings } from "../../../target-model/types/carriers/generic-inference.js";
import { substituteRustTargetTypeParameters } from "../../../target-model/types/carriers/substitution.js";
import { resolveRustAuthoredTargetType } from "./tuples.js";
import { resolveRustTargetType } from "./target.js";
import { resolveSourcePrimitive } from "./callables.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";

export interface RustConditionalAliasSelection {
  readonly carrier: TargetTypeRef | undefined;
}

export function resolveRustConditionalAlias(
  node: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): RustConditionalAliasSelection | undefined {
  const { ast } = context;
  if (ast.kindName(node) !== "KindTypeReference") return undefined;
  const declaration = context.source.navigation.sourceReferenceFor(TypeReferenceNode_TypeName(ast, node))?.declaration;
  if (declaration === undefined || ast.kindName(declaration) !== "KindTypeAliasDeclaration") return undefined;
  const parameters = ast.typeParameters(declaration);
  if (parameters.length === 0) return undefined;
  const argumentNodes = ast.typeArguments(node);
  if (parameters.some(parameter => parameter === undefined) ||
    argumentNodes.length !== parameters.length || argumentNodes.some(argument => argument === undefined)) {
    return undefined;
  }
  const arguments_ = argumentNodes.map(argument => context.semanticsFor(argument!).types.expressionType(argument!));
  if (arguments_.some(argument => argument === undefined)) return undefined;
  const application = context.currentSemantics.types.instantiateAlias(declaration, arguments_ as readonly Type[]);
  if (application?.kind !== "conditional") return undefined;
  if (resolving.has(node)) return { carrier: undefined };
  resolving.add(node);
  try {
    const carriers = argumentNodes.map(argument => resolveRustAuthoredTargetType(argument!, context, options, resolving));
    if (carriers.some(carrier => carrier === undefined)) return { carrier: undefined };
    return { carrier: resolveRustTypeFamilyApplication(application, carriers as readonly TargetTypeRef[], context, options, resolving) };
  } finally {
    resolving.delete(node);
  }
}

export function resolveRustTypeFamilyApplication(
  application: TypeAliasApplicationInfo,
  arguments_: readonly TargetTypeRef[],
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  if (application.kind !== "conditional" || arguments_.length !== application.bindings.length) return undefined;
  const root = application.conditionalSteps[0];
  const family = root === undefined ? undefined : sourceFamily(root.conditional, context);
  if (family === undefined || application.bindings.length !== 1) return undefined;
  const rootBinding = root!.bindings.find(binding => binding.declarations.includes(family.parameter));
  const parameterIndex = application.bindings.findIndex(binding => binding.parameter === rootBinding?.applicationParameter);
  const owner = arguments_[parameterIndex];
  if (parameterIndex < 0 || owner === undefined || !options.sourceTypes.typeFamilies.register(family)) return undefined;
  const deferred = application.conditionalSteps.filter(step => step.branch === "deferred");
  if (deferred.length > 0) {
    if (application.conditionalSteps.length !== 1 || deferred[0]!.conditional !== root!.conditional) return undefined;
    return Object.freeze({ kind: "associated-type", owner, trait: family.trait, name: "Output" });
  }
  const declaration = options.sourceTypes.declarationForCarrier(owner);
  const sourceOwner = rustSourceTypeCarrierValue(owner);
  if (declaration !== undefined && (sourceOwner?.genericArguments.length ?? 0) > 0) {
    const template = context.currentSemantics.declarations.declaredType(declaration);
    const templateOwner = template === undefined ? undefined : resolveRustTargetType(template, context, options, resolving);
    if (templateOwner === undefined) return undefined;
    if (!rustTargetTypeRefEquals(templateOwner, owner)) {
      const bindings = inferRustTargetTypeParameterBindings(templateOwner, owner,
        new Set(rustTargetTypeParameterNames(templateOwner)));
      const templateApplication = context.currentSemantics.types.instantiateAlias(family.declaration, [template!]);
      if (bindings === undefined || templateApplication === undefined) return undefined;
      const output = resolveRustTypeFamilyApplication(templateApplication, [templateOwner], context, options, resolving);
      return output === undefined ? undefined : substituteRustTargetTypeParameters(output, bindings);
    }
  }
  const substitutions = new Map(context.sourceTypeParameterSubstitutions);
  for (const [index, binding] of application.bindings.entries()) {
    substitutions.set(binding.declaration, arguments_[index]!);
  }
  let result: TargetTypeRef | undefined;
  for (const step of application.conditionalSteps) {
    if (step.selectedNode === undefined || step.selectedType === undefined) return undefined;
    for (const binding of step.bindings) {
      const index = application.bindings.findIndex(candidate => candidate.parameter === binding.applicationParameter);
      const argument = index < 0 ? inferredArgumentCarrier(binding.argument, context, options, resolving) : arguments_[index];
      if (argument !== undefined) {
        for (const declaration of binding.declarations) substitutions.set(declaration, argument);
      }
    }
    if (context.ast.kindName(step.selectedNode) === "KindConditionalType") continue;
    const selected = resolveRustAuthoredTargetType(step.selectedNode, {
      ...context,
      sourceTypeParameterSubstitutions: substitutions,
    }, options, resolving);
    if (selected === undefined || result !== undefined && !rustTargetTypeRefEquals(result, selected)) return undefined;
    result = selected;
  }
  if (result === undefined) return undefined;
  const ownerFileName = rustSourceTypeCarrierValue(owner)?.fileName ??
    rustStructuralObjectCarrierValue(owner)?.ownerFileName ?? family.trait.sourceItem?.fileName;
  if (ownerFileName === undefined || !options.sourceTypes.typeFamilies.registerImplementation({
    family, owner, output: result, sourceFileName: ownerFileName,
  })) return undefined;
  return result;
}

function sourceFamily(
  conditional: Node,
  context: RustTargetTypeResolutionContext,
): RustSourceTypeFamily | undefined {
  const { ast } = context;
  let body = conditional;
  let declaration = ast.parent(body);
  while (declaration !== undefined && ast.kindName(declaration) === "KindParenthesizedType") {
    body = declaration;
    declaration = ast.parent(body);
  }
  if (declaration === undefined || ast.kindName(declaration) !== "KindTypeAliasDeclaration" ||
    Node_Type(ast, declaration) !== body) return undefined;
  const parameters = ast.typeParameters(declaration);
  const parameter = parameters[0];
  if (parameters.length !== 1 || parameter === undefined) return undefined;
  const identity = sourceNodeIdentity(ast, conditional);
  const fileName = ast.getFileName(ast.getSourceFile(declaration));
  const typeName = ast.text(ast.name(declaration));
  if (identity === undefined || fileName.length === 0 || typeName.length === 0 ||
    !context.source.navigation.isProjectDeclaration(declaration)) return undefined;
  return Object.freeze({
    declaration,
    parameter,
    trait: Object.freeze({
      kind: "trait-ref",
      id: identity,
      path: typeName,
      sourceItem: Object.freeze({ fileName, typeName }),
      genericArguments: Object.freeze([]),
      associatedConstraints: Object.freeze([]),
    }),
  });
}

function inferredArgumentCarrier(
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const primitive = resolveSourcePrimitive(type, context);
  if (primitive !== undefined) return primitive;
  if (context.currentSemantics.types.isNumberLike(type) || context.currentSemantics.types.isBigIntLike(type)) return undefined;
  return resolveRustTargetType(type, context, options, resolving);
}

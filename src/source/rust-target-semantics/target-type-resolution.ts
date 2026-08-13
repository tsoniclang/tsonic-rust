import {
  functionPointerFactKey,
  pointerFactKey,
  providerVirtualDeclarationFactKey,
  sourcePrimitiveFactKey,
} from "@tsonic/tsts";
import type {
  ExtensionFactSubject,
  Node,
  ProviderDeclarationIdentity,
  SourceFile,
  Symbol,
  Type,
} from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api";
import {
  ArrayTypeNode_ElementType,
  Node_Initializer,
  Node_Type,
  TypeReferenceNode_TypeName,
  TypeOperatorNode_Type,
} from "../../common/source-ast.js";
import type { RustSourcePolicyContext } from "../../policy/context.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type { TargetTypeRef } from "../../policy/types.js";
import type {
  RustProviderOperationRow,
  RustProviderTypeRow,
} from "../provider-packages/index.js";
import {
  rustFutureTargetType,
  rustBigIntTargetType,
  rustCallableTargetType,
  rustGeneratorTargetType,
  rustAsyncGeneratorTargetType,
  rustIteratorResultTargetType,
  rustJsArrayTargetType,
  rustJsDateTargetType,
  rustJsMapTargetType,
  rustJsSetTargetType,
  rustJsErrorTargetType,
  rustLocationTargetType,
  rustNullishSourceTargetType,
  rustOptionTargetType,
  rustSliceMutRefTargetType,
  rustSliceRefTargetType,
  rustSourceTypeCarrier,
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
  rustSourcePrimitiveTargetType,
  rustStructuralObjectCarrierValue,
  rustStructuralObjectTargetType,
  rustStringTargetType,
  rustTupleTargetType,
  rustUnitTargetType,
  rustVecTargetType,
  substituteRustTargetTypeParameters,
} from "../rust-target-types.js";
import { rustProviderOperationOwnerMatches } from "./provider-operation-selection.js";
import {
  asNode,
  mergeProviderDeclarationIdentities,
} from "./selected-evidence.js";
import type { RustSourceProfileRegistry } from "./source-profile-registry.js";
import {
  isRustStructuralObjectFieldDeclaration,
  type RustSourceTypeRegistry,
} from "./source-type-registry.js";
import { isDenseDataArray } from "../../common/closed-metadata.js";

export interface RustTargetTypeResolutionOptions {
  readonly jsEnabled: boolean;
  readonly providerRows: readonly RustProviderOperationRow[];
  readonly providerTypes: readonly RustProviderTypeRow[];
  readonly providerCarrierPaths: ReadonlyMap<string, string>;
  readonly sourceProfiles: RustSourceProfileRegistry;
  readonly sourceTypes: RustSourceTypeRegistry;
  readonly resolveProjectUnionCarrier: (
    memberCarriers: readonly TargetTypeRef[],
  ) => TargetTypeRef | undefined;
}

export interface RustTargetTypeResolutionContext extends RustSourcePolicyContext {
  readonly currentSourceFile: SourceFile;
  readonly checker: SourceFileSemantics;
  readonly typeShape: SourceFileSemantics;
}

export function resolveRustTargetTypeRef(
  subject: ExtensionFactSubject | undefined,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  if (subject === undefined) {
    return undefined;
  }
  const functionPointer = context.facts.resolve(subject, functionPointerFactKey) ??
    context.facts.get(subject, functionPointerFactKey);
  if (functionPointer !== undefined) {
    const parameters = functionPointer.parameters.map((parameter) =>
      resolveRustTargetTypeRef(parameter, context, options));
    const result = resolveRustTargetTypeRef(functionPointer.result, context, options);
    return result === undefined || parameters.some((parameter) => parameter === undefined)
      ? undefined
      : {
          kind: "function-pointer",
          args: parameters as TargetTypeRef[],
          result,
          ...(functionPointer.abi.length === 0 ? {} : { abi: functionPointer.abi }),
        };
  }
  const pointer = context.facts.resolve(subject, pointerFactKey) ??
    context.facts.get(subject, pointerFactKey);
  if (pointer !== undefined) {
    const pointee = resolveRustTargetTypeRef(pointer.pointee, context, options);
    return pointee === undefined ? undefined : rustLocationTargetType(pointee);
  }
  const node = asNode(subject, context);
  const existing = context.facts.getRuntimeCarrierFact(node)?.carrier;
  if (existing !== undefined) {
    return existing;
  }
  const operationResult = context.facts.getSelectedTargetOperator(subject)?.resultType;
  if (operationResult !== undefined) {
    return operationResult;
  }
  const selectedCallResult = context.facts.getSelectedTargetCall(subject)?.member.returnType;
  if (selectedCallResult !== undefined) {
    return selectedCallResult;
  }
  const primitive = resolveSourcePrimitive(subject, context);
  if (primitive !== undefined) {
    return primitive;
  }
  if (node !== undefined && context.ast.kindName(node) === "KindParameter") {
    const parameterType = Node_Type(context.ast, node);
    if (parameterType === undefined) {
      return undefined;
    }
    const carrier = resolveRustTargetTypeSyntax(parameterType, context, options, new Set<object>());
    return rustParameterLaneTargetType(carrier, parameterType, context, options);
  }
  const syntax = node === undefined
    ? undefined
    : resolveRustTargetTypeSyntax(node, context, options, new Set<object>());
  if (syntax !== undefined) {
    return syntax;
  }
  const referenced = node === undefined
    ? undefined
    : resolveReferencedDeclarationType(node, context, options);
  if (referenced !== undefined) {
    return referenced;
  }
  const type = node === undefined
    ? subject as Type
    : context.semanticsFor(node).getTypeAtLocation(node);
  return resolveRustTargetType(type, context, options, new Set<object>());
}

function resolveRustTargetTypeSyntax(
  node: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const functionPointer = context.facts.resolve(node, functionPointerFactKey) ??
    context.facts.get(node, functionPointerFactKey);
  if (functionPointer !== undefined) {
    const parameters = functionPointer.parameters.map((parameter) =>
      resolveRustTargetTypeSyntax(parameter, context, options, resolving));
    const result = resolveRustTargetTypeSyntax(functionPointer.result, context, options, resolving);
    return result === undefined || parameters.some((parameter) => parameter === undefined)
      ? undefined
      : {
          kind: "function-pointer",
          args: parameters as TargetTypeRef[],
          result,
          ...(functionPointer.abi.length === 0 ? {} : { abi: functionPointer.abi }),
        };
  }
  const pointer = context.facts.resolve(node, pointerFactKey) ??
    context.facts.get(node, pointerFactKey);
  if (pointer !== undefined) {
    const pointee = resolveRustTargetTypeRef(pointer.pointee, context, options);
    return pointee === undefined ? undefined : rustLocationTargetType(pointee);
  }
  const primitive = resolveSourcePrimitive(node, context);
  if (primitive !== undefined) {
    return primitive;
  }
  const { ast, checker } = context;
  const kind = ast.kindName(node);
  if (kind === "KindNullKeyword" || kind === "KindUndefinedKeyword") {
    return rustNullishSourceTargetType();
  }
  if (kind === "KindStringKeyword") {
    return rustStringTargetType();
  }
  if (kind === "KindBooleanKeyword") {
    return rustSourcePrimitiveTargetType("bool");
  }
  if (kind === "KindNumberKeyword") {
    return rustSourcePrimitiveTargetType("float64");
  }
  if (kind === "KindBigIntKeyword") {
    return rustBigIntTargetType();
  }
  if (kind === "KindVoidKeyword") {
    return rustUnitTargetType();
  }
  if (kind === "KindFunctionType") {
    return resolveRustTargetType(
      context.semanticsFor(node).getTypeAtLocation(node),
      context,
      options,
      resolving,
    );
  }
  if (kind === "KindParenthesizedType") {
    const inner = ast.as.AsParenthesizedTypeNode(node)?.Type;
    return inner === undefined
      ? undefined
      : resolveRustTargetTypeSyntax(inner, context, options, resolving);
  }
  if (kind === "KindArrayType") {
    const elementNode = ArrayTypeNode_ElementType(ast, node);
    const element = elementNode === undefined
      ? undefined
      : resolveRustTargetTypeSyntax(elementNode, context, options, resolving);
    return element === undefined
      ? undefined
      : options.jsEnabled
        ? rustJsArrayTargetType(element)
        : rustVecTargetType(element);
  }
  if (kind === "KindTypeOperator") {
    const inner = TypeOperatorNode_Type(ast, node);
    return inner === undefined
      ? undefined
      : resolveRustTargetTypeSyntax(inner, context, options, resolving);
  }
  if (kind === "KindTupleType") {
    const elementNodes = denseDefined(ast.elements(node));
    if (elementNodes === undefined) {
      return undefined;
    }
    const elements = elementNodes.map((element) => resolveRustTargetTypeSyntax(element, context, options, resolving));
    return elements.length > 0 && elements.every((element) => element !== undefined)
      ? rustTupleTargetType(elements as TargetTypeRef[])
      : undefined;
  }
  if (kind === "KindUnionType") {
    const children = denseDefined(ast.children(node));
    if (children === undefined) {
      return undefined;
    }
    const members: Node[] = [];
    for (const child of children) {
      if (ast.kindName(child) === "KindSyntaxList") {
        const entries = denseDefined(ast.children(child));
        if (entries === undefined) {
          return undefined;
        }
        members.push(...entries);
      } else {
        members.push(child);
      }
    }
    const semanticMembers = members.filter((child) => ast.kindName(child) !== "KindBarToken");
    if (semanticMembers.length === 2) {
      const nullish = semanticMembers.find((member) => {
        const memberKind = ast.kindName(member);
        if (memberKind === "KindUndefinedKeyword") {
          return true;
        }
        if (memberKind !== "KindLiteralType") {
          return false;
        }
        return ast.children(member).some((child) =>
          child !== undefined && ast.kindName(child) === "KindNullKeyword");
      });
      const value = semanticMembers.find((member) => member !== nullish);
      const valueCarrier = nullish === undefined || value === undefined
        ? undefined
        : resolveRustTargetTypeSyntax(value, context, options, resolving);
      if (valueCarrier !== undefined) {
        return rustOptionTargetType(valueCarrier);
      }
    }
    return resolveRustTargetType(
      context.semanticsFor(node).getTypeAtLocation(node),
      context,
      options,
      resolving,
    );
  }
  if (kind !== "KindTypeReference") {
    return undefined;
  }
  const typeArgumentNodes = denseDefined(ast.typeArguments(node));
  if (typeArgumentNodes === undefined) {
    return undefined;
  }
  const typeArguments = typeArgumentNodes.map((argument) =>
    resolveRustTargetTypeSyntax(argument, context, options, resolving));
  if (typeArguments.some((argument) => argument === undefined)) {
    return undefined;
  }
  const typeName = TypeReferenceNode_TypeName(ast, node);
  const symbol = typeName === undefined
    ? undefined
    : checker.getSymbolAtLocation(typeName);
  const provider = resolveProviderTypeIdentity(
    checker.getAuthoredTypeFactSubjects(node),
    context,
  );
  if (provider !== undefined) {
    const relation = providerCarrierFromRelations(provider, options);
    return relation === undefined
      ? undefined
      : instantiateProviderTargetType(relation, typeArguments as TargetTypeRef[]);
  }
  const sourceProfileName = resolveOwnedSourceProfileTypeName(symbol, context, options.sourceProfiles);
  if (sourceProfileName !== undefined) {
    return resolveSourceProfileCarrierFromArguments(sourceProfileName, typeArguments as TargetTypeRef[], options);
  }
  const sourceType = resolveProjectSourceCarrier(
    symbol,
    typeArguments as readonly TargetTypeRef[],
    context,
    options,
    typeName === undefined
      ? undefined
      : context.source.navigation.sourceReferenceFor(typeName)?.declaration,
  );
  if (sourceType !== undefined) {
    return sourceType;
  }
  const typeParameter = resolveSourceTypeParameter(symbol, context);
  if (typeParameter !== undefined) {
    return typeParameter;
  }
  return undefined;
}

function resolveReferencedDeclarationType(
  node: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  const { ast, checker } = context;
  const symbols = [checker.getSymbolAtLocation(node)];
  for (const symbol of symbols) {
    if (symbol === undefined) {
      continue;
    }
    const declarations = denseDefined(checker.getSymbolDeclarations(symbol));
    if (declarations === undefined) {
      return undefined;
    }
    for (const declaration of declarations) {
      const declarationCarrier = context.facts.getRuntimeCarrierFact(declaration)?.carrier;
      if (declarationCarrier !== undefined) {
        return declarationCarrier;
      }
      const typeNode = Node_Type(ast, declaration);
      if (typeNode !== undefined) {
        const target = resolveRustTargetTypeSyntax(typeNode, context, options, new Set<object>());
        if (target !== undefined) {
          return ast.kindName(declaration) === "KindParameter"
            ? rustParameterLaneTargetType(target, typeNode, context, options)
            : target;
        }
      }
      const initializer = Node_Initializer(ast, declaration);
      const selectedResult = initializer === undefined
        ? undefined
        : context.facts.getSelectedTargetCall(initializer)?.member.returnType;
      if (selectedResult !== undefined) {
        return selectedResult;
      }
    }
  }
  return undefined;
}

export function rustParameterLaneTargetType(
  carrier: TargetTypeRef | undefined,
  typeNode: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  if (carrier?.kind !== "array") {
    return carrier;
  }
  return sourceParameterTypeIsReadonlyArray(typeNode, context, options)
    ? rustSliceRefTargetType(carrier.element)
    : rustSliceMutRefTargetType(carrier.element);
}

function sourceParameterTypeIsReadonlyArray(
  typeNode: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): boolean {
  const { ast, checker } = context;
  if (ast.kindName(typeNode) === "KindTypeOperator") {
    const inner = TypeOperatorNode_Type(ast, typeNode);
    return inner !== undefined && ast.kindName(inner) === "KindArrayType";
  }
  if (ast.kindName(typeNode) !== "KindTypeReference") {
    return false;
  }
  const typeName = TypeReferenceNode_TypeName(ast, typeNode);
  const symbol = typeName === undefined
    ? undefined
    : checker.getSymbolAtLocation(typeName);
  return resolveOwnedSourceProfileTypeName(symbol, context, options.sourceProfiles) === "ReadonlyArray";
}

function resolveRustTargetType(
  type: Type | undefined,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  if (type === undefined || resolving.has(type)) {
    return undefined;
  }
  const existingStructuralObject = options.sourceTypes.structuralObjectForType(type);
  if (existingStructuralObject !== undefined) {
    return existingStructuralObject.carrier;
  }
  const primitive = resolveSourcePrimitive(type, context);
  if (primitive !== undefined) {
    return primitive;
  }
  resolving.add(type);
  try {
    const { checker, typeShape } = context;
    if (typeShape.isAny(type) || typeShape.isUnknown(type) || typeShape.isNever(type)) {
      return undefined;
    }
    const symbol = checker.getTypeAliasSymbol(type) ?? checker.getTypeSymbol(type);
    const providerIdentity = resolveProviderTypeIdentity(
      typeShape.getTypeFactSubjects(type),
      context,
    );
    if (providerIdentity !== undefined) {
      const base = providerCarrierFromRelations(providerIdentity, options);
      if (base !== undefined) {
        return instantiateTargetType(base, type, context, options, resolving);
      }
    }

    const sourceProfileType = resolveOwnedSourceProfileTypeName(symbol, context, options.sourceProfiles);
    if (sourceProfileType !== undefined) {
      const sourceProfileCarrier = resolveSourceProfileCarrier(sourceProfileType, type, context, options, resolving);
      if (sourceProfileCarrier !== undefined) {
        return sourceProfileCarrier;
      }
    }

    const sourceTypeArguments = context.typeShape.getEffectiveTypeArguments(type);
    const resolvedSourceTypeArguments = sourceTypeArguments?.map((argument) =>
      resolveRustTargetType(argument, context, options, resolving));
    const sourceType = resolvedSourceTypeArguments === undefined ||
        resolvedSourceTypeArguments.some((argument) => argument === undefined)
      ? undefined
      : resolveProjectSourceCarrier(
          symbol,
          resolvedSourceTypeArguments as readonly TargetTypeRef[],
          context,
          options,
        );
    if (sourceType !== undefined) {
      return sourceType;
    }

    const typeParameter = resolveSourceTypeParameter(symbol, context);
    if (typeParameter !== undefined) {
      return typeParameter;
    }

    const callable = resolveCallableType(type, context, options, resolving);
    if (callable !== undefined) {
      return callable;
    }

    if (typeShape.isNullish(type)) {
      return rustNullishSourceTargetType();
    }
    if (typeShape.isStringLike(type)) {
      return rustStringTargetType();
    }
    if (typeShape.isBooleanLike(type)) {
      return rustSourcePrimitiveTargetType("bool");
    }
    if (typeShape.isNumberLike(type)) {
      return rustSourcePrimitiveTargetType("float64");
    }
    if (typeShape.isBigIntLike(type)) {
      return rustBigIntTargetType();
    }
    if (typeShape.isVoidLike(type)) {
      return rustUnitTargetType();
    }
    if (typeShape.isUnion(type)) {
      return resolveUnion(type, context, options, resolving);
    }
    if (typeShape.isTuple(type)) {
      const elements = typeShape.getTupleElementTypes(type)
        .map((element) => resolveRustTargetType(element, context, options, resolving));
      return elements.length > 0 && elements.every((element) => element !== undefined)
        ? rustTupleTargetType(elements as TargetTypeRef[])
        : undefined;
    }

    if (typeShape.isArrayLike(type) && typeShape.isTypeReference(type)) {
      const [elementType] = typeShape.getTypeArguments(type);
      const element = resolveRustTargetType(elementType, context, options, resolving);
      return element === undefined
        ? undefined
        : options.jsEnabled
          ? rustJsArrayTargetType(element)
          : rustVecTargetType(element);
    }
    return resolveStructuralObjectType(type, context, options, resolving);
  } finally {
    resolving.delete(type);
  }
}

function resolveStructuralObjectType(
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const { checker, typeShape } = context;
  if (typeShape.getCallSignatures(type).length !== 0 ||
    typeShape.getConstructSignatures(type).length !== 0 ||
    typeShape.getIndexInfos(type).length !== 0) {
    return undefined;
  }
  const properties = denseDefined(typeShape.getPropertyInfos(type));
  if (properties === undefined || properties.length === 0) {
    return undefined;
  }
  const selected = properties.map((property) => {
    const declarations = denseDefined(checker.getSymbolDeclarations(property.symbol));
    const projectDeclarations = declarations?.filter((declaration) =>
      context.source.navigation.isProjectDeclaration(declaration) &&
      isRustStructuralObjectFieldDeclaration(declaration, context.ast));
    const authoredTypeNodes = projectDeclarations?.map((declaration) =>
      Node_Type(context.ast, declaration)).filter((node) => node !== undefined) ?? [];
    const authoredCarriers = authoredTypeNodes.length === projectDeclarations?.length
      ? authoredTypeNodes.map((node) =>
          resolveRustTargetTypeSyntax(node, context, options, resolving))
      : [];
    const authoredCarrier = authoredCarriers.length > 0 &&
        authoredCarriers.every((carrier) =>
          carrier !== undefined && rustTargetTypeRefEquals(carrier, authoredCarriers[0]))
      ? authoredCarriers[0]
      : undefined;
    const fieldCarrier = authoredTypeNodes.length === 0 ||
        authoredCarriers.every((carrier) => carrier === undefined)
      ? resolveRustTargetType(property.type, context, options, resolving)
      : authoredCarrier;
    return projectDeclarations === undefined || projectDeclarations.length === 0 ||
        projectDeclarations.length !== declarations?.length || fieldCarrier === undefined
      ? undefined
      : {
          declarations: Object.freeze(projectDeclarations),
          symbols: Object.freeze([property.symbol]),
          sourceName: property.name,
          sourceType: property.type,
          resultCarrier: fieldCarrier,
        };
  });
  if (selected.some((field) => field === undefined)) {
    return undefined;
  }
  const fields = [...(selected as readonly {
    readonly declarations: readonly Node[];
    readonly symbols: readonly Symbol[];
    readonly sourceName: string;
    readonly sourceType: Type;
    readonly resultCarrier: TargetTypeRef;
  }[])]
    .sort((left, right) => left.sourceName.localeCompare(right.sourceName))
    .map((field, storageIndex) => ({ ...field, storageIndex }));
  if (new Set(fields.map((field) => field.sourceName)).size !== fields.length) {
    return undefined;
  }
  const carrier = rustStructuralObjectTargetType(fields.map((field) => ({
    sourceName: field.sourceName,
    type: field.resultCarrier,
  })));
  return options.sourceTypes.registerStructuralObject({
    sourceType: type,
    carrier,
    storage: "object-handle",
    fields,
  })
    ? carrier
    : undefined;
}

function resolveCallableType(
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const signatures = denseDefined(context.checker.getCallSignaturesOfType(type));
  if (signatures === undefined || signatures.length !== 1) {
    return undefined;
  }
  const signature = signatures[0]!;
  const declaration = context.checker.getSignatureDeclaration(signature);
  if (declaration !== undefined && context.ast.typeParameters(declaration).length > 0) {
    return undefined;
  }
  const parameters = denseDefined(context.checker.getSignatureParameters(signature));
  if (parameters === undefined) {
    return undefined;
  }
  const parameterCarriers = parameters.map((parameter) => {
    const declarations = denseDefined(context.checker.getSymbolDeclarations(parameter));
    if (declarations === undefined) {
      return undefined;
    }
    const parameterDeclaration = declarations.find((candidate) =>
      context.ast.is.IsParameterDeclaration(candidate));
    const authoredType = Node_Type(context.ast, parameterDeclaration);
    const selected = authoredType === undefined
      ? resolveRustTargetType(
          context.checker.getTypeOfSymbol(parameter),
          context,
          options,
          resolving,
        )
      : resolveRustTargetTypeSyntax(authoredType, context, options, resolving);
    if (selected === undefined || parameterDeclaration === undefined ||
      context.ast.as.AsParameterDeclaration(parameterDeclaration)?.DotDotDotToken !== undefined) {
      return selected;
    }
    return context.ast.questionToken(parameterDeclaration) !== undefined ||
        Node_Initializer(context.ast, parameterDeclaration) !== undefined
      ? rustOptionTargetType(selected)
      : selected;
  });
  if (parameterCarriers.some((parameter) => parameter === undefined)) {
    return undefined;
  }
  const returnType = context.checker.getReturnTypeOfSignature(signature);
  const authoredReturn = Node_Type(context.ast, declaration);
  const result = authoredReturn === undefined
    ? resolveRustTargetType(returnType, context, options, resolving)
    : resolveRustTargetTypeSyntax(authoredReturn, context, options, resolving);
  return result === undefined
    ? undefined
    : rustCallableTargetType(parameterCarriers as TargetTypeRef[], result);
}

function resolveSourceTypeParameter(
  symbol: Symbol | undefined,
  context: RustTargetTypeResolutionContext,
): TargetTypeRef | undefined {
  if (symbol === undefined) {
    return undefined;
  }
  const declaration = context.checker.getPrimarySymbolDeclaration(symbol);
  if (declaration === undefined || context.ast.kindName(declaration) !== "KindTypeParameter") {
    return undefined;
  }
  const name = context.ast.text(context.ast.name(declaration));
  return name.length === 0 ? undefined : { kind: "type-parameter", name };
}

function resolveSourcePrimitive(
  subject: ExtensionFactSubject,
  context: RustTargetTypeResolutionContext,
): TargetTypeRef | undefined {
  const node = asNode(subject, context);
  if (node !== undefined) {
    const direct = context.facts.get(node, sourcePrimitiveFactKey);
    return direct === undefined ? undefined : rustSourcePrimitiveTargetType(direct.kind);
  }
  const type = subject as Type;
  const symbol = context.checker.getTypeAliasSymbol(type) ?? context.checker.getTypeSymbol(type);
  if (symbol === undefined) {
    return undefined;
  }
  const symbolFact = context.facts.get(symbol, sourcePrimitiveFactKey);
  if (symbolFact !== undefined) {
    return rustSourcePrimitiveTargetType(symbolFact.kind);
  }
  const declarations = denseDefined(context.checker.getSymbolDeclarations(symbol));
  if (declarations === undefined) {
    return undefined;
  }
  for (const declaration of declarations) {
    const declarationFact = context.facts.get(declaration, sourcePrimitiveFactKey);
    if (declarationFact !== undefined) {
      return rustSourcePrimitiveTargetType(declarationFact.kind);
    }
  }
  return undefined;
}

function resolveUnion(
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const members = denseDefined(context.typeShape.getUnionOrIntersectionTypes(type));
  if (members === undefined) {
    return undefined;
  }
  const valueMembers = members.filter((member) => !context.typeShape.isNullish(member));
  const nullishMembers = members.filter((member) => context.typeShape.isNullish(member));
  if (valueMembers.length === 1 && nullishMembers.length > 0) {
    const value = resolveRustTargetType(valueMembers[0], context, options, resolving);
    return value === undefined ? undefined : rustOptionTargetType(value);
  }
  if (members.length > 0 && members.every((member) => context.typeShape.isStringLike(member))) {
    return rustStringTargetType();
  }
  if (members.length > 0 && members.every((member) => context.typeShape.isNumberLike(member))) {
    return rustSourcePrimitiveTargetType("float64");
  }
  if (members.length > 0 && members.every((member) => context.typeShape.isBooleanLike(member))) {
    return rustSourcePrimitiveTargetType("bool");
  }
  const memberCarriers = members.map((member) =>
    resolveRustTargetType(member, context, options, resolving));
  if (memberCarriers.length > 1 && memberCarriers.every((carrier) => carrier !== undefined)) {
    return options.resolveProjectUnionCarrier(
      memberCarriers as readonly TargetTypeRef[],
    );
  }
  return undefined;
}

function resolveProviderTypeIdentity(
  subjects: readonly ExtensionFactSubject[],
  context: RustTargetTypeResolutionContext,
): ProviderDeclarationIdentity | undefined {
  let selected: ProviderDeclarationIdentity | undefined;
  for (const subject of subjects) {
    const fact = context.facts.get(subject, providerVirtualDeclarationFactKey);
    if (fact === undefined) {
      continue;
    }
    if (selected === undefined) {
      selected = fact;
      continue;
    }
    const merged = mergeProviderDeclarationIdentities(selected, fact);
    if (merged === undefined) {
      return undefined;
    }
    selected = merged;
  }
  return selected;
}

function providerCarrierFromRelations(
  identity: ProviderDeclarationIdentity,
  options: RustTargetTypeResolutionOptions,
): RustProviderTypeRow | undefined {
  if (identity.exportId === undefined) {
    return undefined;
  }
  const relations = options.providerTypes.filter((row) =>
    rustProviderOperationOwnerMatches(row, identity) &&
    row.exportId === identity.exportId);
  if (relations.length !== 1) {
    return undefined;
  }
  return relations[0];
}

function instantiateTargetType(
  base: RustProviderTypeRow,
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const rawArguments = context.typeShape.isTypeReference(type)
    ? context.typeShape.getTypeArguments(type)
    : [];
  const arguments_ = denseDefined(rawArguments);
  if (arguments_ === undefined) {
    return undefined;
  }
  const targetArguments = arguments_
    .map((argument) => resolveRustTargetType(argument, context, options, resolving));
  if (targetArguments.some((argument) => argument === undefined)) {
    return undefined;
  }
  return instantiateProviderTargetType(base, targetArguments as TargetTypeRef[]);
}

function instantiateProviderTargetType(
  relation: RustProviderTypeRow,
  arguments_: readonly TargetTypeRef[],
): TargetTypeRef | undefined {
  if (relation.sourceTypeParameters.length !== arguments_.length) {
    return undefined;
  }
  const substitutions = new Map(
    relation.sourceTypeParameters.map((name, index) => [name, arguments_[index]!] as const),
  );
  return substituteRustTargetTypeParameters(relation.targetCarrier, substitutions);
}

function resolveOwnedSourceProfileTypeName(
  symbol: Symbol | undefined,
  context: RustTargetTypeResolutionContext,
  sourceProfiles: RustSourceProfileRegistry,
): string | undefined {
  if (symbol === undefined) {
    return undefined;
  }
  const declarations = denseDefined(context.checker.getSymbolDeclarations(symbol));
  if (declarations === undefined) {
    return undefined;
  }
  for (const declaration of declarations) {
    if (sourceProfiles.profileForNode(declaration, context.ast) === undefined) {
      continue;
    }
    if (!context.ast.is.IsClassDeclaration(declaration) &&
      !context.ast.is.IsInterfaceDeclaration(declaration) &&
      !context.ast.is.IsTypeAliasDeclaration(declaration) &&
      !context.ast.is.IsEnumDeclaration(declaration)) {
      continue;
    }
    const nameNode = context.ast.name(declaration);
    if (!context.ast.is.IsIdentifier(nameNode)) {
      continue;
    }
    const name = context.ast.text(nameNode);
    if (name.length > 0) {
      return name;
    }
  }
  return undefined;
}

function resolveSourceProfileCarrier(
  name: string,
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  if (name === "String") {
    return rustStringTargetType();
  }
  if (options.jsEnabled && name === "Date") {
    return rustJsDateTargetType();
  }
  if (options.jsEnabled && name === "RegExp") {
    return { kind: "target-named", id: "rust.js.JsRegExp" };
  }
  if (options.jsEnabled && (name === "RegExpExecArray" || name === "RegExpMatchArray")) {
    return { kind: "target-named", id: "rust.js.JsRegExpMatch" };
  }
  if (!context.typeShape.isTypeReference(type)) {
    return undefined;
  }
  const arguments_ = context.typeShape.getTypeArguments(type);
  const targetArguments = arguments_.map((argument) => resolveRustTargetType(argument, context, options, resolving));
  const direct = targetArguments.every((argument) => argument !== undefined)
    ? resolveSourceProfileCarrierFromArguments(name, targetArguments as TargetTypeRef[], options)
    : undefined;
  if (direct !== undefined && name !== "Array" && name !== "ReadonlyArray") {
    return direct;
  }
  if (name === "Promise" || name === "PromiseLike") {
    const output = resolveRustTargetType(arguments_[0], context, options, resolving);
    return output === undefined ? undefined : rustFutureTargetType(output);
  }
  if (name === "Generator" || name === "AsyncGenerator") {
    const [yieldType, returnType, nextType] = targetArguments;
    if (yieldType === undefined || returnType === undefined || nextType === undefined) {
      return undefined;
    }
    const protocol = { yieldType, returnType, nextType };
    return name === "Generator"
      ? rustGeneratorTargetType(protocol)
      : rustAsyncGeneratorTargetType(protocol);
  }
  if (name === "IteratorResult" || name === "IteratorYieldResult" || name === "IteratorReturnResult") {
    const yieldType = targetArguments[0];
    const returnType = name === "IteratorYieldResult" ? yieldType : targetArguments[1] ?? yieldType;
    return yieldType === undefined || returnType === undefined
      ? undefined
      : rustIteratorResultTargetType({ yieldType, returnType });
  }
  if (name === "Array" || name === "ReadonlyArray") {
    const elementType = arguments_[0];
    const element = resolveRustTargetType(elementType, context, options, resolving);
    return element === undefined
      ? undefined
      : options.jsEnabled
        ? rustJsArrayTargetType(element)
        : rustVecTargetType(element);
  }
  if (options.jsEnabled && (name === "Map" || name === "ReadonlyMap")) {
    const key = resolveRustTargetType(arguments_[0], context, options, resolving);
    const value = resolveRustTargetType(arguments_[1], context, options, resolving);
    return key === undefined || value === undefined ? undefined : rustJsMapTargetType(key, value);
  }
  if (options.jsEnabled && (name === "Set" || name === "ReadonlySet")) {
    const value = resolveRustTargetType(arguments_[0], context, options, resolving);
    return value === undefined ? undefined : rustJsSetTargetType(value);
  }
  return undefined;
}

function resolveSourceProfileCarrierFromArguments(
  name: string,
  arguments_: readonly TargetTypeRef[],
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  if (name === "String") {
    return rustStringTargetType();
  }
  if (name === "Error" && arguments_.length === 0) {
    return rustJsErrorTargetType();
  }
  if (name === "Promise" || name === "PromiseLike") {
    const [output] = arguments_;
    return output === undefined ? undefined : rustFutureTargetType(output);
  }
  if (name === "Generator" || name === "AsyncGenerator") {
    const [yieldType, returnType, nextType] = arguments_;
    if (yieldType === undefined || returnType === undefined || nextType === undefined) {
      return undefined;
    }
    const protocol = { yieldType, returnType, nextType };
    return name === "Generator"
      ? rustGeneratorTargetType(protocol)
      : rustAsyncGeneratorTargetType(protocol);
  }
  if (name === "IteratorResult" || name === "IteratorYieldResult" || name === "IteratorReturnResult") {
    const yieldType = arguments_[0];
    const returnType = name === "IteratorYieldResult" ? yieldType : arguments_[1] ?? yieldType;
    return yieldType === undefined || returnType === undefined
      ? undefined
      : rustIteratorResultTargetType({ yieldType, returnType });
  }
  if (name === "Array" || name === "ReadonlyArray") {
    const [element] = arguments_;
    if (element === undefined) {
      return undefined;
    }
    return options.jsEnabled ? rustJsArrayTargetType(element) : rustVecTargetType(element);
  }
  if (options.jsEnabled && (name === "Map" || name === "ReadonlyMap")) {
    const [key, value] = arguments_;
    return key === undefined || value === undefined ? undefined : rustJsMapTargetType(key, value);
  }
  if (options.jsEnabled && (name === "Set" || name === "ReadonlySet")) {
    const [value] = arguments_;
    return value === undefined ? undefined : rustJsSetTargetType(value);
  }
  if (options.jsEnabled && name === "Date") {
    return rustJsDateTargetType();
  }
  if (options.jsEnabled && name === "RegExp") {
    return { kind: "target-named", id: "rust.js.JsRegExp" };
  }
  if (options.jsEnabled && (name === "RegExpExecArray" || name === "RegExpMatchArray")) {
    return { kind: "target-named", id: "rust.js.JsRegExpMatch" };
  }
  return undefined;
}

function resolveProjectSourceCarrier(
  symbol: Symbol | undefined,
  typeArguments: readonly TargetTypeRef[],
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  selectedDeclaration?: Node,
): TargetTypeRef | undefined {
  const symbolDeclarations = symbol === undefined
    ? []
    : denseDefined(context.checker.getSymbolDeclarations(symbol));
  if (symbolDeclarations === undefined) {
    return undefined;
  }
  const declarations = selectedDeclaration === undefined
    ? symbolDeclarations
    : [
        selectedDeclaration,
        ...symbolDeclarations.filter((declaration) => declaration !== selectedDeclaration),
      ];
  for (const declaration of declarations) {
    const carrier = options.sourceTypes.carrierForDeclaration(declaration, context.ast);
    const sourceType = rustSourceTypeCarrierValue(carrier);
    if (sourceType !== undefined) {
      return rustSourceTypeCarrier(
        sourceType.fileName,
        sourceType.typeName,
        sourceType.shape,
        typeArguments,
      );
    }
    if (carrier !== undefined && typeArguments.length === 0 &&
      (rustSourceUnionCarrierValue(carrier) !== undefined ||
        rustStructuralObjectCarrierValue(carrier) !== undefined)) {
      return carrier;
    }
  }
  return undefined;
}

function denseDefined<T>(values: readonly (T | undefined)[]): readonly T[] | undefined {
  return isDenseDataArray(values) && values.every((value) => value !== undefined)
    ? values as readonly T[]
    : undefined;
}

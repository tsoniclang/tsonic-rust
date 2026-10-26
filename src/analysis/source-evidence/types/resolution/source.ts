import { resolveRustSourceUnionCarrier, resolveRustUnionValueCarrier } from "./source-unions.js";
import { ArrayTypeNode_ElementType, Node_Type, TypeReferenceNode_TypeName, TypeOperatorNode_Type, sourceIntegerInduction } from "@tsonic/target-api/source";
import { rustBigIntTargetType, rustEmptyObjectTargetType, rustJsArrayTargetType, rustJsStringTargetType, rustSourceLocationTargetType, rustRawPointerTargetType, rustAbsenceTargetType, isRustAbsenceCarrier, isRustUnitCarrier, rustNeverTargetType, rustOptionTargetType, rustSourceOptionalTargetType, rustSourcePrimitiveTargetType, rustStringTargetType, rustUnitTargetType, rustVecTargetType } from "../../../../target-model/types/index.js";
import { rustTupleTargetType } from "../../../../policy/types/collections/tuple-carrier.js";
import { asNode } from "../../../../policy/identities/selected-source.js";
import { denseDefined, resolveProjectSourceCarrier } from "./project.js";
import { fieldFactKey, functionPointerFactKey, pointerFactKey, structFactKey } from "@tsonic/tsts";
import { resolveRustSourceMarker } from "./markers.js";
import { resolveSourceProfileCarrierFromArguments } from "../../../../policy/operations/source-profiles/type-carriers.js";
import { instantiateProviderTargetType, providerCarrierFromRelations } from "../../../../policy/types/project/provider-instantiation.js";
import { resolveOwnedSourceProfileTypeName, resolveOwnedSourceProfileTypeNameForDeclaration } from "../../../../policy/identities/source-types.js";
import { resolveProviderTypeIdentity } from "../../../../policy/identities/provider-types.js";
import { resolveSourcePrimitive, resolveSourceTypeParameter } from "./callables.js";
import { resolveReferencedDeclarationType, resolveRustAuthoredTargetType, rustParameterLaneTargetType } from "./tuples.js";
import { resolveRustTypeComponentEvidence } from "./source-evidence.js";
import { resolveRustFixedArrayTargetType, resolveRustTargetType, resolveStructuralObjectType } from "./target.js";

import { tsonicFixedArrayFactKey } from "@tsonic/source-core/facts";
import { isRustSourceRawPointer } from "../../../../source/extension/raw-pointers.js";
import type { ExtensionFactSubject, Node, Type } from "@tsonic/tsts";

import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { resolveRustLifetimeSourceType, rustSourceLifetimeTypeContract } from "./lifetimes.js";

import { resolveRustMemoryLayoutPointee } from "../../../operations/pointers/native-memory.js";
import { readRustRawLocation } from "../../../../source/extension/native-memory.js";

import { resolveRustAuthoredBroadSourceValueTargetType } from "./broad-values.js";
import { resolveRustInferredUnion } from "./inferred-unions.js";
import { resolveRustConditionalAlias } from "./type-families.js";
import { tsonicMemoryFieldBindingFactKey, selectTsonicMemoryFieldBinding } from "@tsonic/source-core/facts";
import { selectRustConditionalNumericCarrier } from "../../../../policy/types/conditional-numeric-carrier.js";
import { resolveRustProviderIndexedAccess } from "./indexed-access.js";
import { resolveRustSourceDeclarationArguments } from "./generic-arguments.js";

import { rustSourceStorageComponentContext, rustSourceStorageContext, rustSourceStorageSubjectContext } from "./source-storage-projection.js";
import { resolveRustSelectedSourceCallResult } from "./call-results.js";
import { resolveRustContextualLiteralCarrier } from "../../../../policy/types/collections/literal-construction.js";

import { resolveStandardSourceTypeTransformation, resolveRustCheckerTransformedType } from "./source-transformations.js";
import { resolveRustProviderGenericArguments } from "./provider-arguments.js";
import { rustSourceProfileErrorCarrierNeeded } from "../../../../policy/operations/source-profiles/type-carriers.js";
export function resolveRustTargetTypeRef(
  subject: ExtensionFactSubject | undefined,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  if (subject === undefined) {
    return undefined;
  }
  const subjectNode = asNode(subject, context);
  context = rustSourceStorageContext(context, subjectNode);
  const subjectFile = subjectNode === undefined ? undefined : context.ast.getSourceFile(subjectNode);
  if (subjectFile !== undefined && context.source.semantics.includes(subjectFile) &&
    subjectFile !== context.currentSemantics.sourceFile) {
    context = { ...context, currentSemantics: context.semantics(subjectFile) };
  }
  const binding = context.source.sourceFacts.getFact(subject, tsonicMemoryFieldBindingFactKey);
  if (binding !== undefined) {
    if (selectTsonicMemoryFieldBinding(context.ast, context.source.sourceFacts, binding.call)?.kind !== "resolved") return undefined;
    const typeNode = context.ast.typeNode(binding.field.selectedDeclaration) ??
      context.source.sourceFacts.getFact(binding.field.selectedDeclaration, fieldFactKey)?.type;
    const pointee = resolveRustTargetTypeRef(typeNode ?? binding.pointeeType, context, options);
    return pointee === undefined ? undefined : rustSourceLocationTargetType(pointee);
  }
  const sourceField = context.source.sourceFacts.getFact(subject, fieldFactKey);
  if (sourceField !== undefined) return resolveRustTargetTypeRef(sourceField.type, context, options);
  const valueStruct = context.source.sourceFacts.getFact(subject, structFactKey);
  if (valueStruct !== undefined) {
    const node = asNode(subject, context);
    if (node === undefined) return undefined;
    const semantics = context.semanticsFor(node);
    const type = semantics.types.expressionType(node);
    return type === undefined ? undefined : resolveStructuralObjectType(type, {
      ...context,
      currentSemantics: semantics,
    }, options, new Set<object>(), node, valueStruct);
  }
  const rawLocation = readRustRawLocation(context.ast, context.source.sourceFacts, subject);
  if (rawLocation?.kind === "resolved") {
    if (rawLocation.operation.operation === "to-raw") return rustOptionTargetType(rustRawPointerTargetType());
    const pointee = rawLocation.operation.explicitPointeeTypeNode === undefined
      ? resolveRustMemoryLayoutPointee(rawLocation.layout, context, options)
      : resolveRustTargetTypeRef(rawLocation.operation.explicitPointeeTypeNode, context, options);
    return pointee === undefined ? undefined : rustOptionTargetType(rustSourceLocationTargetType(pointee));
  }
  if (isRustSourceRawPointer(subject, context)) return rustRawPointerTargetType();
  if (resolveRustSourceMarker(subject, context) === "js-string") {
    return rustJsStringTargetType();
  }
  const fixedArray = context.source.sourceFacts.getFact(subject, tsonicFixedArrayFactKey);
  if (fixedArray !== undefined) {
    return resolveRustFixedArrayTargetType(fixedArray, context, options, new Set<object>());
  }
  const functionPointer = context.source.sourceFacts.getFact(subject, functionPointerFactKey);
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
  const pointer = context.source.sourceFacts.getFact(subject, pointerFactKey);
  if (pointer !== undefined) {
    const pointee = resolveRustTargetTypeRef(pointer.pointee, context, options);
    return pointee === undefined ? undefined : rustSourceLocationTargetType(pointee);
  }
  const node = asNode(subject, context);
  const declaration = node === undefined ? undefined :
    context.ast.is.IsVariableDeclaration(node) ? node : context.source.navigation.referenceFor(node)?.declaration;
  const induction = declaration === undefined ? undefined
    : sourceIntegerInduction(declaration, context.ast, context.source.navigation, {
        sourceFacts: context.source.sourceFacts, semanticsFor: context.semanticsFor,
      });
  if (induction !== undefined) {
    const bound = resolveRustTargetTypeRef(induction.bound, context, options);
    if (bound?.kind === "source-primitive" &&
      ["int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "int128", "uint128", "native-int", "native-uint"].includes(bound.name)) {
      return bound;
    }
  }
  if (node !== undefined && context.ast.is.IsArrayLiteralExpression(node) && context.ast.elements(node).length === 0) {
    const selected = context.semanticsFor(node).types.contextualValueSelection(node);
    const expected = selected.kind === "selected"
      ? resolveRustTypeComponentEvidence(selected.component, context, options, new Set<object>()) : undefined;
    const contextual = expected === undefined ? undefined : resolveRustContextualLiteralCarrier(context, node, expected);
    if (contextual !== undefined) return contextual;
  }
  const existing = context.records.runtimeCarrier.get(node)?.carrier;
  if (existing !== undefined) {
    return existing;
  }
  if (node !== undefined && context.ast.kindName(node) === "KindObjectLiteralExpression" &&
    context.ast.properties(node).length === 0) {
    return rustEmptyObjectTargetType();
  }
  const operationResult = context.records.selectedOperation.get(subject)?.resultType;
  if (operationResult !== undefined) {
    return operationResult;
  }
  const selectedCall = context.records.selectedCall.get(subject);
  if (selectedCall !== undefined) return resolveRustSelectedSourceCallResult(selectedCall, context, options);
  if (node !== undefined && (context.ast.is.IsPropertyDeclaration(node) || context.ast.is.IsPropertySignatureDeclaration(node))) {
    const typeNode = Node_Type(context.ast, node);
    if (typeNode !== undefined) {
      const carrier = resolveRustAuthoredTargetType(typeNode, context, options, new Set<object>());
      return carrier === undefined || context.ast.questionToken(node) === undefined
        ? carrier : rustSourceOptionalTargetType(carrier);
    }
  }
  const primitive = resolveSourcePrimitive(subject, context);
  if (primitive !== undefined) {
    return primitive;
  }
  if (node !== undefined && context.ast.kindName(node) === "KindParameter") {
    const parameterType = Node_Type(context.ast, node);
    if (parameterType === undefined) {
      const semantics = context.semanticsFor(node);
      return resolveRustTargetType(semantics.types.expressionType(node), {
        ...context,
        currentSemantics: semantics,
      }, options, new Set<object>(), node);
    }
    const carrier = resolveRustAuthoredTargetType(parameterType, context, options, new Set<object>());
    return rustParameterLaneTargetType(carrier, parameterType, context, options);
  }
  const conditional = node === undefined ? undefined
    : resolveRustConditionalAlias(node, context, options, new Set<object>());
  if (conditional !== undefined) return conditional.carrier;
  if (node !== undefined && context.ast.is.IsConditionalExpression(node)) {
    const expression = context.ast.as.AsConditionalExpression(node);
    if (expression?.WhenTrue !== undefined && expression.WhenFalse !== undefined) {
      const carrier = selectRustConditionalNumericCarrier(expression.WhenTrue, expression.WhenFalse,
        resolveRustTargetTypeRef(expression.WhenTrue, context, options),
        resolveRustTargetTypeRef(expression.WhenFalse, context, options), context.literalValues);
      if (carrier !== undefined) return carrier;
    }
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
    : context.semanticsFor(node).types.expressionType(node);
  return resolveRustTargetType(type, context, options, new Set<object>());
}

export function resolveRustTargetTypeSyntax(
  node: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const indexed = resolveRustProviderIndexedAccess(node, context, options);
  if (indexed !== undefined) return indexed;
  if (context.ast.is.IsTypeQueryNode(node)) {
    const expression = context.ast.as.AsTypeQueryNode(node)?.ExprName;
    const declaration = context.source.navigation.referenceFor(expression)?.declaration;
    if (declaration !== undefined && context.source.sourceFacts.getFact(declaration, structFactKey) !== undefined) {
      if (resolving.has(declaration)) return undefined;
      const existing = context.records.runtimeCarrier.get(declaration)?.carrier;
      if (existing !== undefined) return existing;
      resolving.add(declaration);
      try {
        const semantics = context.semanticsFor(declaration);
        const type = semantics.types.expressionType(declaration);
        return type === undefined ? undefined : resolveStructuralObjectType(type, {
          ...context,
          currentSemantics: semantics,
        }, options, resolving, declaration, context.source.sourceFacts.getFact(declaration, structFactKey));
      } finally {
        resolving.delete(declaration);
      }
    }
  }
  const valueStruct = context.source.sourceFacts.getFact(node, structFactKey);
  if (valueStruct !== undefined) {
    const semantics = context.semanticsFor(node);
    const type = semantics.types.expressionType(node);
    return type === undefined ? undefined : resolveStructuralObjectType(type, {
      ...context,
      currentSemantics: semantics,
    }, options, resolving, node, valueStruct);
  }
  const sourceFile = context.ast.getSourceFile(node);
  const semantics = sourceFile !== undefined && context.source.semantics.includes(sourceFile)
    ? context.semanticsFor(node)
    : undefined;
  const rustLifetimeContract = semantics === undefined
    ? undefined
    : rustSourceLifetimeTypeContract(node, context);
  if (rustLifetimeContract !== undefined) {
    return resolveRustLifetimeSourceType(
      node,
      rustLifetimeContract,
      context,
      options,
      resolving,
      resolveRustAuthoredTargetType,
    );
  }
  const fixedArray = context.source.sourceFacts.getFact(node, tsonicFixedArrayFactKey);
  if (fixedArray !== undefined) {
    return resolveRustFixedArrayTargetType(fixedArray, context, options, resolving);
  }
  const functionPointer = context.source.sourceFacts.getFact(node, functionPointerFactKey);
  if (functionPointer !== undefined) {
    const parameters = functionPointer.parameters.map((parameter) =>
      resolveRustAuthoredTargetType(parameter, context, options, resolving));
    const result = resolveRustAuthoredTargetType(functionPointer.result, context, options, resolving);
    return result === undefined || parameters.some((parameter) => parameter === undefined)
      ? undefined
      : {
          kind: "function-pointer",
          args: parameters as TargetTypeRef[],
          result,
          ...(functionPointer.abi.length === 0 ? {} : { abi: functionPointer.abi }),
        };
  }
  if (isRustSourceRawPointer(node, context)) return rustRawPointerTargetType();
  const pointer = context.source.sourceFacts.getFact(node, pointerFactKey);
  if (pointer !== undefined) {
    const pointee = resolveRustAuthoredTargetType(pointer.pointee, context, options, resolving);
    return pointee === undefined ? undefined : rustSourceLocationTargetType(pointee);
  }
  const primitive = resolveSourcePrimitive(node, context);
  if (primitive !== undefined) {
    return primitive;
  }
  const { ast } = context;
  const kind = ast.kindName(node);
  if (kind === "KindIntersectionType") {
    if (semantics === undefined) return undefined;
    const selected = semantics.types.expressionType(node);
    return selected === undefined ? undefined : resolveStructuralObjectType(selected,
      { ...context, currentSemantics: semantics }, options, resolving, node);
  }
  if (kind === "KindNullKeyword") {
    return rustAbsenceTargetType();
  }
  if (kind === "KindUndefinedKeyword") {
    return rustAbsenceTargetType();
  }
  if (kind === "KindVoidExpression") {
    return ast.as.AsVoidExpression(node)?.Expression === undefined ? undefined : rustAbsenceTargetType();
  }
  if (kind === "KindLiteralType") {
    const literal = ast.as.AsLiteralTypeNode(node)?.Literal;
    if (literal !== undefined && ast.kindName(literal) === "KindNullKeyword") {
      return rustAbsenceTargetType();
    }
  }
  if (kind === "KindAnyKeyword" || kind === "KindUnknownKeyword" || kind === "KindObjectKeyword") {
    return resolveRustAuthoredBroadSourceValueTargetType(
      node,
      context,
      options.jsEnabled,
    );
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
  if (kind === "KindNeverKeyword") {
    return rustNeverTargetType();
  }
  if (kind === "KindFunctionType" || kind === "KindThisType") {
    return resolveRustTargetType(
      semantics?.types.expressionType(node),
      context,
      options,
      resolving,
    );
  }
  if (kind === "KindParenthesizedType") {
    const inner = ast.as.AsParenthesizedTypeNode(node)?.Type;
    return inner === undefined
      ? undefined
      : resolveRustAuthoredTargetType(inner, context, options, resolving);
  }
  if (kind === "KindArrayType") {
    const elementNode = ArrayTypeNode_ElementType(ast, node);
    const element = elementNode === undefined
      ? undefined
      : resolveRustAuthoredTargetType(elementNode, rustSourceStorageComponentContext(context, { kind: "array-element" }), options, resolving);
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
      : resolveRustAuthoredTargetType(inner, context, options, resolving);
  }
  if (kind === "KindTupleType") {
    const elementNodes = denseDefined(ast.elements(node));
    if (elementNodes === undefined) {
      return undefined;
    }
    const elements = elementNodes.map((element, index) => resolveRustAuthoredTargetType(element,
      rustSourceStorageComponentContext(context, { kind: "tuple-element", index }), options, resolving));
    return elements.every((element) => element !== undefined)
      ? rustTupleTargetType(elements as TargetTypeRef[])
      : undefined;
  }
  if (kind === "KindUnionType") {
    const sourceType = semantics?.types.expressionType(node);
    if (sourceType !== undefined && semantics !== undefined &&
      (semantics.types.isAny(sourceType) || semantics.types.isUnknown(sourceType))) {
      return resolveRustAuthoredBroadSourceValueTargetType(node, context, options.jsEnabled);
    }
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
    const typeContext = rustSourceStorageSubjectContext(context, undefined);
    const selectedCarriers = semanticMembers.map(member => resolveRustAuthoredTargetType(member, typeContext, options, resolving));
    if (selectedCarriers.every(carrier => carrier !== undefined)) {
      const selected = resolveRustSourceUnionCarrier(selectedCarriers as TargetTypeRef[], values => resolveRustUnionValueCarrier(values, options, () => {
        const isValue = (carrier: TargetTypeRef | undefined): boolean =>
          !isRustUnitCarrier(carrier) && !isRustAbsenceCarrier(carrier);
        const valueNodes = semanticMembers.filter((_, index) => isValue(selectedCarriers[index]));
        const valueCarriers = selectedCarriers.filter(isValue) as TargetTypeRef[];
        const valueTypes = valueNodes.map(member => semantics?.types.expressionType(member));
        return semantics === undefined || sourceType === undefined || valueTypes.some(type => type === undefined)
          ? undefined
          : resolveRustInferredUnion(sourceType, valueTypes as Type[], valueCarriers,
              { ...context, currentSemantics: semantics, currentSourceFile: sourceFile! }, options);
      }));
      if (selected !== undefined) return selected;
    }
    return resolveRustTargetType(sourceType, context, options, resolving);
  }

  if (kind !== "KindTypeReference" && kind !== "KindExpressionWithTypeArguments" || semantics === undefined) {
    return undefined;
  }
  const selectedType = semantics.types.expressionType(node);
  const standardTransformation = selectedType === undefined
    ? undefined
    : semantics.types.standardTransformation(
        node,
        selectedType,
      );
  if (standardTransformation !== undefined && selectedType !== undefined) {
    return resolveStandardSourceTypeTransformation(
      standardTransformation,
      selectedType,
      node,
      context,
      options,
      resolving,
    );
  }
  const typeArgumentNodes = denseDefined(ast.typeArguments(node));
  if (typeArgumentNodes === undefined) {
    return undefined;
  }
  const typeName = kind === "KindExpressionWithTypeArguments"
    ? ast.as.AsExpressionWithTypeArguments(node)?.Expression : TypeReferenceNode_TypeName(ast, node);
  const referencedDeclaration = typeName === undefined
    ? undefined
    : context.source.navigation.sourceReferenceFor(typeName)?.declaration;
  const selectedTypeSymbol = selectedType === undefined
    ? undefined
    : context.currentSemantics.declarations.typeAliasSymbol(selectedType) ??
      context.currentSemantics.declarations.typeSymbol(selectedType);
  const sourceGenericContract = context.sourceLifetimes.contractFor(referencedDeclaration);
  const sourceGenericArguments = sourceGenericContract === undefined
    ? undefined
    : resolveRustSourceDeclarationArguments(
        typeArgumentNodes,
        sourceGenericContract,
        context,
        options,
        resolving,
        selectedType,
      );
  const typeArguments = sourceGenericArguments === undefined
    ? typeArgumentNodes.map((argument) =>
        resolveRustAuthoredTargetType(argument, selectedType !== undefined &&
          semantics.types.isArrayLike(selectedType) && !semantics.types.isTuple(selectedType)
            ? rustSourceStorageComponentContext(context, { kind: "array-element" }) : context, options, resolving))
    : sourceGenericArguments.values.flatMap((argument) =>
        argument.kind === "type" ? [argument.type] : []);
  if (typeArguments === undefined || typeArguments.some((argument) => argument === undefined)) {
    return undefined;
  }
  if (referencedDeclaration !== undefined && ast.is.IsTypeAliasDeclaration(referencedDeclaration) &&
    context.source.navigation.isProjectDeclaration(referencedDeclaration) &&
    options.sourceTypes.carrierForDeclaration(referencedDeclaration) !== undefined) {
    const alias = resolveProjectSourceCarrier(selectedTypeSymbol, sourceGenericArguments ?? {
      values: Object.freeze((typeArguments as readonly TargetTypeRef[]).map((type) =>
        Object.freeze({ kind: "type" as const, type }))),
    }, context, options, referencedDeclaration, selectedType, resolving,
    selectedType !== undefined && resolving.has(selectedType));
    if (alias !== undefined) return alias;
  }
  const reference = context.source.navigation.sourceReferenceFor(typeName);
  const provider = resolveProviderTypeIdentity(
    reference === undefined ? semantics.facts.authoredTypeSubjects(node)
      : semantics.facts.selectedSubjects(reference.symbol, reference.declaration),
    context,
  );
  if (provider !== undefined) {
    const relation = providerCarrierFromRelations(provider, options);
    if (relation === undefined) return undefined;
    const providerArguments = resolveRustProviderGenericArguments(
      typeArgumentNodes,
      relation.genericParameters ?? [],
      context,
      options,
      resolving,
    );
    return providerArguments === undefined
      ? undefined
      : instantiateProviderTargetType(relation, providerArguments, context.typeDefinitions);
  }
  const sourceProfileName = referencedDeclaration === undefined
    ? resolveOwnedSourceProfileTypeName(selectedTypeSymbol, context, options.sourceProfiles)
    : resolveOwnedSourceProfileTypeNameForDeclaration(referencedDeclaration, context, options.sourceProfiles);
  if (sourceProfileName !== undefined) {
    return resolveSourceProfileCarrierFromArguments(sourceProfileName, typeArguments as TargetTypeRef[], {
      jsEnabled: options.jsEnabled,
      sourceErrorCarrier: rustSourceProfileErrorCarrierNeeded(sourceProfileName, options.jsEnabled)
        ? options.sourceErrorCarrier(context.sourceStorageResolution?.kind === "resolved"
          ? context.sourceStorageResolution.subject : undefined) : undefined,
    });
  }
  const sourceType = resolveProjectSourceCarrier(
    selectedTypeSymbol,
    sourceGenericArguments ?? {
      values: Object.freeze((typeArguments as readonly TargetTypeRef[]).map((type) =>
        Object.freeze({ kind: "type" as const, type }))),
    },
    context,
    options,
    referencedDeclaration,
    selectedType,
    resolving,
    selectedType !== undefined && resolving.has(selectedType),
  );
  if (sourceType !== undefined) {
    return sourceType;
  }
  const selectedDeclaration = context.source.navigation.sourceReferenceFor(node)?.declaration ??
    referencedDeclaration;
  const typeParameter = resolveSourceTypeParameter(
    selectedTypeSymbol,
    selectedDeclaration,
    context,
  );
  if (typeParameter !== undefined) {
    return typeParameter;
  }
  return selectedType === undefined
    ? undefined
    : resolveRustCheckerTransformedType(
        node,
        selectedType,
        context,
        options,
        resolving,
      );
}

import { resolveRustSourceUnionCarrier } from "./source-unions.js";
import {
  ArrayTypeNode_ElementType,
  Node_Type,
  Node_Operand,
  TypeReferenceNode_TypeName,
  TypeOperatorNode_Type,
  sourceIntegerInduction,
} from "@tsonic/target-api/source";
import {
  rustBigIntTargetType,
  rustEmptyObjectTargetType,
  rustJsArrayTargetType,
  rustJsStringTargetType,
  rustSourceLocationTargetType,
  rustRawPointerTargetType,
  rustAbsenceTargetType,
  isRustAbsenceCarrier,
  rustNeverTargetType,
  rustOptionTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustTupleTargetType,
  rustUnitTargetType,
  rustVecTargetType,
} from "../../../target-model/types/index.js";
import { asNode } from "../../evidence/selected-source.js";
import { denseDefined, resolveProjectSourceCarrier } from "./project.js";
import { fieldFactKey, functionPointerFactKey, pointerFactKey, structFactKey } from "@tsonic/tsts";
import { resolveRustSourceMarker } from "./markers.js";
import { instantiateProviderTargetType, providerCarrierFromRelations, resolveOwnedSourceProfileTypeName, resolveProviderTypeIdentity, resolveSourceProfileCarrierFromArguments } from "./providers.js";
import { resolveCallableType, resolveSourcePrimitive, resolveSourceTypeParameter } from "./callables.js";
import { resolveReferencedDeclarationType, resolveRustAuthoredTargetType, resolveRustTupleElementTargetTypeWithState, rustParameterLaneTargetType } from "./tuples.js";
import { resolveRustFixedArrayTargetType, resolveRustTargetType, resolveStructuralObjectType } from "./target.js";
import { sourceTransformedTypeFactEvidenceNodes } from "@tsonic/target-api/source";
import { tsonicFixedArrayFactKey } from "@tsonic/source-core/facts";
import { isRustSourceRawPointer } from "../../operations/pointers/source-raw-pointers.js";
import type { ExtensionFactSubject, Node, Type } from "@tsonic/tsts";
import type { SourceStandardTypeTransformation } from "@tsonic/target-api/source";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type {
  RustTargetConstArgument,
  RustTargetGenericArgument,
  TargetTypeRef,
} from "../../../target-model/types/model.js";
import {
  resolveRustLifetimeSourceType,
  rustSourceLifetimeTypeContract,
} from "./lifetimes.js";
import { parseSourceIntegerLiteral } from "../../../target-model/syntax/literals.js";
import { readRustRawLocation, resolveRustMemoryLayoutPointee } from "../../operations/pointers/native-memory.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import {
  resolveRustCallableEvidence,
  resolveRustEvidenceNodesToCommonCarrier,
  resolveRustSignatureParameterEvidence,
  resolveRustSignatureParameterListTarget,
  resolveRustTypeComponentEvidence,
} from "./source-evidence.js";
import { resolveRustAuthoredBroadSourceValueTargetType } from "./broad-values.js";
import { resolveRustInferredObjectUnion } from "./inferred-unions.js";
import { resolveRustConditionalAlias } from "./type-families.js";
import { tsonicMemoryFieldBindingFactKey, selectTsonicMemoryFieldBinding } from "@tsonic/source-core/facts";
import { selectRustConditionalNumericCarrier } from "../conditional-numeric-carrier.js";
import { resolveRustProviderIndexedAccess } from "./indexed-access.js";

export function resolveRustTargetTypeRef(
  subject: ExtensionFactSubject | undefined,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  if (subject === undefined) {
    return undefined;
  }
  const subjectNode = asNode(subject, context);
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
  const valueStruct = context.facts.resolve(subject, structFactKey) ?? context.facts.get(subject, structFactKey);
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
  const fixedArray = context.facts.resolve(subject, tsonicFixedArrayFactKey) ??
    context.facts.get(subject, tsonicFixedArrayFactKey);
  if (fixedArray !== undefined) {
    return resolveRustFixedArrayTargetType(fixedArray, context, options, new Set<object>());
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
  const existing = context.facts.getRuntimeCarrierFact(node)?.carrier;
  if (existing !== undefined) {
    return existing;
  }
  if (node !== undefined && context.ast.kindName(node) === "KindObjectLiteralExpression" &&
    context.ast.properties(node).length === 0) {
    return rustEmptyObjectTargetType();
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
        resolveRustTargetTypeRef(expression.WhenFalse, context, options), context.ast);
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
    if (declaration !== undefined && context.facts.get(declaration, structFactKey) !== undefined) {
      if (resolving.has(declaration)) return undefined;
      const existing = context.facts.getRuntimeCarrierFact(declaration)?.carrier;
      if (existing !== undefined) return existing;
      resolving.add(declaration);
      try {
        const semantics = context.semanticsFor(declaration);
        const type = semantics.types.expressionType(declaration);
        return type === undefined ? undefined : resolveStructuralObjectType(type, {
          ...context,
          currentSemantics: semantics,
        }, options, resolving, declaration, context.facts.get(declaration, structFactKey));
      } finally {
        resolving.delete(declaration);
      }
    }
  }
  const valueStruct = context.facts.resolve(node, structFactKey) ?? context.facts.get(node, structFactKey);
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
  const fixedArray = context.facts.resolve(node, tsonicFixedArrayFactKey) ??
    context.facts.get(node, tsonicFixedArrayFactKey);
  if (fixedArray !== undefined) {
    return resolveRustFixedArrayTargetType(fixedArray, context, options, resolving);
  }
  const functionPointer = context.facts.resolve(node, functionPointerFactKey) ??
    context.facts.get(node, functionPointerFactKey);
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
  const pointer = context.facts.resolve(node, pointerFactKey) ??
    context.facts.get(node, pointerFactKey);
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
  if (kind === "KindAnyKeyword" || kind === "KindUnknownKeyword") {
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
  if (kind === "KindFunctionType") {
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
      : resolveRustAuthoredTargetType(elementNode, context, options, resolving);
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
    const elements = elementNodes.map((element) => resolveRustAuthoredTargetType(element, context, options, resolving));
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
    const sourceType = semantics?.types.expressionType(node);
    const selectedCarriers = semanticMembers.map(member => resolveRustAuthoredTargetType(member, context, options, resolving));
    if (selectedCarriers.every(carrier => carrier !== undefined)) {
      const selected = resolveRustSourceUnionCarrier(selectedCarriers as TargetTypeRef[], values => {
        const common = options.resolveProjectUnionCarrier(values);
        if (common !== undefined && values.some(carrier => rustTargetTypeRefEquals(carrier, common))) return common;
        const valueNodes = semanticMembers.filter((_, index) => !isRustAbsenceCarrier(selectedCarriers[index]));
        const valueCarriers = selectedCarriers.filter(carrier => !isRustAbsenceCarrier(carrier)) as TargetTypeRef[];
        const valueTypes = valueNodes.map(member => semantics?.types.expressionType(member));
        return semantics === undefined || sourceType === undefined || valueTypes.some(type => type === undefined)
          ? common
          : resolveRustInferredObjectUnion(sourceType, valueTypes as Type[], valueCarriers,
              { ...context, currentSemantics: semantics, currentSourceFile: sourceFile! }, options) ?? common;
      });
      if (selected !== undefined) return selected;
    }
    return resolveRustTargetType(sourceType, context, options, resolving);
  }

  if (kind !== "KindTypeReference" || semantics === undefined) {
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
  const typeName = TypeReferenceNode_TypeName(ast, node);
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
    : resolveProjectGenericArguments(
        typeArgumentNodes,
        sourceGenericContract,
        context,
        options,
        resolving,
      );
  const typeArguments = sourceGenericArguments === undefined
    ? typeArgumentNodes.map((argument) =>
        resolveRustAuthoredTargetType(argument, context, options, resolving))
    : sourceGenericArguments.values.flatMap((argument) =>
        argument.kind === "type" ? [argument.type] : []);
  if (typeArguments === undefined || typeArguments.some((argument) => argument === undefined)) {
    return undefined;
  }
  if (referencedDeclaration !== undefined && ast.is.IsTypeAliasDeclaration(referencedDeclaration) &&
    context.source.navigation.isProjectDeclaration(referencedDeclaration) &&
    options.sourceTypes.carrierForDeclaration(referencedDeclaration, ast) !== undefined) {
    const alias = resolveProjectSourceCarrier(selectedTypeSymbol, sourceGenericArguments ?? {
      values: Object.freeze((typeArguments as readonly TargetTypeRef[]).map((type) =>
        Object.freeze({ kind: "type" as const, type }))),
    }, context, options, referencedDeclaration, selectedType, resolving);
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
  const sourceProfileName = resolveOwnedSourceProfileTypeName(
    selectedTypeSymbol,
    context,
    options.sourceProfiles,
  );
  if (sourceProfileName !== undefined) {
    return resolveSourceProfileCarrierFromArguments(sourceProfileName, typeArguments as TargetTypeRef[], options);
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

export function resolveRustProviderGenericArguments(
  nodes: readonly Node[],
  parameters: readonly import("../../../target-model/operations/model.js").RustProviderGenericParameter[],
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): readonly RustTargetGenericArgument[] | undefined {
  if (nodes.length > parameters.length) return undefined;
  const values: RustTargetGenericArgument[] = [];
  for (const [index, node] of nodes.entries()) {
    const parameter = parameters[index];
    if (parameter === undefined) return undefined;
    const value = resolveRustProviderGenericArgument(
      node,
      parameter,
      context,
      options,
      resolving,
    );
    if (value === undefined) return undefined;
    values.push(value);
  }
  return Object.freeze(values);
}

export function resolveRustProviderGenericArgument(
  node: Node,
  parameter: import("../../../target-model/operations/model.js").RustProviderGenericParameter,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object> = new Set<object>(),
): RustTargetGenericArgument | undefined {
  if (parameter.kind === "type") {
    const type = resolveRustAuthoredTargetType(node, context, options, resolving);
    return type === undefined
      ? undefined
      : Object.freeze({ kind: "type", type });
  }
  if (parameter.kind === "lifetime") {
    const lifetime = context.sourceLifetimes.resolve(node);
    return lifetime === undefined
      ? undefined
      : Object.freeze({ kind: "lifetime", lifetime });
  }
  const value = resolveRustConstGenericArgument(node, context);
  return value === undefined
    ? undefined
    : Object.freeze({ kind: "const", value });
}

export function resolveRustConstGenericArgument(
  node: Node,
  context: RustTargetTypeResolutionContext,
): RustTargetConstArgument | undefined {
  const literal = context.ast.kindName(node) === "KindLiteralType"
    ? context.ast.as.AsLiteralTypeNode(node)?.Literal
    : node;
  if (literal === undefined) return undefined;
  const kind = context.ast.kindName(literal);
  if (kind === "KindTrueKeyword" || kind === "KindFalseKeyword") {
    return Object.freeze({ kind: "boolean", value: kind === "KindTrueKeyword" });
  }
  if (kind === "KindStringLiteral") {
    const value = context.ast.text(literal);
    return [...value].length === 1
      ? Object.freeze({ kind: "char", value })
      : undefined;
  }
  const integer = constIntegerText(literal, context);
  return integer === undefined
    ? undefined
    : Object.freeze({ kind: "integer", value: integer });
}

function constIntegerText(
  node: Node,
  context: RustTargetTypeResolutionContext,
): string | undefined {
  if (context.ast.kindName(node) === "KindNumericLiteral" ||
    context.ast.kindName(node) === "KindBigIntLiteral") {
    return parseSourceIntegerLiteral(context.ast.text(node).replace(/n$/, ""))?.toString(10);
  }
  if (context.ast.kindName(node) !== "KindPrefixUnaryExpression") {
    return undefined;
  }
  const operand = Node_Operand(context.ast, node);
  if (operand === undefined || (context.ast.kindName(operand) !== "KindNumericLiteral" &&
    context.ast.kindName(operand) !== "KindBigIntLiteral")) {
    return undefined;
  }
  const value = parseSourceIntegerLiteral(context.ast.text(operand).replace(/n$/, ""));
  if (value === undefined) return undefined;
  const operator = context.ast.operatorKindName(node);
  return operator === "KindMinusToken"
    ? (-value).toString(10)
    : operator === "KindPlusToken"
      ? value.toString(10)
      : undefined;
}

function resolveProjectGenericArguments(
  argumentNodes: readonly Node[],
  contract: import("../../../target-model/lifetimes/index.js").RustSourceGenericContract,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): import("./project.js").RustResolvedProjectGenericArguments | undefined {
  if (argumentNodes.length !== contract.parameters.length) return undefined;
  const values: import("../../../target-model/types/model.js").RustTargetGenericArgument[] = [];
  for (const [index, parameter] of contract.parameters.entries()) {
    const argument = argumentNodes[index];
    if (argument === undefined) return undefined;
    if (parameter.kind === "lifetime") {
      const lifetime = context.sourceLifetimes.resolve(argument);
      if (lifetime === undefined) return undefined;
      values.push(Object.freeze({ kind: "lifetime", lifetime }));
    } else {
      const type = resolveRustAuthoredTargetType(argument, context, options, resolving);
      if (type === undefined) return undefined;
      values.push(Object.freeze({ kind: "type", type }));
    }
  }
  return Object.freeze({
    values: Object.freeze(values),
  });
}

function resolveRustCheckerTransformedType(
  authoredRoot: Node,
  selectedType: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const semantics = context.semanticsFor(authoredRoot);
  const standard = semantics.types.standardTransformation(
    authoredRoot,
    selectedType,
  );
  if (standard !== undefined) {
    return resolveStandardSourceTypeTransformation(
      standard,
      selectedType,
      authoredRoot,
      context,
      options,
      resolving,
    );
  }
  const direct = resolveRustEvidenceNodesToCommonCarrier(
    sourceTransformedTypeFactEvidenceNodes(
      context.ast,
      semantics,
      authoredRoot,
      selectedType,
    ),
    selectedType,
    context,
    options,
    resolving,
  );
  if (direct !== undefined) {
    return direct;
  }
  if (semantics.types.isTuple(selectedType)) {
    const infos = semantics.types.tupleElementInfos(selectedType);
    const elements = infos.map((element) =>
      resolveRustTupleElementTargetTypeWithState(
        element,
        semantics,
        context,
        options,
        resolving,
        authoredRoot,
      )
    );
    return infos.length === 0 || elements.some((element) => element === undefined)
      ? undefined
      : rustTupleTargetType(elements as readonly TargetTypeRef[]);
  }
  const callable = resolveCallableType(
    selectedType,
    context,
    options,
    resolving,
  );
  return callable ?? resolveRustTargetType(
    selectedType,
    context,
    options,
    resolving,
    authoredRoot,
  );
}

function resolveStandardSourceTypeTransformation(
  transformation: SourceStandardTypeTransformation,
  selectedType: Type,
  authoredRoot: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  if (transformation.kind === "unresolved") {
    return undefined;
  }
  if (transformation.kind === "component") {
    return resolveRustTypeComponentEvidence(
      transformation.component,
      context,
      options,
      resolving,
    );
  }
  if (transformation.kind === "parameter-list") {
    const elements = transformation.parameters.map((element) =>
      resolveRustSignatureParameterEvidence(
        element,
        context,
        options,
        resolving,
        "parameter-list",
      )
    );
    return elements.some((element) => element === undefined)
      ? undefined
      : resolveRustSignatureParameterListTarget(
          transformation.parameters,
          elements as readonly TargetTypeRef[],
          options,
        );
  }
  if (transformation.kind === "structural") {
    return resolveStructuralObjectType(
      selectedType,
      context,
      options,
      resolving,
      authoredRoot,
    );
  }
  return resolveRustCallableEvidence(
    transformation.callable,
    context,
    options,
    resolving,
  );
}

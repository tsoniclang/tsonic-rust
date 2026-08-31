import {
  ArrayTypeNode_ElementType,
  Node_Type,
  Node_Operand,
  TypeReferenceNode_TypeName,
  TypeOperatorNode_Type,
} from "@tsonic/target-api/source";
import {
  rustBigIntTargetType,
  rustJsArrayTargetType,
  rustJsStringTargetType,
  rustLocationTargetType,
  rustNullTargetType,
  rustNeverTargetType,
  rustOptionTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustTupleTargetType,
  rustUnitTargetType,
  rustUndefinedTargetType,
  rustVecTargetType,
  rustFixedArrayTargetType,
} from "../../../target-model/types/index.js";
import { asNode } from "../../evidence/selected-source.js";
import { denseDefined, resolveProjectSourceCarrier } from "./project.js";
import { functionPointerFactKey, pointerFactKey, sourceMarkerFactKey } from "@tsonic/tsts";
import { instantiateProviderTargetType, providerCarrierFromRelations, resolveOwnedSourceProfileTypeName, resolveProviderTypeIdentity, resolveSourceProfileCarrierFromArguments } from "./providers.js";
import { resolveCallableType, resolveSourcePrimitive, resolveSourceTypeParameter } from "./callables.js";
import { resolveReferencedDeclarationType, resolveRustAuthoredTargetType, resolveRustTupleElementTargetTypeWithState, rustParameterLaneTargetType } from "./tuples.js";
import { resolveRustTargetType, resolveStructuralObjectType } from "./target.js";
import { sourceTransformedTypeFactEvidenceNodes } from "@tsonic/target-api/source";
import { tsonicFixedArrayFactKey } from "@tsonic/source-core/facts";
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
import {
  resolveRustCallableEvidence,
  resolveRustEvidenceNodesToCommonCarrier,
  resolveRustSignatureParameterEvidence,
  resolveRustSignatureParameterListTarget,
  resolveRustTypeComponentEvidence,
} from "./source-evidence.js";
import { resolveRustAuthoredBroadSourceValueTargetType } from "./broad-values.js";

export function resolveRustTargetTypeRef(
  subject: ExtensionFactSubject | undefined,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  if (subject === undefined) {
    return undefined;
  }
  if (resolveRustSourceMarker(subject, context) === "js-string") {
    return rustJsStringTargetType();
  }
  const fixedArray = context.facts.resolve(subject, tsonicFixedArrayFactKey) ??
    context.facts.get(subject, tsonicFixedArrayFactKey);
  if (fixedArray !== undefined) {
    const element = resolveRustTargetTypeRef(fixedArray.elementType, context, options);
    return element === undefined
      ? undefined
      : rustFixedArrayTargetType(element, fixedArray.length);
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
    const carrier = resolveRustAuthoredTargetType(parameterType, context, options, new Set<object>());
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
    : context.semanticsFor(node).types.expressionType(node);
  return resolveRustTargetType(type, context, options, new Set<object>());
}

function resolveRustSourceMarker(
  subject: ExtensionFactSubject,
  context: RustTargetTypeResolutionContext,
): string | undefined {
  const node = asNode(subject, context);
  const subjects = node === undefined
    ? [subject, ...context.currentSemantics.facts.typeSubjects(subject as Type)]
    : [subject];
  const markers = new Set<string>();
  for (const candidate of subjects) {
    const marker = context.facts.resolve(candidate, sourceMarkerFactKey) ??
      context.facts.get(candidate, sourceMarkerFactKey);
    if (marker !== undefined) {
      markers.add(marker.marker);
    }
  }
  return markers.size === 1 ? markers.values().next().value : undefined;
}

export function resolveRustTargetTypeSyntax(
  node: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const rustLifetimeContract = rustSourceLifetimeTypeContract(node, context);
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
    const element = resolveRustAuthoredTargetType(
      fixedArray.elementType,
      context,
      options,
      resolving,
    );
    return element === undefined
      ? undefined
      : rustFixedArrayTargetType(element, fixedArray.length);
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
  const { ast } = context;
  const kind = ast.kindName(node);
  if (kind === "KindNullKeyword") {
    return rustNullTargetType();
  }
  if (kind === "KindUndefinedKeyword") {
    return rustUndefinedTargetType();
  }
  if (kind === "KindLiteralType") {
    const literal = ast.as.AsLiteralTypeNode(node)?.Literal;
    if (literal !== undefined && ast.kindName(literal) === "KindNullKeyword") {
      return rustNullTargetType();
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
      context.semanticsFor(node).types.expressionType(node),
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
        : resolveRustAuthoredTargetType(value, context, options, resolving);
      if (valueCarrier !== undefined) {
        return rustOptionTargetType(valueCarrier);
      }
    }
    return resolveRustTargetType(
      context.semanticsFor(node).types.expressionType(node),
      context,
      options,
      resolving,
    );
  }
  if (kind !== "KindTypeReference") {
    return undefined;
  }
  const selectedType = context.semanticsFor(node).types.expressionType(node);
  const standardTransformation = selectedType === undefined
    ? undefined
    : context.semanticsFor(node).types.standardTransformation(
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
  const provider = resolveProviderTypeIdentity(
    context.semanticsFor(node).facts.authoredTypeSubjects(node),
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
      : instantiateProviderTargetType(relation, providerArguments);
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
  if (context.ast.kindName(node) === "KindNumericLiteral") {
    return parseSourceIntegerLiteral(context.ast.text(node))?.toString(10);
  }
  if (context.ast.kindName(node) !== "KindPrefixUnaryExpression") {
    return undefined;
  }
  const operand = Node_Operand(context.ast, node);
  if (operand === undefined || context.ast.kindName(operand) !== "KindNumericLiteral") {
    return undefined;
  }
  const value = parseSourceIntegerLiteral(context.ast.text(operand));
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

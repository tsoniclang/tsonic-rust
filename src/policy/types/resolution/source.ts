import {
  ArrayTypeNode_ElementType,
  Node_Type,
  TypeReferenceNode_TypeName,
  TypeOperatorNode_Type,
} from "@tsonic/target-api/source";
import {
  rustBigIntTargetType,
  rustAsyncCallableTargetType,
  rustCallableTargetType,
  rustFutureOutputCarrier,
  rustJsArrayTargetType,
  rustJsStringTargetType,
  rustLocationTargetType,
  rustNullTargetType,
  rustNeverTargetType,
  rustOptionElementCarrier,
  rustOptionTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustTupleTargetType,
  rustUnitTargetType,
  rustUndefinedTargetType,
  rustVecTargetType,
  rustFixedArrayTargetType,
  rustFunctionPointerTargetType,
  isRustJsArrayCarrier,
  rustJsArrayLikeElementTargetType,
} from "../../../target-model/types/index.js";
import { asNode } from "../../evidence/selected-source.js";
import { denseDefined, resolveProjectSourceCarrier } from "./project.js";
import { functionPointerFactKey, pointerFactKey, sourceMarkerFactKey } from "@tsonic/tsts";
import { instantiateProviderTargetType, providerCarrierFromRelations, resolveOwnedSourceProfileTypeName, resolveProviderTypeIdentity, resolveSourceProfileCarrierFromArguments } from "./providers.js";
import { resolveCallableType, resolveSourcePrimitive, resolveSourceTypeParameter } from "./callables.js";
import { resolveReferencedDeclarationType, resolveRustAuthoredTargetType, resolveRustTupleElementTargetTypeWithState, rustParameterLaneTargetType } from "./tuples.js";
import { resolveRustExactNullishValueCarrier, resolveRustTargetType, resolveStructuralObjectType } from "./target.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { sourceTransformedTypeFactEvidenceNodes } from "@tsonic/target-api/source";
import { tsonicFixedArrayFactKey } from "@tsonic/source-core/facts";
import type { ExtensionFactSubject, Node, Type } from "@tsonic/tsts";
import type {
  SourceCallableTypeEvidence,
  SourceStandardTypeTransformation,
  SourceTypeComponentEvidence,
} from "@tsonic/target-api/source";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import {
  resolveRustSemanticSourceType,
  resolveRustSourceGenericArgument,
} from "./rust-semantics.js";

export function resolveRustTargetTypeRef(
  subject: ExtensionFactSubject | undefined,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  if (subject === undefined) {
    return undefined;
  }
  const semanticNode = asNode(subject, context);
  if (semanticNode !== undefined) {
    const semanticType = resolveRustSemanticSourceType(
      semanticNode,
      context,
      options,
      new Set<object>(),
      resolveRustAuthoredTargetType,
    );
    if (semanticType !== undefined) return semanticType;
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
      : rustFunctionPointerTargetType({
          parameters: parameters as TargetTypeRef[],
          result,
          abi: functionPointer.abi[0] as import("../../../target-model/semantics/index.js").RustAbi | undefined,
        });
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
  const semanticType = resolveRustSemanticSourceType(
    node,
    context,
    options,
    resolving,
    resolveRustAuthoredTargetType,
  );
  if (semanticType !== undefined) return semanticType;
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
      : rustFunctionPointerTargetType({
          parameters: parameters as TargetTypeRef[],
          result,
          abi: functionPointer.abi[0] as import("../../../target-model/semantics/index.js").RustAbi | undefined,
        });
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
    return elements.every((element) => element !== undefined)
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
  const provider = resolveProviderTypeIdentity(
    context.semanticsFor(node).facts.authoredTypeSubjects(node),
    context,
  );
  if (provider !== undefined) {
    const relation = providerCarrierFromRelations(provider, options);
    if (relation === undefined ||
      relation.sourceGenericBindings.length !== typeArgumentNodes.length) {
      return undefined;
    }
    const genericArguments = typeArgumentNodes.map((argument, index) => {
      const binding = relation.sourceGenericBindings[index];
      if (binding === undefined) return undefined;
      if (binding.target.kind === "associated-type" ||
        binding.target.kind === "semantic-parameter") {
        const value = resolveRustAuthoredTargetType(argument, context, options, resolving);
        return value === undefined
          ? undefined
          : Object.freeze({ kind: "type" as const, value });
      }
      return resolveRustSourceGenericArgument(
        argument,
        binding.target.parameter,
        context,
        (node) => resolveRustAuthoredTargetType(node, context, options, resolving),
      );
    });
    return genericArguments.some((argument) => argument === undefined)
      ? undefined
      : instantiateProviderTargetType(
          relation,
          genericArguments as import("../../../target-model/semantics/index.js").RustGenericArgument[],
          context.sourceGenerics,
        );
  }
  const typeArguments = typeArgumentNodes.map((argument) =>
    resolveRustAuthoredTargetType(argument, context, options, resolving));
  if (typeArguments.some((argument) => argument === undefined)) {
    return undefined;
  }
  const sourceProfileName = resolveOwnedSourceProfileTypeName(
    selectedTypeSymbol,
    context,
    options.sourceProfiles,
  );
  if (sourceProfileName !== undefined) {
    return resolveSourceProfileCarrierFromArguments(sourceProfileName, typeArguments as TargetTypeRef[], options);
  }
  const projectDeclaration = referencedDeclaration ??
    context.source.navigation.sourceReferenceFor(node)?.declaration;
  const projectGenericContract = context.sourceGenerics.contractFor(projectDeclaration);
  const projectGenericArguments = projectGenericContract === undefined
    ? typeArgumentNodes.length === 0 ? [] : undefined
    : projectGenericContract.parameters.length !== typeArgumentNodes.length
      ? undefined
      : typeArgumentNodes.map((argument, index) =>
          resolveRustSourceGenericArgument(
            argument,
            projectGenericContract.parameters[index]!.parameter,
            context,
            (selected) => resolveRustAuthoredTargetType(selected, context, options, resolving),
          ));
  const sourceType = projectGenericArguments === undefined ||
      projectGenericArguments.some((argument) => argument === undefined)
    ? undefined
    : resolveProjectSourceCarrier(
        selectedTypeSymbol,
        projectGenericArguments as readonly import("../../../target-model/semantics/index.js").RustGenericArgument[],
        context,
        options,
        projectDeclaration,
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

function resolveRustSignatureParameterListTarget(
  parameters: SourceCallableTypeEvidence["parameters"],
  elements: readonly TargetTypeRef[],
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  const restIndexes = parameters.flatMap((parameter, index) =>
    parameter.parameterKind === "rest" ? [index] : []
  );
  if (restIndexes.length === 0) {
    return rustTupleTargetType(elements);
  }
  if (restIndexes.length !== 1) {
    return undefined;
  }
  const restIndex = restIndexes[0]!;
  const restCarrier = elements[restIndex];
  const restElement = restCarrier?.kind === "array"
    ? restCarrier.element
    : isRustJsArrayCarrier(restCarrier)
      ? rustJsArrayLikeElementTargetType(restCarrier)
      : undefined;
  if (restElement === undefined) {
    return undefined;
  }
  const homogeneous = elements.every((element, index) => {
    const value = index === restIndex
      ? restElement
      : rustOptionElementCarrier(element) ?? element;
    return rustTargetTypeRefEquals(value, restElement);
  });
  if (!homogeneous) {
    return undefined;
  }
  return options.jsEnabled
    ? rustJsArrayTargetType(restElement)
    : rustVecTargetType(restElement);
}

export function resolveRustCallableEvidence(
  callable: SourceCallableTypeEvidence,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const parameters = callable.parameters.map((parameter) =>
      resolveRustSignatureParameterEvidence(
        parameter,
        context,
        options,
        resolving,
        "callable",
    )
  );
  if (parameters.some((parameter) => parameter === undefined)) {
    return undefined;
  }
  const result = resolveRustTypeComponentEvidence(
    callable.result,
    context,
    options,
    resolving,
  );
  if (result === undefined) return undefined;
  const output = rustFutureOutputCarrier(result);
  return output === undefined
    ? rustCallableTargetType(parameters as readonly TargetTypeRef[], result)
    : rustAsyncCallableTargetType(parameters as readonly TargetTypeRef[], output);
}

function resolveRustSignatureParameterEvidence(
  parameter: SourceCallableTypeEvidence["parameters"][number],
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
  use: "callable" | "parameter-list",
): TargetTypeRef | undefined {
  const authoredTypeNode = parameter.declaration === undefined
    ? undefined
    : context.ast.typeNode(parameter.declaration);
  const resolved = resolveRustTypeComponentEvidence(
    {
      selectedType: parameter.type,
      ...(parameter.declaration === undefined
        ? {}
        : {
            declaration: parameter.declaration,
            ...(authoredTypeNode === undefined ? {} : { authoredTypeNode }),
          }),
    },
    context,
    options,
    resolving,
  );
  const optional = use === "parameter-list"
    ? parameter.parameterKind === "optional"
    : parameter.omissionKind === "undefined";
  return resolved === undefined || !optional ||
      rustOptionElementCarrier(resolved) !== undefined
    ? resolved
    : rustOptionTargetType(resolved);
}

export function resolveRustTypeComponentEvidence(
  component: SourceTypeComponentEvidence,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  if (component.authoredTypeNode === undefined) {
    return resolveRustTargetType(
      component.selectedType,
      context,
      options,
      resolving,
    );
  }
  const authoredSourceFile = context.ast.getSourceFile(component.authoredTypeNode);
  const semantics = authoredSourceFile !== undefined &&
      context.source.semantics.includes(authoredSourceFile)
    ? context.semantics(authoredSourceFile)
    : undefined;
  const selected = resolveRustTargetType(
    component.selectedType,
    context,
    options,
    resolving,
  );
  if (semantics === undefined) {
    return selected;
  }
  const authored = resolveRustAuthoredTargetType(
    component.authoredTypeNode,
    context,
    options,
    resolving,
  );
  const selection = semantics.types.authoredSelection(
    component.authoredTypeNode,
    component.selectedType,
  );
  if (selection.kind === "ambiguous") {
    return undefined;
  }
  if (selection.kind === "authored-members") {
    const targets = [
      ...selection.nodes.map((node) =>
        resolveRustAuthoredTargetType(node, context, options, resolving)),
      ...selection.selectedNullishTypes.map((type) =>
        resolveRustExactNullishValueCarrier(type, semantics)),
    ];
    if (targets.some((target) => target === undefined)) {
      return undefined;
    }
    return combineRustSelectedTargets(
      targets as readonly TargetTypeRef[],
      selection.selectedNullishTypes.length,
      options,
    );
  }
  return selected ?? authored;
}

function combineRustSelectedTargets(
  targets: readonly TargetTypeRef[],
  nullishCount: number,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  if (targets.length === 0) {
    return undefined;
  }
  if (targets.length === 1) {
    return targets[0];
  }
  if (nullishCount === 1 && targets.length === 2) {
    return rustOptionTargetType(targets[0]!);
  }
  const first = targets[0]!;
  if (targets.every((target) => rustTargetTypeRefEquals(first, target))) {
    return first;
  }
  return options.resolveProjectUnionCarrier(targets);
}

function resolveRustEvidenceNodesToCommonCarrier(
  nodes: readonly Node[],
  selectedType: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  if (nodes.length === 0) {
    return undefined;
  }
  const carriers = [...new Set(nodes)].map((node) => {
    const semantics = context.semanticsFor(node);
    const selection = semantics.types.authoredSelection(node, selectedType);
    if (selection.kind !== "authored-members") {
      return undefined;
    }
    const selected = selection.nodes.map((member) =>
      resolveRustAuthoredTargetType(member, context, options, resolving)
    );
    if (selected.length !== 1 || selected[0] === undefined ||
      selection.selectedNullishTypes.length !== 0) {
      return undefined;
    }
    return selected[0];
  });
  if (carriers.some((carrier) => carrier === undefined)) {
    return undefined;
  }
  const first = carriers[0]!;
  return carriers.every((carrier) =>
      carrier !== undefined && rustTargetTypeRefEquals(first, carrier)
    )
    ? first
    : undefined;
}

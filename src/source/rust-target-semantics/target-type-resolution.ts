import {
  functionPointerFactKey,
  pointerFactKey,
  providerVirtualDeclarationFactKey,
  sourcePrimitiveFactKey,
} from "@tsonic/tsts";
import {
  tsonicFixedArrayFactKey,
} from "@tsonic/source-core";
import type {
  ExtensionFactSubject,
  Node,
  ProviderDeclarationIdentity,
  SourceFile,
  Symbol,
  Type,
} from "@tsonic/tsts";
import {
  sourcePropertyTypeEvidenceNodes,
  sourceTransformedTypeFactEvidenceNodes,
  sourceTupleElementTypeEvidenceNodes,
  sourceNodesEqual,
  type SourceCallableTypeEvidence,
  type SourceFileSemantics,
  type SourceStandardTypeTransformation,
  type SourceTypeComponentEvidence,
} from "@tsonic/target-api";
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
  rustNullTargetType,
  rustNullishSourceTargetType,
  rustNeverTargetType,
  rustOptionElementCarrier,
  rustOptionTargetType,
  rustSliceMutRefTargetType,
  rustSliceRefTargetType,
  rustSourceTypeCarrier,
  rustSourceTypeCarrierValue,
  rustSourcePrimitiveTargetType,
  rustStructuralObjectTargetType,
  rustStringTargetType,
  rustTupleTargetType,
  rustUnitTargetType,
  rustUndefinedTargetType,
  rustVecTargetType,
  rustFixedArrayTargetType,
  rustTargetTypeParameterNames,
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
import { rustProviderGenericRequirementsAreSatisfied } from "./provider-generic-requirements.js";

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
    : context.semanticsFor(node).getTypeAtLocation(node);
  return resolveRustTargetType(type, context, options, new Set<object>());
}

function resolveRustTargetTypeSyntax(
  node: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
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
  const { ast, checker } = context;
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
      context.semanticsFor(node).getTypeAtLocation(node),
      context,
      options,
      resolving,
    );
  }
  if (kind !== "KindTypeReference") {
    return undefined;
  }
  const selectedType = checker.getTypeFromTypeNode(node);
  const standardTransformation = selectedType === undefined
    ? undefined
    : context.semanticsFor(node).selectStandardTypeTransformation(
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
  const typeArguments = typeArgumentNodes.map((argument) =>
    resolveRustAuthoredTargetType(argument, context, options, resolving));
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
  const referencedDeclaration = context.source.navigation.sourceReferenceFor(node)?.declaration;
  const typeParameter = resolveSourceTypeParameter(
    symbol,
    referencedDeclaration,
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
  const standard = semantics.selectStandardTypeTransformation(
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
  if (semantics.isTuple(selectedType)) {
    const infos = semantics.getTupleElementInfos(selectedType);
    const elements = infos.map((element) =>
      resolveRustEvidenceNodesToCommonCarrier(
        [
          ...sourceTupleElementTypeEvidenceNodes(
            context.ast,
            semantics,
            element,
          ),
          ...sourceTransformedTypeFactEvidenceNodes(
            context.ast,
            semantics,
            authoredRoot,
            element.type,
          ),
        ],
        element.type,
        context,
        options,
        resolving,
      ) ?? resolveRustTargetType(
        element.type,
        context,
        options,
        resolving,
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
  if (transformation.kind === "tuple") {
    const elements = transformation.elements.map((element) =>
      resolveRustSignatureParameterEvidence(
        element,
        context,
        options,
        resolving,
      )
    );
    return elements.some((element) => element === undefined)
      ? undefined
      : rustTupleTargetType(elements as readonly TargetTypeRef[]);
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

function resolveRustCallableEvidence(
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
  return result === undefined
    ? undefined
    : rustCallableTargetType(parameters as readonly TargetTypeRef[], result);
}

function resolveRustSignatureParameterEvidence(
  parameter: SourceCallableTypeEvidence["parameters"][number],
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
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
  return resolved === undefined || parameter.parameterKind !== "optional"
    ? resolved
    : rustOptionTargetType(resolved);
}

function resolveRustTypeComponentEvidence(
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
  const semantics = context.semanticsFor(component.authoredTypeNode);
  const authored = resolveRustAuthoredTargetType(
    component.authoredTypeNode,
    context,
    options,
    resolving,
  );
  const selected = resolveRustTargetType(
    component.selectedType,
    context,
    options,
    resolving,
  );
  const authoredSemanticType = semantics.getTypeFromTypeNode(
    component.authoredTypeNode,
  );
  if (authoredSemanticType === undefined) {
    return selected;
  }
  const selection = semantics.selectAuthoredType(
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
  const relationship = semantics.getTypeRelationship(
    authoredSemanticType,
    component.selectedType,
  );
  if (authored === undefined || selected === undefined) {
    return authored ?? selected;
  }
  if (rustTargetTypeRefEquals(authored, selected) ||
    relationship === "identical") {
    return authored;
  }
  return relationship === "same-declaration" &&
      rustTargetTypeParameterNames(authored).length === 0
    ? authored
    : selected;
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
    const selection = semantics.selectAuthoredType(node, selectedType);
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

function resolveRustAuthoredTargetType(
  node: Node,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  return resolveRustTargetTypeSyntax(node, context, options, resolving) ??
    resolveRustTargetType(
      context.semanticsFor(node).getTypeAtLocation(node),
      context,
      options,
      resolving,
    );
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
        const target = resolveRustAuthoredTargetType(typeNode, context, options, new Set<object>());
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
  authoredTypeRoot?: Node,
): TargetTypeRef | undefined {
  if (type === undefined || resolving.has(type)) {
    return undefined;
  }
  const existingStructuralObject = authoredTypeRoot === undefined
    ? options.sourceTypes.structuralObjectForType(type)
    : undefined;
  if (existingStructuralObject !== undefined) {
    return existingStructuralObject.carrier;
  }
  const primitive = resolveSourcePrimitive(type, context);
  if (primitive !== undefined) {
    return primitive;
  }
  const substitutionBase = context.typeShape.getSubstitutionBaseType(type);
  if (substitutionBase !== undefined) {
    return resolveRustTargetType(
      substitutionBase,
      context,
      options,
      resolving,
      authoredTypeRoot,
    );
  }
  resolving.add(type);
  try {
    const { checker, typeShape } = context;
    if (typeShape.isNever(type)) {
      return rustNeverTargetType();
    }
    if (typeShape.isAny(type) || typeShape.isUnknown(type)) {
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

    const typeParameter = resolveSourceTypeParameter(symbol, undefined, context);
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
      const elements = typeShape.getTupleElementInfos(type)
        .map((element) =>
          (authoredTypeRoot === undefined
            ? undefined
            : resolveRustEvidenceNodesToCommonCarrier(
                [
                  ...sourceTupleElementTypeEvidenceNodes(
                    context.ast,
                    typeShape,
                    element,
                  ),
                  ...sourceTransformedTypeFactEvidenceNodes(
                    context.ast,
                    typeShape,
                    authoredTypeRoot,
                    element.type,
                  ),
                ],
                element.type,
                context,
                options,
                resolving,
              )) ?? resolveRustTargetType(
                element.type,
                context,
                options,
                resolving,
              )
        );
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
    return resolveStructuralObjectType(
      type,
      context,
      options,
      resolving,
      authoredTypeRoot,
    );
  } finally {
    resolving.delete(type);
  }
}

export function resolveRustExactNullishValueCarrier(
  type: Type,
  queries: SourceFileSemantics,
): TargetTypeRef | undefined {
  if (!queries.isNullish(type)) {
    return undefined;
  }
  return queries.isNever(queries.removeMissingOrUndefined(type))
    ? rustUndefinedTargetType()
    : rustNullTargetType();
}

function resolveStructuralObjectType(
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
  authoredTypeRoot?: Node,
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
    const declarations = denseDefined([...new Set([
      ...checker.getSymbolDeclarations(property.symbol),
      ...property.rootSymbols.flatMap((symbol) =>
        checker.getSymbolDeclarations(symbol)
      ),
    ])]);
    const projectDeclarations = declarations?.filter((declaration) =>
      context.source.navigation.isProjectDeclaration(declaration) &&
      isRustStructuralObjectFieldDeclaration(declaration, context.ast));
    const getters = projectDeclarations?.filter((declaration) =>
      context.ast.kindName(declaration) === "KindGetAccessor") ?? [];
    const setters = projectDeclarations?.filter((declaration) =>
      context.ast.kindName(declaration) === "KindSetAccessor") ?? [];
    const methods = projectDeclarations?.filter((declaration) => {
      const kind = context.ast.kindName(declaration);
      return kind === "KindMethodDeclaration" || kind === "KindMethodSignature";
    }) ?? [];
    const ordinaryDeclarations = projectDeclarations?.filter((declaration) => {
      const kind = context.ast.kindName(declaration);
      return kind !== "KindGetAccessor" && kind !== "KindSetAccessor" &&
        kind !== "KindMethodDeclaration" && kind !== "KindMethodSignature";
    }) ?? [];
    const authoredTypeNodes = [
      ...sourcePropertyTypeEvidenceNodes(context.ast, typeShape, property),
      ...(authoredTypeRoot === undefined
        ? []
        : sourceTransformedTypeFactEvidenceNodes(
            context.ast,
            typeShape,
            authoredTypeRoot,
            property.type,
          )),
    ];
    const authoredCarriers = authoredTypeNodes.map((node) =>
      resolveRustAuthoredTargetType(node, context, options, resolving));
    const authoredCarrier = authoredCarriers.length > 0 &&
        authoredCarriers.every((carrier) =>
          carrier !== undefined && rustTargetTypeRefEquals(carrier, authoredCarriers[0]))
      ? authoredCarriers[0]
      : undefined;
    const selectedFieldCarrier = authoredTypeNodes.length === 0
      ? resolveRustTargetType(property.type, context, options, resolving)
      : authoredCarrier;
    const fieldCarrier = selectedFieldCarrier === undefined
      ? undefined
      : property.optional && rustOptionElementCarrier(selectedFieldCarrier) === undefined
        ? rustOptionTargetType(selectedFieldCarrier)
        : selectedFieldCarrier;
    const accessor = getters.length === 1 && setters.length <= 1 &&
        ordinaryDeclarations.length === 0 && methods.length === 0
      ? { getter: true as const, setter: setters.length === 1 }
      : undefined;
    const method = methods.length === 1 && getters.length === 0 &&
        setters.length === 0 && ordinaryDeclarations.length === 0
      ? true as const
      : undefined;
    const hasExactTransformedIdentity = authoredTypeRoot !== undefined &&
      projectDeclarations !== undefined && projectDeclarations.length === 0;
    return projectDeclarations === undefined ||
        (!hasExactTransformedIdentity && projectDeclarations.length === 0) ||
        (!hasExactTransformedIdentity && projectDeclarations.length !== declarations?.length) ||
        fieldCarrier === undefined
        || getters.length > 1 || setters.length > 1 ||
        getters.length === 0 && setters.length > 0 ||
        getters.length > 0 && (ordinaryDeclarations.length > 0 || methods.length > 0) ||
        methods.length > 1 || methods.length > 0 && ordinaryDeclarations.length > 0
      ? undefined
      : {
          declarations: Object.freeze(projectDeclarations),
          symbols: Object.freeze([...new Set([
            property.symbol,
            ...property.rootSymbols,
          ])]),
          sourceName: property.name,
          sourceType: property.type,
          resultCarrier: fieldCarrier,
          presence: property.optional ? "optional" as const : "required" as const,
          readonly: property.readonly,
          ...(accessor === undefined ? {} : { accessor }),
          ...(method === undefined ? {} : { method }),
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
    readonly presence: "required" | "optional";
    readonly readonly: boolean;
    readonly accessor?: {
      readonly getter: true;
      readonly setter: boolean;
    };
    readonly method?: true;
  }[])]
    .sort((left, right) => left.sourceName.localeCompare(right.sourceName))
    .map((field, storageIndex) => ({ ...field, storageIndex }));
  if (new Set(fields.map((field) => field.sourceName)).size !== fields.length) {
    return undefined;
  }
  const carrier = rustStructuralObjectTargetType(fields.map((field) => ({
    sourceName: field.sourceName,
    type: field.resultCarrier,
    presence: field.presence,
    readonly: field.readonly,
    ...(field.accessor === undefined ? {} : { accessor: field.accessor }),
    ...(field.method === true ? { method: true as const } : {}),
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
  const returnType = context.checker.getReturnTypeOfSignature(signature);
  if (returnType === undefined) {
    return undefined;
  }
  const authoredReturn = declaration === undefined
    ? undefined
    : context.ast.typeNode(declaration);
  return resolveRustCallableEvidence(
    {
      parameters: context.typeShape.getSignatureParameterInfos(signature),
      result: {
        selectedType: returnType,
        ...(declaration === undefined
          ? {}
          : {
              declaration,
              ...(authoredReturn === undefined
                ? {}
                : { authoredTypeNode: authoredReturn }),
            }),
      },
    },
    context,
    options,
    resolving,
  );
}

function resolveSourceTypeParameter(
  symbol: Symbol | undefined,
  referencedDeclaration: Node | undefined,
  context: RustTargetTypeResolutionContext,
): TargetTypeRef | undefined {
  const symbolDeclaration = symbol === undefined
    ? undefined
    : context.checker.getPrimarySymbolDeclaration(symbol);
  if (referencedDeclaration !== undefined && symbolDeclaration !== undefined &&
    !sourceNodesEqual(context.ast, referencedDeclaration, symbolDeclaration)) {
    return undefined;
  }
  const declaration = referencedDeclaration ?? symbolDeclaration;
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
  const valueCarriers = valueMembers.map((member) =>
    resolveRustTargetType(member, context, options, resolving));
  if (valueCarriers.some((carrier) => carrier === undefined)) {
    return undefined;
  }
  const distinctValueCarriers = (valueCarriers as readonly TargetTypeRef[]).filter(
    (carrier, index, all) => all.findIndex((candidate) =>
      rustTargetTypeRefEquals(candidate, carrier)) === index,
  );
  if (distinctValueCarriers.length === 1) {
    if (nullishMembers.length === 0) {
      return distinctValueCarriers[0];
    }
    return nullishMembers.length === 1
      ? rustOptionTargetType(distinctValueCarriers[0]!)
      : undefined;
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
  if (!rustProviderGenericRequirementsAreSatisfied(relation.typeRequirements, substitutions)) {
    return undefined;
  }
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
    if (carrier !== undefined && typeArguments.length === 0) {
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

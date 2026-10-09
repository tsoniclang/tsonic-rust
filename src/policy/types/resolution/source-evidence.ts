import { resolveRustSourceUnionCarrier } from "./source-unions.js";
import {
  isRustJsArrayCarrier,
  rustCallableTargetType,
  rustCallableProtocol,
  rustJsArrayLikeElementTargetType,
  rustJsArrayTargetType,
  rustOptionElementCarrier,
  rustSourceOptionalTargetType,
  rustSourceUnionCarrierValue,
  rustTupleTargetType,
  rustVecTargetType,
} from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { resolveRustAuthoredTargetType, rustParameterLaneTargetType } from "./tuples.js";
import {
  resolveRustExactNullishValueCarrier,
  resolveRustTargetType,
} from "./target.js";
import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceCallableTypeEvidence,
  SourceTypeComponentEvidence,
} from "@tsonic/target-api/source";
import type {
  RustTargetTypeResolutionContext,
  RustTargetTypeResolutionOptions,
} from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { selectRustPointerReturnCarrier } from "../../operations/pointers/return.js";
import { rustTargetGenericReferences } from "../../../target-model/types/carriers/generic-references.js";
import { inferRustTargetTypeParameterBindings } from "../../../target-model/types/carriers/generic-inference.js";
import { mapRustTargetTypes } from "../../../target-model/types/carriers/substitution.js";
import { resolveBoundSourceTypeParameter } from "./callables.js";
import { rustTypeFamilyNormalizer } from "../type-family-normalization.js";
import { rustGenericCallableTargetType, rustNativeFutureCallableResult } from "../../../target-model/types/carriers/generic-callables.js";
import { rustTypeParameterFromSourceContract } from "../../../target-model/names/type-parameters.js";
import { rustCallableOrigin } from "../callable-origins.js";
import { closeRustSuspendedStorage } from "../suspended-storage.js";
import { rustSourceSelectionUsesExactBindings } from "./bound-source-selection.js";
import { bindRustCallableEnvironment, resolveRustCallableEnvironment } from "./callable-environments.js";
import { retainRustCallableStructuralStorage } from "./structural-instantiations.js";
import { resolveRustCallableInputCarrier } from "./callable-inputs.js";

export function resolveRustSignatureParameterListTarget(
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
  const carrier = resolveRustCallableSignatureCarrier(callable, context, options, resolving);
  return resolveRustCallableStorageCarrier(carrier, context, options, resolving);
}

export function resolveRustCallableStorageCarrier(
  carrier: TargetTypeRef | undefined,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  if (context.callableRepresentation === "signature") return carrier;
  const subject = context.sourceStorageSubject;
  const parameterNode = subject?.kind === "value" && subject.projection.length === 0 ? subject.node : undefined;
  const parameter = parameterNode === undefined ? undefined : context.ast.as.AsParameterDeclaration(parameterNode);
  const uses = parameterNode === undefined || parameter === undefined ? undefined :
    context.source.navigation.parameterUseSummary(parameterNode);
  const owner = parameterNode === undefined || parameter === undefined ? undefined : context.ast.parent(parameterNode);
  const nativeDeclaration = owner !== undefined && context.ast.is.IsFunctionDeclaration(owner) &&
    context.source.navigation.declarationUseSummary(owner).uses.every(use => use.kind !== "first-class");
  const protocol = rustCallableProtocol(carrier);
  if (nativeDeclaration && parameter !== undefined && protocol !== undefined && parameter.DotDotDotToken === undefined &&
    parameter.Initializer === undefined && parameter.QuestionToken === undefined &&
    uses !== undefined && uses.uses.length > 0 &&
    uses.uses.every(use => use.kind === "direct-call" && !use.captured && !use.throughMember)) {
    const semantics = context.semanticsFor(parameterNode!);
    const declared = semantics.declarations.declaredValueType(parameterNode!);
    const declaredCarrier = declared === undefined ? undefined : resolveRustTargetType(declared,
      { ...context, currentSemantics: semantics, sourceStorageSubject: undefined,
        callableRepresentation: "signature" }, options, new Set());
    if (rustTargetTypeRefEquals(rustOptionElementCarrier(declaredCarrier) ?? declaredCarrier, carrier)) {
      return resolveRustCallableInputCarrier(subject!, carrier!, context, options);
    }
  }
  return carrier === undefined || subject === undefined ? carrier : options.callableStorageCarrier(subject, carrier,
    (owner, excludedCaptures) => resolveRustCallableEnvironment(owner, context, options, resolving, excludedCaptures),
    owner => {
      const semantics = context.semanticsFor(owner);
      const type = semantics.declarations.declaredType(owner);
      return type === undefined ? undefined : resolveRustTargetType(type,
        { ...context, currentSemantics: semantics, sourceStorageSubject: undefined }, options, resolving);
    });
}

function resolveRustCallableSignatureCarrier(
  callable: SourceCallableTypeEvidence,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const declaration = callable.result.declaration;
  const genericContract = context.sourceLifetimes.contractFor(declaration);
  const parameters = callable.parameters.map(parameter => {
    const selected = resolveRustSignatureParameterEvidence(parameter, context, options, resolving);
    return selected === undefined ? undefined : closeRustSuspendedStorage(selected, [], genericContract, "field");
  });
  if (parameters.some((parameter) => parameter === undefined)) {
    return undefined;
  }
  const returned = declaration === undefined ? undefined : context.sourceStorage.subject(declaration, "return");
  const sourceResult = resolveRustTypeComponentEvidence(
    callable.result,
    { ...context, sourceStorageSubject: returned?.kind === "resolved" ? returned.subject : undefined },
    options,
    resolving,
  );
  const result = sourceResult === undefined ? undefined
    : closeRustSuspendedStorage(sourceResult, parameters, genericContract, "callable-result");
  if (result === undefined) return undefined;
  if (genericContract !== undefined && genericContract.parameters.length > 0 &&
    genericContract.parameters.every(parameter => parameter.kind === "type")) {
    const origin = rustCallableOrigin(context.ast, declaration);
    const environment = resolveRustCallableEnvironment(declaration, context, options, resolving);
    const carrier = origin === undefined || environment === undefined ? undefined : bindRustCallableEnvironment(rustGenericCallableTargetType(
      genericContract.parameters.map(rustTypeParameterFromSourceContract), parameters as readonly TargetTypeRef[], result, origin, environment), context);
    return carrier !== undefined && retainRustCallableStructuralStorage(callable,
      parameters as readonly TargetTypeRef[], result, carrier, context, options, resolving) ? carrier : undefined;
  }
  if (genericContract?.lifetimeBinder !== undefined) {
    return genericContract.parameters.some((parameter) => parameter.kind !== "lifetime")
      ? undefined
      : Object.freeze({
          kind: "closure" as const,
          args: Object.freeze(parameters as readonly TargetTypeRef[]),
          result,
          lifetimeBinder: genericContract.lifetimeBinder,
        });
  }
  if (rustNativeFutureCallableResult(result) !== undefined) {
    const origin = rustCallableOrigin(context.ast, declaration);
    const environment = resolveRustCallableEnvironment(declaration, context, options, resolving);
    return origin === undefined || environment === undefined ? undefined : bindRustCallableEnvironment(rustGenericCallableTargetType(
      [], parameters as readonly TargetTypeRef[], result, origin, environment), context);
  }
  if (!options.jsEnabled && parameters.some(parameter => parameter?.kind === "array") &&
    declaration !== undefined && context.ast.kindName(declaration) === "KindFunctionType") {
    const owner = context.ast.parent(declaration);
    const uses = owner === undefined ? undefined : context.source.navigation.parameterUseSummary(owner);
    if (owner !== undefined && context.ast.is.IsParameterDeclaration(owner) && uses !== undefined &&
      uses.uses.length > 0 && uses.uses.every(use => use.kind === "direct-call" && !use.captured && !use.throughMember)) {
      const borrowed = parameters.map((parameter, index) => {
        const sourceParameter = callable.parameters[index]?.declaration;
        const syntax = sourceParameter === undefined ? undefined : context.ast.typeNode(sourceParameter);
        return parameter?.kind !== "array" ? parameter : syntax === undefined ? undefined
          : rustParameterLaneTargetType(parameter, syntax, context, options);
      });
      if (borrowed.every(parameter => parameter !== undefined)) {
        return { kind: "closure", args: borrowed as readonly TargetTypeRef[], result, fallible: true };
      }
    }
  }
  return rustCallableTargetType(parameters as readonly TargetTypeRef[], result);
}

export function resolveRustSignatureParameterEvidence(
  parameter: SourceCallableTypeEvidence["parameters"][number],
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const authoredTypeNode = parameter.declaration === undefined
    ? undefined
    : context.ast.typeNode(parameter.declaration);
  const selection = parameter.declaration === undefined ? undefined
    : context.sourceStorage.subject(parameter.declaration, "value");
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
    { ...context, sourceStorageSubject: selection?.kind === "resolved" ? selection.subject : undefined },
    options,
    resolving,
  );
  const optional = parameter.omissionKind === "undefined" || parameter.omissionKind === "initializer";
  return resolved === undefined || !optional ||
      rustOptionElementCarrier(resolved) !== undefined
    ? resolved
    : rustSourceOptionalTargetType(resolved);
}

export function resolveRustTypeComponentEvidence(
  component: SourceTypeComponentEvidence,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  if (component.authoredTypeNode === undefined) {
    const pointerReturn = component.declaration === undefined ? undefined
      : selectRustPointerReturnCarrier(component.declaration, context, options);
    if (pointerReturn !== undefined) return pointerReturn;
    const selected = resolveRustTargetType(
      component.selectedType,
      context,
      options,
      resolving,
    );
    return selected;
  }
  if (context.ast.kindName(component.authoredTypeNode) === "KindThisType") {
    return resolveRustTargetType(component.selectedType, context, options, resolving);
  }
  const authoredSourceFile = context.ast.getSourceFile(component.authoredTypeNode);
  const semantics = authoredSourceFile !== undefined &&
      context.source.semantics.includes(authoredSourceFile)
    ? context.semantics(authoredSourceFile)
    : undefined;
  const authoredSource = semantics?.types.authoredType(component.authoredTypeNode);
  if (authoredSource !== undefined && rustSourceSelectionUsesExactBindings(
    authoredSource, component.selectedType, context,
  )) {
    return resolveRustAuthoredTargetType(component.authoredTypeNode, context, options, resolving);
  }
  const selected = resolveRustTargetType(
    component.selectedType,
    context,
    options,
    resolving,
    component.authoredTypeNode,
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
  const selection = context.currentSemantics.types.authoredSelection(
    component.authoredTypeNode,
    component.selectedType,
  );
  if (selection.kind === "ambiguous") {
    return undefined;
  }
  const selectedParameter = resolveBoundSourceTypeParameter(component.authoredTypeNode, context);
  if (selectedParameter !== undefined) {
    return rustTargetTypeRefEquals(authored, selectedParameter) ? selectedParameter : undefined;
  }
  if (authored !== undefined && selected !== undefined) {
    const normalize = rustTypeFamilyNormalizer(options.sourceTypes.typeFamilies);
    const normalizedAuthored = mapRustTargetTypes(authored, normalize);
    const normalizedSelected = mapRustTargetTypes(selected, normalize);
    if (rustTargetTypeRefEquals(normalizedAuthored, normalizedSelected)) return authored;
    const references = rustTargetGenericReferences(normalizedAuthored);
    if (references.typeIdentities.length > 0) {
      const substitutions = inferRustTargetTypeParameterBindings(
        normalizedAuthored,
        normalizedSelected,
        new Set(references.typeIdentities),
      );
      return substitutions === undefined
        ? undefined
        : selected;
    }
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
      options,
      selected,
    );
  }
  return selected ?? authored;
}

function combineRustSelectedTargets(
  targets: readonly TargetTypeRef[],
  options: RustTargetTypeResolutionOptions,
  selected?: TargetTypeRef,
): TargetTypeRef | undefined {
  return resolveRustSourceUnionCarrier(targets, values => {
    const union = rustSourceUnionCarrierValue(selected);
    const variants = selected === undefined ? undefined : options.sourceTypes.sourceUnionVariants(selected);
    return union?.origin === "generated" && variants?.length === values.length &&
      values.every(target => variants.filter(variant => rustTargetTypeRefEquals(variant.carrier, target)).length === 1)
      ? selected : options.resolveProjectUnionCarrier(values);
  });
}

export function resolveRustEvidenceNodesToCommonCarrier(
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
    const semantics = context.currentSemantics;
    const selection = semantics.types.authoredSelection(node, selectedType);
    const evidence = new Set([node, ...(selection.kind === "authored-members" ? selection.nodes : []),
      ...semantics.facts.authoredTypeNodes(node)]);
    for (const member of evidence) {
      const nested = semantics.types.authoredSelection(member, selectedType);
      if (nested.kind === "authored-members") nested.nodes.forEach(selected => evidence.add(selected));
    }
    const selected = [...evidence].flatMap(member => {
      const selection = semantics.types.authoredSelection(member, selectedType);
      const authoredType = semantics.types.authoredType(member);
      if (selection.kind === "authored-members" && selection.nodes.length === 1 &&
        selection.nodes[0] === member && selection.selectedNullishTypes.length === 0 &&
        authoredType !== undefined && semantics.types.isIdentical(authoredType, selectedType)) {
        return [resolveRustAuthoredTargetType(member, context, options, resolving)];
      }
      if (authoredType === undefined) return [];
      const refinement = semantics.types.refinement(authoredType, selectedType);
      if (refinement.kind !== "members" && refinement.kind !== "exact") return [];
      const selectedCarrier = resolveRustTargetType(selectedType, context, options, resolving);
      if (selectedCarrier === undefined) return [];
      const carrier = resolveRustAuthoredTargetType(member, context, options, resolving);
      return carrier !== undefined && rustTargetTypeRefEquals(carrier, selectedCarrier) ? [carrier] : [];
    });
    if (selected.length === 0 || selected[0] === undefined || selected.some(carrier =>
      carrier === undefined || !rustTargetTypeRefEquals(carrier, selected[0]))) {
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

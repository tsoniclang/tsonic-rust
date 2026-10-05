import type { Node, TypeSignatureInfo, Type } from "@tsonic/tsts";
import { ArrayTypeNode_ElementType } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import { rustStructuralObjectCarrierValue } from "../../../target-model/types/carriers/source-types.js";
import { rustJsArrayLikeElementTargetType, isRustJsArrayCarrier } from "../../../target-model/types/carriers/js.js";
import { resolveRustConstructType } from "./constructors.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { resolveRustTypeComponentEvidence } from "./source-evidence.js";
import { rustTypeFamilyNormalizer } from "../type-family-normalization.js";
import { mapRustTargetTypes } from "../../../target-model/types/carriers/substitution.js";
import { bindRustCallableTypeParameters, bindRustSourceAliasArguments } from "./generic-arguments.js";
import { rustCallableProtocol } from "../../../target-model/types/carriers/callables.js";
import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import type { SourceCallableTypeEvidence } from "@tsonic/target-api/source";
import { isRustErasedNominalMember } from "../source-shapes.js";
import { rustSourcePropertyTargetType } from "../../../target-model/types/projections.js";

export function retainRustStructuralInstantiation(
  sourceType: Type,
  templateCarrier: TargetTypeRef,
  carrier: TargetTypeRef,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object> = new Set(),
  authoredTypeNode?: Node,
): boolean {
  if (!containsStructuralStorage(templateCarrier)) return true;
  if (rustGenericCallableProtocol(templateCarrier) !== undefined || rustCallableProtocol(templateCarrier) !== undefined) {
    const signatures = context.currentSemantics.types.signatureInfos(sourceType, "call");
    return signatures.length === 1 && retainSignature(signatures[0]!, templateCarrier, carrier, context, options, resolving);
  }
  const templateElement = templateCarrier.kind === "array" ? templateCarrier.element :
    isRustJsArrayCarrier(templateCarrier) ? rustJsArrayLikeElementTargetType(templateCarrier) : undefined;
  const element = carrier.kind === "array" ? carrier.element :
    isRustJsArrayCarrier(carrier) ? rustJsArrayLikeElementTargetType(carrier) : undefined;
  if (templateElement !== undefined || element !== undefined) {
    if (templateElement === undefined || element === undefined ||
      !context.currentSemantics.types.isArrayLike(sourceType) ||
      !context.currentSemantics.types.isTypeReference(sourceType)) return false;
    const arguments_ = context.currentSemantics.types.typeArguments(sourceType);
    const elementNode = authoredTypeNode === undefined ? undefined :
      context.ast.kindName(authoredTypeNode) === "KindArrayType" ? ArrayTypeNode_ElementType(context.ast, authoredTypeNode)
      : context.ast.is.IsTypeReferenceNode(authoredTypeNode) ? context.ast.typeArguments(authoredTypeNode)[0] : undefined;
    return arguments_.length === 1 && arguments_[0] !== undefined &&
      retainRustStructuralInstantiation(arguments_[0], templateElement, element, context, options, resolving, elementNode);
  }
  const structural = rustStructuralObjectCarrierValue(carrier);
  if (structural === undefined || rustStructuralObjectCarrierValue(templateCarrier) === undefined) return false;
  if (rustTargetTypeRefEquals(templateCarrier, carrier) &&
    options.sourceTypes.structuralObjectForType(sourceType, carrier) !== undefined) return true;
  const template = options.sourceTypes.structuralObjectForCarrier(templateCarrier);
  if (template === undefined) return false;
  const selectedContext = bindRustSourceAliasArguments(sourceType, context, options, resolving, authoredTypeNode);
  if (selectedContext === undefined) return false;
  context = selectedContext;
  const correspondence = context.currentSemantics.types.structuralMembers(sourceType, template.sourceType);
  if (correspondence.kind !== "available" ||
    correspondence.members.filter(member => !isRustErasedNominalMember(member.destination.declarations, context.ast)).length !== template.fields.length ||
    structural.fields.length !== template.fields.length ||
    correspondence.source.calls.length !== 0 || correspondence.source.constructs.length !== (template.construction === undefined ? 0 : 1) ||
    correspondence.source.indexes.length !== 0) return false;
  const construction = template.construction === undefined ? undefined : resolveRustConstructType(sourceType, context, options, resolving);
  if (template.construction !== undefined && (construction === undefined ||
    !rustTargetTypeRefEquals(construction.carrier, structural.construction))) return false;
  if (template.construction !== undefined && construction !== undefined &&
    !retainSignature(construction.signatureInfo, template.construction.carrier, construction.carrier, context, options, resolving)) return false;
  const fields = template.fields.map(field => {
    const matches = correspondence.members.filter(pair => field.symbols.includes(pair.destination.property.symbol));
    if (matches.length !== 1) return undefined;
    const selected = matches[0]!;
    const targetField = structural.fields[field.storageIndex];
    if (selected.kind !== "present" || targetField === undefined ||
      targetField.sourceName !== field.sourceName || targetField.presence !== field.presence ||
      targetField.readonly !== field.readonly ||
      selected.source.property.optional !== selected.destination.property.optional ||
      selected.source.property.readonly !== selected.destination.property.readonly ||
      selected.source.read !== selected.destination.read ||
      selected.destination.declarations.length !== field.declarations.length ||
      selected.destination.declarations.some(declaration => !field.declarations.includes(declaration))) return undefined;
    const authoredNodes = [...new Set(field.declarations.flatMap(declaration => {
      if (context.ast.is.IsMethodDeclaration(declaration) || context.ast.kindName(declaration) === "KindMethodSignature") return [];
      const type = context.ast.typeNode(declaration);
      return type === undefined ? [] : [type];
    }))];
    const declared = authoredNodes.map(authoredTypeNode => resolveRustTypeComponentEvidence({
      authoredTypeNode, selectedType: selected.source.property.type,
    }, context, options, resolving));
    const normalize = rustTypeFamilyNormalizer(options.sourceTypes.typeFamilies);
    const expected = mapRustTargetTypes(targetField.type, normalize);
    if (declared.some(carrier => carrier === undefined ||
      !rustTargetTypeRefEquals(mapRustTargetTypes(rustSourcePropertyTargetType(carrier, selected.source.property.optional), normalize), expected))) return undefined;
    if (!retainRustStructuralInstantiation(selected.source.property.type, field.resultCarrier,
      targetField.type, context, options, resolving, authoredNodes[0])) return undefined;
    return {
      ...field,
      declarations: selected.source.declarations,
      symbols: [...new Set([selected.source.property.symbol, ...selected.source.property.rootSymbols])],
      sourceType: selected.source.property.type,
      resultCarrier: targetField.type,
    };
  });
  if (fields.some(field => field === undefined)) return false;
  return options.sourceTypes.registerStructuralObject({ ...template, sourceType, carrier,
    ...(construction === undefined ? {} : { construction }),
    fields: fields as NonNullable<(typeof fields)[number]>[] }, templateCarrier);
}

function containsStructuralStorage(carrier: TargetTypeRef): boolean {
  let current = carrier;
  for (;;) {
    if (rustStructuralObjectCarrierValue(current) !== undefined) return true;
    const callable = rustGenericCallableProtocol(current) ?? rustCallableProtocol(current);
    if (callable !== undefined) return [callable.result, ...callable.parameters].some(containsStructuralStorage);
    const element = current.kind === "array" ? current.element :
      isRustJsArrayCarrier(current) ? rustJsArrayLikeElementTargetType(current) : undefined;
    if (element === undefined) return false;
    current = element;
  }
}

function retainSignature(
  signature: TypeSignatureInfo, templateCarrier: TargetTypeRef, carrier: TargetTypeRef,
  context: RustTargetTypeResolutionContext, options: RustTargetTypeResolutionOptions, resolving: Set<object>,
): boolean {
  const template = rustGenericCallableProtocol(templateCarrier) ?? rustCallableProtocol(templateCarrier);
  const selected = rustGenericCallableProtocol(carrier) ?? rustCallableProtocol(carrier);
  const result = signature.returnType;
  const parameters = signature.parameters;
  const generic = rustGenericCallableValue(carrier);
  if (generic !== undefined) {
    const declaration = context.currentSemantics.declarations.signatureDeclaration(signature.signature);
    const selectedContext = declaration === undefined ? undefined :
      bindRustCallableTypeParameters(declaration, generic.signature.typeParameters, context);
    if (selectedContext === undefined) return false;
    context = selectedContext;
  }
  if (template === undefined || selected === undefined || result === undefined ||
    template.parameters.length !== selected.parameters.length || parameters.length !== selected.parameters.length ||
    !retainRustStructuralInstantiation(result, template.result, selected.result, context, options, resolving)) return false;
  return parameters.every((parameter, index) => retainRustStructuralInstantiation(
    parameter.type, template.parameters[index]!, selected.parameters[index]!, context, options, resolving));
}

export function retainRustCallableStructuralStorage(
  callable: SourceCallableTypeEvidence,
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
  carrier: TargetTypeRef,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): boolean {
  if (![result, ...parameters].some(containsStructuralStorage)) return true;
  const generic = rustGenericCallableValue(carrier);
  const protocol = rustGenericCallableProtocol(carrier);
  const declaration = callable.result.declaration;
  const selectedContext = generic === undefined || declaration === undefined ? undefined :
    bindRustCallableTypeParameters(declaration, generic.signature.typeParameters, context);
  if (protocol === undefined || selectedContext === undefined ||
    protocol.parameters.length !== parameters.length || callable.parameters.length !== parameters.length) return false;
  return retainRustStructuralInstantiation(callable.result.selectedType, result, protocol.result,
    selectedContext, options, resolving, callable.result.authoredTypeNode) &&
    callable.parameters.every((parameter, index) => retainRustStructuralInstantiation(parameter.type,
      parameters[index]!, protocol.parameters[index]!, selectedContext, options, resolving,
      parameter.declaration === undefined ? undefined : context.ast.typeNode(parameter.declaration)));
}

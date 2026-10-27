import type { Node, TypeSignatureInfo, Type } from "@tsonic/tsts";
import { closeRustRetainedCallableCarrier } from "../../../../policy/ownership/retained-storage.js";
import { ArrayTypeNode_ElementType } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustLifetimeRef } from "../../../../target-model/lifetimes/index.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import { rustStructuralObjectCarrierValue, rustSourceUnionCarrierValue } from "../../../../target-model/types/carriers/source-types.js";
import { rustOptionElementCarrier } from "../../../../target-model/types/index.js";
import { rustJsArrayLikeElementTargetType, isRustJsArrayCarrier } from "../../../../target-model/types/carriers/js.js";
import { resolveRustConstructType } from "./constructors.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustCarrierWithTargetPlaceholderLifetimes } from "../../../../target-model/types/placeholder-lifetimes.js";
import { resolveRustTypeComponentEvidence } from "./source-evidence.js";
import { rustTypeFamilyNormalizer } from "../../../project-types/type-family-normalization.js";
import { mapRustTargetTypes } from "../../../../target-model/types/carriers/substitution.js";
import { bindRustCallableTypeParameters, bindRustSourceAliasArguments } from "./generic-arguments.js";
import { rustCallableProtocol } from "../../../../target-model/types/carriers/callables.js";
import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../../../target-model/types/carriers/generic-callables.js";
import type { SourceCallableTypeEvidence } from "@tsonic/target-api/source";
import { isRustErasedNominalMember } from "../../../../policy/types/objects/source-shapes.js";
import { rustSourcePropertyTargetType } from "../../../../target-model/types/projections.js";
import { retainRustSourceUnionInstantiation, rustSourceUnionValueTypes } from "./source-unions.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import type { SourceStorageProjection } from "@tsonic/target-api/analysis";
import { rustSourceStorageComponentContext } from "./source-storage-projection.js";

export function retainRustStructuralInstantiation(
  sourceType: Type,
  templateCarrier: TargetTypeRef,
  carrier: TargetTypeRef,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object> = new Set(),
  authoredTypeNode?: Node,
): boolean {
  const structuralStorage = containsStructuralStorage(templateCarrier, options);
  if (structuralStorage !== true) return structuralStorage === false;
  const templateOptional = rustOptionElementCarrier(templateCarrier);
  const optional = rustOptionElementCarrier(carrier);
  if (templateOptional !== undefined || optional !== undefined) {
    if (templateOptional === undefined || optional === undefined) return false;
    const semantics = context.currentSemantics;
    const present = semantics.types.nonNullableType(sourceType);
    if (present === undefined) return false;
    const values = rustSourceUnionValueTypes(semantics.types.isUnion(present)
      ? semantics.types.unionOrIntersectionTypes(present) : [present], semantics);
    const sourceValue = values.length === 1 ? values[0] : values.length > 1 ? present : undefined;
    return sourceValue !== undefined && retainRustStructuralInstantiation(sourceValue,
      templateOptional, optional, context, options, resolving, authoredTypeNode);
  }
  if (rustSourceUnionCarrierValue(templateCarrier) !== undefined) {
    const application = context.currentSemantics.types.aliasApplication(sourceType);
    const declaration = application?.declaration;
    const declarationCarrier = declaration === undefined ? templateCarrier :
      options.sourceTypes.carrierForDeclaration(declaration);
    const template = declarationCarrier === undefined ? undefined : options.sourceTypes.sourceUnionForCarrier(
      rustOptionElementCarrier(declarationCarrier) ?? declarationCarrier);
    return template !== undefined &&
      retainRustSourceUnionInstantiation(sourceType, template, carrier, context, options, declaration) !== undefined;
  }
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
    const elementContext = structuralComponentContext(context, { kind: "array-element" });
    return arguments_.length === 1 && arguments_[0] !== undefined && elementContext !== undefined &&
      retainRustStructuralInstantiation(arguments_[0], templateElement, element, elementContext, options, resolving, elementNode);
  }
  // A tuple retains each element's instantiation; an element without structural storage is identical in both carriers.
  if (templateCarrier.kind === "tuple" || carrier.kind === "tuple") {
    if (templateCarrier.kind !== "tuple" || carrier.kind !== "tuple" ||
      templateCarrier.elements.length !== carrier.elements.length || !context.currentSemantics.types.isTuple(sourceType)) return false;
    const infos = context.currentSemantics.types.tupleElementInfos(sourceType);
    if (infos.length !== carrier.elements.length) return false;
    const elementNodes = authoredTypeNode !== undefined && context.ast.kindName(authoredTypeNode) === "KindTupleType"
      ? context.ast.elements(authoredTypeNode) : undefined;
    return infos.every((info, index) => {
      const elementNode = elementNodes?.[index];
      const elementContext = structuralComponentContext(context, { kind: "tuple-element", index });
      return elementContext !== undefined && retainRustStructuralInstantiation(info.type, templateCarrier.elements[index]!, carrier.elements[index]!,
        elementContext, options, resolving, elementNode !== undefined && context.ast.kindName(elementNode) !== "KindNamedTupleMember"
          ? elementNode : undefined);
    });
  }
  const structural = rustStructuralObjectCarrierValue(carrier);
  if (structural === undefined || rustStructuralObjectCarrierValue(templateCarrier) === undefined) return false;
  if (rustTargetTypeRefEquals(templateCarrier, carrier) &&
    options.sourceTypes.structuralObjectForType(sourceType, carrier) !== undefined) return true;
  const template = options.sourceTypes.structuralObjectForCarrier(templateCarrier);
  if (template === undefined) return false;
  const implementation = structural.implementation;
  const templateImplementation = rustStructuralObjectCarrierValue(templateCarrier)?.implementation;
  const ownsBody = implementation !== undefined && (templateImplementation === undefined ||
    implementation.methods.some((method, index) => method.identity !== templateImplementation.methods[index]?.identity));
  const selectedContext = bindRustSourceAliasArguments(sourceType, context, options, resolving, authoredTypeNode);
  if (selectedContext === undefined) return false;
  context = selectedContext;
  const correspondence = context.currentSemantics.types.structuralMembers(sourceType, template.sourceType, "correspondence");
  if (correspondence.kind !== "available" ||
    correspondence.members.filter(member => !isRustErasedNominalMember(member.destination.declarations, context.ast)).length !== template.fields.length ||
    structural.fields.length !== template.fields.length ||
    correspondence.source.calls.length !== 0 || correspondence.source.constructs.length !== (template.construction === undefined ? 0 : 1) ||
    correspondence.source.indexes.length !== 0) return false;
  const construction = template.construction === undefined ? undefined : resolveRustConstructType(sourceType, context, options, resolving);
  if (template.construction !== undefined && (construction === undefined || structural.construction === undefined ||
    !rustTargetTypeRefEquals(rustCarrierWithTargetPlaceholderLifetimes(construction.carrier, structural.construction), structural.construction))) return false;
  if (template.construction !== undefined && construction !== undefined &&
    !retainSignature(construction.signatureInfo, template.construction.carrier, structural.construction ?? construction.carrier, context, options, resolving)) return false;
  const fields = template.fields.map(field => {
    const matches = correspondence.members.filter(pair => field.symbols.includes(pair.destination.property.symbol));
    if (matches.length !== 1) return undefined;
    const selected = matches[0]!;
    const targetField = structural.fields[field.storageIndex];
    if (selected.kind !== "present" || targetField === undefined ||
      targetField.sourceName !== field.sourceName || targetField.presence !== field.presence ||
      targetField.readonly !== field.readonly ||
      (!ownsBody && (selected.source.property.optional !== selected.destination.property.optional ||
      selected.source.property.readonly !== selected.destination.property.readonly)) ||
      selected.source.read !== selected.destination.read ||
      (selected.source.read === "unavailable" && context.callableRepresentation !== "signature") ||
      selected.destination.declarations.length !== field.declarations.length ||
      selected.destination.declarations.some(declaration => !field.declarations.includes(declaration))) return undefined;
    const authoredEvidence = field.declarations.flatMap(declaration => {
      if (context.ast.is.IsMethodDeclaration(declaration) || context.ast.kindName(declaration) === "KindMethodSignature") return [];
      const type = context.ast.typeNode(declaration);
      return type === undefined ? [] : [{ declaration, authoredTypeNode: type }];
    });
    const sourceDeclarations = selected.source.declarations.filter(declaration => selected.source.read === "method"
      ? context.ast.is.IsMethodDeclaration(declaration) || context.ast.kindName(declaration) === "KindMethodSignature"
      : selected.source.read === "accessor" ? context.ast.is.IsGetAccessorDeclaration(declaration)
        : !context.ast.is.IsGetAccessorDeclaration(declaration) && !context.ast.is.IsSetAccessorDeclaration(declaration) &&
          !context.ast.is.IsMethodDeclaration(declaration) && context.ast.kindName(declaration) !== "KindMethodSignature");
    const memberContexts = context.callableRepresentation === "signature" ? [context]
      : sourceDeclarations.map(declaration => structuralComponentContext(context,
          { kind: selected.source.read === "method" ? "method-value" : "member", declaration }));
    if (memberContexts.length === 0 || memberContexts.some(selected => selected === undefined)) return undefined;
    const declared = memberContexts.flatMap(memberContext => authoredEvidence.map(evidence => memberContext === undefined ? undefined
      : resolveRustTypeComponentEvidence({ authoredTypeNode: evidence.authoredTypeNode, selectedType: selected.source.property.type },
        memberContext, options, resolving)));
    const normalize = rustTypeFamilyNormalizer(options.sourceTypes.typeFamilies);
    const expected = mapRustTargetTypes(targetField.type, normalize);
    // The authored field type keeps an open callable environment: the selected storage either closes it with its own
    // lifetime or keeps the target placeholder lifetimes. A field that itself holds structural storage is closed
    // separately (its method environments name the new instantiation's lifetimes), so its authored type matches the
    // template field and the recursive retention below proves and registers the closed nested instantiation.
    let closing: RustLifetimeRef | undefined;
    mapRustTargetTypes(expected, (current, original) => {
      closing ??= rustCallableProtocol(original)?.lifetime;
      return current;
    });
    const closed = (carrier: TargetTypeRef): TargetTypeRef => closing === undefined ? carrier
      : closeRustRetainedCallableCarrier(carrier, closing);
    const nestedTemplate = containsStructuralStorage(field.resultCarrier, options) === true
      ? mapRustTargetTypes(field.resultCarrier, normalize) : undefined;
    if (declared.some(carrier => {
      if (carrier === undefined) return true;
      const authored = mapRustTargetTypes(rustSourcePropertyTargetType(carrier, selected.source.property.optional), normalize);
      return !rustTargetTypeRefEquals(closed(authored), expected) &&
        !rustTargetTypeRefEquals(rustCarrierWithTargetPlaceholderLifetimes(authored, expected), expected) &&
        (nestedTemplate === undefined || !rustTargetTypeRefEquals(authored, nestedTemplate));
    })) return undefined;
    if (!memberContexts.every(memberContext => memberContext !== undefined &&
      (authoredEvidence.length === 0 ? [undefined] : authoredEvidence.map(evidence => evidence.authoredTypeNode)).every(authored =>
        retainRustStructuralInstantiation(selected.source.property.type, field.resultCarrier,
          targetField.type, memberContext, options, resolving, authored)))) return undefined;
    return {
      ...field,
      declarations: selected.source.declarations,
      symbols: [...new Set([selected.source.property.symbol, ...selected.source.property.rootSymbols])],
      sourceType: selected.source.property.type,
      resultCarrier: targetField.type,
    };
  });
  if (fields.some(field => field === undefined)) return false;
  const { sourceAlias: _sourceAlias, ...literalTemplate } = template;
  return options.sourceTypes.registerStructuralObject({ ...(ownsBody ? literalTemplate : template), sourceType, carrier,
    // The construction registers with the closed carrier it was proven equal to (placeholder lifetimes taken from it).
    ...(construction === undefined ? {} : { construction: { ...construction, carrier: structural.construction ?? construction.carrier } }),
    fields: fields as NonNullable<(typeof fields)[number]>[] }, ownsBody
    ? { kind: "root" } : { kind: "generic-instantiation", template: templateCarrier });
}

function structuralComponentContext(context: RustTargetTypeResolutionContext,
  component: SourceStorageProjection): RustTargetTypeResolutionContext | undefined {
  if (context.callableRepresentation === "signature") return context;
  const current = context.sourceStorageResolution;
  if (current?.kind !== "resolved" || current.subject === undefined) return undefined;
  const selected = rustSourceStorageComponentContext(context, component);
  return selected.sourceStorageResolution?.kind === "resolved" && selected.sourceStorageResolution.subject !== undefined ? selected : undefined;
}

function containsStructuralStorage(carrier: TargetTypeRef, options: RustTargetTypeResolutionOptions): boolean | undefined {
  const pending = [carrier];
  const visited = new Set<TargetTypeRef>();
  const unions = new Set<string>();
  let rows = 1;
  const append = (carriers: readonly TargetTypeRef[]): boolean => {
    rows += carriers.length;
    if (rows > 4096) return false;
    pending.push(...carriers);
    return true;
  };
  while (pending.length !== 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (rustStructuralObjectCarrierValue(current) !== undefined) return true;
    if (rustSourceUnionCarrierValue(current) !== undefined) {
      const key = closedMetadataKey(current);
      if (unions.has(key)) continue;
      unions.add(key);
      const variants = options.sourceTypes.sourceUnionVariants(current);
      if (variants === undefined || variants.length === 0 || variants.length > 4096 ||
        !append(variants.map(variant => variant.carrier))) return undefined;
      continue;
    }
    const callable = rustGenericCallableProtocol(current) ?? rustCallableProtocol(current);
    if (callable !== undefined) {
      if (!append([callable.result, ...callable.parameters])) return undefined;
      continue;
    }
    const element = rustOptionElementCarrier(current) ?? (current.kind === "array" ? current.element :
      isRustJsArrayCarrier(current) ? rustJsArrayLikeElementTargetType(current) : undefined);
    if (element !== undefined && !append([element])) return undefined;
    if (current.kind === "tuple" && !append(current.elements)) return undefined;
  }
  return false;
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
  const storage = [result, ...parameters].map(carrier => containsStructuralStorage(carrier, options));
  if (storage.some(selected => selected === undefined)) return false;
  if (!storage.some(selected => selected === true)) return true;
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

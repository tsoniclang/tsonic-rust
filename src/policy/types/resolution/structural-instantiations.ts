import type { Signature, Type } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import { rustStructuralObjectCarrierValue } from "../../../target-model/types/carriers/source-types.js";
import { rustJsArrayLikeElementTargetType, isRustJsArrayCarrier } from "../../../target-model/types/carriers/js.js";
import { resolveRustConstructType } from "./constructors.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { resolveRustTypeComponentEvidence } from "./source-evidence.js";
import { rustTypeFamilyNormalizer } from "../type-family-normalization.js";
import { mapRustTargetTypes } from "../../../target-model/types/carriers/substitution.js";
import { inferRustTargetTypeParameterBindings } from "../../../target-model/types/carriers/generic-inference.js";
import { rustTargetTypeParameterNames } from "../../../target-model/types/carriers/generic-references.js";
import { resolveRustTargetType } from "./target.js";
import { rustCallableProtocol } from "../../../target-model/types/carriers/callables.js";
import { isRustErasedNominalMember } from "../source-shapes.js";

export function retainRustStructuralInstantiation(
  sourceType: Type,
  templateCarrier: TargetTypeRef,
  carrier: TargetTypeRef,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object> = new Set(),
): boolean {
  if (!containsStructuralStorage(templateCarrier)) return true;
  if (rustCallableProtocol(templateCarrier) !== undefined) {
    const signatures = context.currentSemantics.types.callSignatures(sourceType);
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
    return arguments_.length === 1 && arguments_[0] !== undefined &&
      retainRustStructuralInstantiation(arguments_[0], templateElement, element, context, options, resolving);
  }
  const structural = rustStructuralObjectCarrierValue(carrier);
  if (structural === undefined || rustStructuralObjectCarrierValue(templateCarrier) === undefined) return false;
  const template = options.sourceTypes.structuralObjectForCarrier(templateCarrier);
  if (template === undefined) return false;
  const application = context.currentSemantics.types.aliasApplication(sourceType);
  if (application !== undefined) {
    const bindings = inferRustTargetTypeParameterBindings(templateCarrier, carrier,
      new Set(rustTargetTypeParameterNames(templateCarrier)));
    const substitutions = new Map(context.sourceTypeParameterSubstitutions);
    for (const binding of application.bindings) {
      const owner = context.ast.parent(binding.declaration);
      const parameter = owner === undefined ? undefined : context.sourceLifetimes.contractFor(owner)?.parameters
        .find(parameter => parameter.declaration === binding.declaration);
      const selected = parameter?.kind === "type" ? bindings?.get(parameter.targetName) ??
        resolveRustTargetType(binding.argument, context, options, resolving) : undefined;
      if (selected !== undefined) substitutions.set(binding.declaration, { sourceType: binding.argument, carrier: selected });
    }
    context = { ...context, sourceTypeParameterSubstitutions: substitutions };
  }
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
    !retainSignature(construction.signature, template.construction.carrier, construction.carrier, context, options, resolving)) return false;
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
      const type = context.ast.typeNode(declaration);
      return type === undefined ? [] : [type];
    }))];
    const declared = authoredNodes.map(authoredTypeNode => resolveRustTypeComponentEvidence({
      authoredTypeNode, selectedType: selected.source.property.type,
    }, context, options, resolving));
    const normalize = rustTypeFamilyNormalizer(options.sourceTypes.typeFamilies);
    const expected = mapRustTargetTypes(targetField.type, normalize);
    if (declared.some(carrier => carrier === undefined ||
      !rustTargetTypeRefEquals(mapRustTargetTypes(carrier, normalize), expected))) return undefined;
    if (!retainRustStructuralInstantiation(selected.source.property.type, field.resultCarrier,
      targetField.type, context, options, resolving)) return undefined;
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
    const callable = rustCallableProtocol(current);
    if (callable !== undefined) return [callable.result, ...callable.parameters].some(containsStructuralStorage);
    const element = current.kind === "array" ? current.element :
      isRustJsArrayCarrier(current) ? rustJsArrayLikeElementTargetType(current) : undefined;
    if (element === undefined) return false;
    current = element;
  }
}

function retainSignature(
  signature: Signature, templateCarrier: TargetTypeRef, carrier: TargetTypeRef,
  context: RustTargetTypeResolutionContext, options: RustTargetTypeResolutionOptions, resolving: Set<object>,
): boolean {
  const template = rustCallableProtocol(templateCarrier);
  const selected = rustCallableProtocol(carrier);
  const result = context.currentSemantics.types.returnType(signature);
  const parameters = context.currentSemantics.types.signatureParameterInfos(signature);
  if (template === undefined || selected === undefined || result === undefined ||
    template.parameters.length !== selected.parameters.length || parameters.length !== selected.parameters.length ||
    !retainRustStructuralInstantiation(result, template.result, selected.result, context, options, resolving)) return false;
  return parameters.every((parameter, index) => retainRustStructuralInstantiation(
    parameter.type, template.parameters[index]!, selected.parameters[index]!, context, options, resolving));
}

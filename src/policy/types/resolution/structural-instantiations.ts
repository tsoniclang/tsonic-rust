import type { Type } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import { rustStructuralObjectCarrierValue } from "../../../target-model/types/carriers/source-types.js";
import { rustJsArrayLikeElementTargetType, isRustJsArrayCarrier } from "../../../target-model/types/carriers/js.js";

export function retainRustStructuralInstantiation(
  sourceType: Type,
  templateCarrier: TargetTypeRef,
  carrier: TargetTypeRef,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): boolean {
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
      retainRustStructuralInstantiation(arguments_[0], templateElement, element, context, options);
  }
  const structural = rustStructuralObjectCarrierValue(carrier);
  if (structural === undefined || rustStructuralObjectCarrierValue(templateCarrier) === undefined) return true;
  const template = options.sourceTypes.structuralObjectForCarrier(templateCarrier);
  if (template === undefined) return false;
  const correspondence = context.currentSemantics.types.structuralMembers(sourceType, template.sourceType);
  if (correspondence.kind !== "available" || correspondence.members.length !== template.fields.length ||
    structural.fields.length !== template.fields.length ||
    correspondence.source.calls.length !== 0 || correspondence.source.constructs.length !== 0 ||
    correspondence.source.indexes.length !== 0) return false;
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
      selected.source.declarations.length !== field.declarations.length ||
      selected.source.declarations.some(declaration => !field.declarations.includes(declaration))) return undefined;
    if (!retainRustStructuralInstantiation(selected.source.property.type, field.resultCarrier,
      targetField.type, context, options)) return undefined;
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
    fields: fields as NonNullable<(typeof fields)[number]>[] }, templateCarrier);
}

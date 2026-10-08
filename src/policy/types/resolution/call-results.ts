import type { RustSelectedTargetSignature, RustTargetGenericArgument, TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustFlowReadProjectionFact } from "../../../target-model/types/value-projections.js";
import type { RustProjectTypePolicy } from "../../../target-model/types/project-types.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustNativeRepresentationMatches } from "../../../target-model/conversions/native-representation.js";
import { selectRustProjectProjection } from "../project-projections.js";
import { selectRustFlowReadProjection } from "../value-carrier-reconciliation.js";
import { isRustJsValueCarrier, rustOptionElementCarrier, rustTargetGenericBindingsForArguments, substituteRustTargetGenerics } from "../../../target-model/types/index.js";
import { rustUnionAlternatives } from "../../../target-model/types/union-relations.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { rustTypeFamilyNormalizer } from "../type-family-normalization.js";
import { bindRustSelectedCallTypeArguments, rustSelectedCallTypeParameters } from "./generic-arguments.js";
import { retainRustStructuralInstantiation } from "./structural-instantiations.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";

export function retainRustSelectedCallableResultTemplate(
  selected: RustSelectedTargetSignature,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): boolean {
  if (rustGenericCallableValue(selected.sourceCallableCarrier) === undefined) return true;
  const sourceArguments = selected.sourceSelectedMethodTypeArguments ?? [];
  const parameters = rustSelectedCallTypeParameters(sourceArguments, context);
  const template = rustGenericCallableProtocol(selected.sourceCallableCarrier);
  const rebound = parameters === undefined ? undefined : rustGenericCallableProtocol(selected.sourceCallableCarrier, parameters);
  const storageContext = parameters === undefined ? undefined : bindRustSelectedCallTypeArguments(sourceArguments,
    parameters.map(type => ({ kind: "type" as const, type })), context);
  const selectedParameters = selected.member.parameters ?? [];
  const selectedGenerics = selected.member.genericParameters ?? [];
  if (parameters === undefined || template === undefined || rebound === undefined || storageContext === undefined || selected.sourceReturnType === undefined ||
    !rustTargetTypeRefEquals(rebound.result, selected.member.returnType) ||
    rebound.parameters.length !== selectedParameters.length ||
    rebound.parameters.some((parameter, index) => !rustTargetTypeRefEquals(parameter, selectedParameters[index]?.type)) ||
    parameters.length !== selectedGenerics.length || selectedGenerics.some((parameter, index) =>
      parameter.kind !== "type" || parameter.targetIdentity !== parameters[index]?.identity)) return false;
  return retainRustStructuralInstantiation(selected.sourceReturnType, template.result, rebound.result,
    storageContext, options, new Set(), selected.sourceDeclaration === undefined
      ? undefined : context.ast.typeNode(selected.sourceDeclaration));
}

export function resolveRustSelectedSourceCallResult(
  selected: RustSelectedTargetSignature,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  const template = selected.member.returnType;
  if (template === undefined) return undefined;
  const arguments_ = selected.targetGenericArguments ?? [];
  const parameters = selected.member.genericParameters ?? [];
  const substitutions = rustTargetGenericBindingsForArguments(parameters, arguments_);
  if (substitutions === undefined) return undefined;
  const normalize = rustTypeFamilyNormalizer(options.sourceTypes.typeFamilies);
  const result = substituteRustTargetGenerics(template, substitutions.types, substitutions.lifetimes,
    substitutions.consts, normalize);
  if (!retainRustSelectedSourceCallResultStorage(selected, arguments_, result, context, options)) return undefined;
  const projection = selected.sourceResultProjection;
  if (projection === undefined) return result;
  const projectionSource = substituteRustTargetGenerics(projection.sourceCarrier,
    substitutions.types, substitutions.lifetimes, substitutions.consts, normalize);
  return !rustTargetTypeRefEquals(projectionSource, result) ? undefined : substituteRustTargetGenerics(projection.selectedCarrier,
    substitutions.types, substitutions.lifetimes, substitutions.consts, normalize);
}

export function retainRustSelectedSourceCallResultStorage(
  selected: RustSelectedTargetSignature,
  arguments_: readonly RustTargetGenericArgument[],
  result: TargetTypeRef,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): boolean {
  const template = selected.member.returnType;
  if (template === undefined || !retainRustSelectedCallableResultTemplate(selected, context, options)) return false;
  const storageContext = arguments_.length === 0 && (selected.member.genericParameters?.length ?? 0) === 0 ? context
    : bindRustSelectedCallTypeArguments(selected.sourceSelectedMethodTypeArguments ?? [], arguments_, context);
  return storageContext !== undefined && (selected.sourceReturnType === undefined ||
    retainRustStructuralInstantiation(selected.sourceReturnType, template, result,
      storageContext, options, new Set(), selected.sourceDeclaration === undefined
        ? undefined : context.ast.typeNode(selected.sourceDeclaration)));
}

export interface RustSourceCallResult {
  readonly nativeType: TargetTypeRef;
  readonly selectedType: TargetTypeRef;
  readonly projection?: RustFlowReadProjectionFact;
}

export function selectRustSourceCallResult(
  projectTypes: RustProjectTypePolicy,
  nativeType: TargetTypeRef,
  selected: () => TargetTypeRef | undefined,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustSourceCallResult | undefined {
  const direct = Object.freeze({ nativeType, selectedType: nativeType });
  const optionalPayload = rustOptionElementCarrier(nativeType);
  const nativePayload = optionalPayload ?? nativeType;
  if (optionalPayload !== undefined || isRustJsValueCarrier(nativePayload) ||
    rustUnionAlternatives(nativePayload, definitions) !== undefined) {
    const selectedType = selected();
    if (selectedType === undefined) return undefined;
    if (rustNativeRepresentationMatches(nativeType, selectedType)) return direct;
    const projection = selectRustFlowReadProjection(nativeType, selectedType, projectTypes, definitions);
    return projection.kind !== "projection" ? undefined : Object.freeze({
      nativeType, selectedType, projection: Object.freeze(projection.fact),
    });
  }
  const source = projectTypes.definitionForCarrier(nativeType);
  if (source === undefined) return direct;
  const selectedType = selected();
  if (selectedType === undefined || rustTargetTypeRefEquals(nativeType, selectedType)) return direct;
  const relation = projectTypes.relationship(selectedType, source);
  if (relation.kind !== "related" || !rustTargetTypeRefEquals(relation.targetType, nativeType)) return direct;
  const projection = selectRustProjectProjection(nativeType, selectedType, projectTypes);
  return projection === undefined ? undefined : Object.freeze({
    nativeType,
    selectedType,
    projection: Object.freeze({ kind: "project-downcast", sourceCarrier: nativeType, dispatchCarrier: nativeType, selectedCarrier: selectedType, projection }),
  });
}

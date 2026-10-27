import type { RustTargetOperationFact } from "../../../target-model/records/operations.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustSelectedTargetSignature } from "../../../target-model/records/member-selections.js";
import type { RustProjectTypePolicy } from "../../../target-model/types/project-types.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import type { RustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import { rustGenericCallableProtocol } from "../../../target-model/types/carriers/generic-callables.js";
import { rustCallableProtocol, rustNativeCallableProtocol, rustCallableInputProtocol, rustSliceElementCarrier,
  rustTargetGenericBindingsForArguments, substituteRustTargetGenerics } from "../../../target-model/types/index.js";
import { mapRustTargetTypes } from "../../../target-model/types/carriers/substitution.js";
import { rustTargetGenericArgumentEquals, rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import { rustSourceCallGenericLifetimeArguments, rustSourceCallResultWithInputLifetimes } from "../ownership/source-call-lifetimes.js";
import { rustSourceCallResultProjectionMatches } from "./source-call-results.js";
import { rustPromiseBodyInvocationCarrier } from "../async/promise-bodies.js";

export function sourceCallSelectedMemberMatches(fact: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>,
  selected: RustSelectedTargetSignature, declaredResultCarrier: TargetTypeRef | undefined,
  normalize: (carrier: TargetTypeRef) => TargetTypeRef, projectTypes: RustProjectTypePolicy,
  argumentCarriers: readonly (TargetTypeRef | undefined)[], definitions: RustTypeDefinitions,
  retainedLifetimes: ReadonlyMap<string, RustLifetimeRef>): boolean {
  const member = selected.member;
  const sourceArguments = selected.sourceSelectedMethodTypeArguments ?? [];
  const parameters = member.genericParameters ?? [];
  const targetArguments = fact.targetGenericArguments ?? [];
  const selectedArguments = selected.targetGenericArguments ?? [];
  const finalizedLifetimes = rustSourceCallGenericLifetimeArguments(selected, targetArguments, index => argumentCarriers[index]);
  if (sourceArguments.length !== parameters.length || parameters.length !== targetArguments.length || finalizedLifetimes === undefined ||
    selectedArguments.length !== targetArguments.length || parameters.some((parameter, index) => parameter.sourceName !== sourceArguments[index]?.typeParameterName) ||
    selectedArguments.some((argument, index) => {
      const parameter = parameters[index];
      const sourceArgument = sourceArguments[index];
      const targetArgument = targetArguments[index];
      const inferred = parameter?.kind === "type" && sourceArgument?.explicitTypeNode === undefined && argument.kind === "type" && targetArgument?.kind === "type";
      return !inferred && !rustTargetGenericArgumentEquals(parameter?.kind === "lifetime" ? finalizedLifetimes[index] : argument, targetArgument);
    })) return false;
  const substitutions = rustTargetGenericBindingsForArguments(parameters, targetArguments);
  if (substitutions === undefined || !isDenseDataArray(member.parameters)) return false;
  const lifetimes = new Map([...substitutions.lifetimes, ...retainedLifetimes]);
  const parameterCarriers = member.parameters.map(parameter => substituteRustTargetGenerics(parameter.type,
    substitutions.types, lifetimes, substitutions.consts, normalize));
  const instantiateResult = (carrier: TargetTypeRef): TargetTypeRef => rustSourceCallResultWithInputLifetimes(
    substituteRustTargetGenerics(carrier, substitutions.types, lifetimes, substitutions.consts, normalize),
    parameterCarriers, selected.sourceArgumentBindings, argumentCarriers, fact.parameters);
  const expectedKind = fact.target.form === "constructor" ? "constructor" : "method";
  const expectedName = fact.target.form === "constructor" ? fact.target.name
    : fact.target.form === "callable" || fact.target.form === "structural-method" || fact.target.form === "constructor-value" ? member.targetName
    : fact.target.form === "function" ? fact.target.selectedTargetName
    : fact.target.form === "union-method" ? fact.target.variants.find(variant => variant.declaration === selected.sourceDeclaration)?.targetName : fact.target.name;
  const result = declaredResultCarrier === undefined ? undefined : instantiateResult(declaredResultCarrier);
  const sourceProjection = selected.sourceResultProjection;
  const resultProjection = fact.resultProjection;
  if (fact.asyncBody !== undefined && (fact.asyncBody.declaration !== selected.sourceDeclaration || resultProjection !== undefined ||
    !rustTargetTypeRefEquals(fact.resultCarrier, rustPromiseBodyInvocationCarrier(fact.asyncBody)))) return false;
  if ((sourceProjection === undefined) !== (resultProjection === undefined)) return false;
  if (sourceProjection !== undefined && resultProjection !== undefined && (!rustTargetTypeRefEquals(resultProjection.selectedCarrier, fact.resultCarrier) ||
    !rustSourceCallResultProjectionMatches(sourceProjection, resultProjection, instantiateResult, projectTypes, definitions))) return false;
  if (member.id !== fact.operationId || member.kind !== expectedKind || member.targetName !== expectedName || result === undefined ||
    !rustTargetTypeRefEquals(result, mapRustTargetTypes(fact.asyncBody?.logicalResultCarrier ?? resultProjection?.sourceCarrier ?? fact.resultCarrier, normalize))) return false;
  const callableCarrier = fact.target.form === "callable" ? fact.target.carrier
    : fact.target.form === "structural-method" || fact.target.form === "constructor-value" ? fact.target.callableCarrier : undefined;
  const genericNames = parameters.flatMap(parameter => parameter.kind === "type"
    ? [{ kind: "type-parameter" as const, identity: parameter.targetIdentity, name: parameter.sourceName }] : []);
  const callable = rustGenericCallableProtocol(callableCarrier, genericNames) ?? rustNativeCallableProtocol(callableCarrier) ?? rustCallableProtocol(callableCarrier);
  if (callable !== undefined) return callable.parameters.length === fact.parameters.length && callable.parameters.every((carrier, index) => {
    carrier = substituteRustTargetGenerics(carrier, substitutions.types, lifetimes, substitutions.consts, normalize);
    const parameter = fact.parameters[index];
    if (parameter === undefined || !rustTargetTypeRefEquals(carrier, mapRustTargetTypes(parameter.parameterCarrier, normalize))) return false;
    if (parameter.mode === "value") return true;
    const value = mapRustTargetTypes(parameter.valueCarrier, normalize);
    return (callableCarrier?.kind === "closure" || rustCallableInputProtocol(callableCarrier) !== undefined) && carrier.kind === "reference" &&
      parameter.mode === (carrier.mutable ? "mut-ref" : "ref") && (rustTargetTypeRefEquals(carrier.referent, value) ||
        value.kind === "array" && rustTargetTypeRefEquals(rustSliceElementCarrier(carrier), value.element));
  });
  return member.parameters.length === fact.parameters.length && member.parameters.every((parameter, index) => {
    const selectedParameter = fact.parameters[index];
    if (selectedParameter === undefined) return false;
    const mode = parameter.passingMode === "borrow-mut" ? "mut-ref" : parameter.passingMode === "borrow-shared" ? "ref" : "value";
    return rustTargetTypeRefEquals(substituteRustTargetGenerics(parameter.type, substitutions.types, lifetimes, substitutions.consts, normalize),
      mapRustTargetTypes(selectedParameter.parameterCarrier, normalize)) && mode === selectedParameter.mode;
  });
}

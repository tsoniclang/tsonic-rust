import { hasExactObjectKeys, isClosedMetadata, isDenseDataArray, snapshotClosedMetadata } from "../metadata/closed-data.js";
import { rustRuntimeErrorTargetType } from "../operations/error-boundary.js";
import { rustCallableInputProtocol, rustCallableProtocol, rustClosureProtocol } from "../types/carriers/callables.js";
import { rustNamedTargetType, rustNamedTypeCarrierValue } from "../types/carriers/native.js";
import { rustCallableTargetId } from "../types/carriers/source-types.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../types/equality.js";
import { rustOnlyTypeGenericArguments, rustTypeGenericArguments, rustLifetimeGenericArgument } from "../types/generic-arguments.js";
import type { TargetTypeRef } from "../types/model.js";
import { rustNativeErrorJoinTargetType, type RustNativeErrorSource } from "../types/native-error-joins.js";
import type { RustTypeDefinitions } from "../types/source-union-definitions.js";
import { emptyRustTypeDefinitions } from "../types/source-union-definitions.js";
import { rustCallableConversionMatches, type RustCallableConversion } from "./callable.js";
import { rustValueConversionContract, type RustValueConversionContract } from "./contracts.js";
import { substituteRustCallableConversion } from "./substitution.js";
import { mapRustProgramErrorRoute } from "./program-error.js";
import type { RustTargetGenericBindings } from "../types/carriers/generic-inference.js";
import type { RustUnionPathStep } from "../types/union-relations.js";

export interface RustCallablePhysicalSignature {
  readonly parameters: readonly TargetTypeRef[];
  readonly result: TargetTypeRef;
  readonly error: TargetTypeRef;
}

export type RustCallablePhysicalValueConversion<Source extends RustNativeErrorSource<TargetTypeRef> = RustNativeErrorSource<TargetTypeRef>> =
  | { readonly kind: "identity" | "borrow" | "absence" | "discard" }
  | { readonly kind: "value"; readonly contract: RustValueConversionContract; readonly errorIdentity?: string }
  | { readonly kind: "callable"; readonly conversion: RustCallablePhysicalConversion<Source> };

export interface RustCallablePhysicalConversion<Source extends RustNativeErrorSource<TargetTypeRef> = RustNativeErrorSource<TargetTypeRef>> extends RustCallablePhysicalSignature {
  readonly nativeErrorType: TargetTypeRef;
  readonly logical: RustCallableConversion;
  readonly source: RustCallablePhysicalSignature;
  readonly carrier: TargetTypeRef;
  readonly arguments: readonly RustCallablePhysicalValueConversion<Source>[];
  readonly resultPlan: RustCallablePhysicalValueConversion<Source>;
  readonly errors: readonly Source[];
}

export type RustCallablePhysicalValueConversionPreparation =
  | Exclude<RustCallablePhysicalValueConversion, { readonly kind: "callable" }>
  | { readonly kind: "callable"; readonly conversion: RustCallablePhysicalConversionPreparation };

export type RustCallablePhysicalConversionPreparation =
  Omit<RustCallablePhysicalConversion, "nativeErrorType" | "arguments" | "resultPlan"> & {
    readonly arguments: readonly RustCallablePhysicalValueConversionPreparation[];
    readonly resultPlan: RustCallablePhysicalValueConversionPreparation;
  };

export function substituteRustCallablePhysicalConversion(
  conversion: RustCallablePhysicalConversionPreparation,
  bindings: RustTargetGenericBindings,
  apply: (carrier: TargetTypeRef) => TargetTypeRef,
): RustCallablePhysicalConversionPreparation {
  const path = (steps: readonly RustUnionPathStep[]): readonly RustUnionPathStep[] =>
    Object.freeze(steps.map(step => Object.freeze({ ...step, union: apply(step.union) })));
  const contract = (selected: RustValueConversionContract): RustValueConversionContract => {
    const base = { source: apply(selected.source), target: apply(selected.target),
      ...(selected.fallible && selected.errorBoundary === "provider-native" ? { errorCarrier: apply(selected.errorCarrier) } : {}) };
    switch (selected.lowering) {
      case "program-error": return Object.freeze({ ...selected, ...base, route: mapRustProgramErrorRoute(selected.route, apply) });
      case "js-array-backing": case "source-optional": return Object.freeze({ ...selected, ...base, element: apply(selected.element) });
      case "union-project": return Object.freeze({ ...selected, ...base, path: path(selected.path) });
      case "union-map": return Object.freeze({ ...selected, ...base, arms: Object.freeze(selected.arms.map(arm => Object.freeze({
        ...arm, carrier: apply(arm.carrier), source: path(arm.source), target: path(arm.target) }))) });
      case "rest-sequence": return Object.freeze({ ...selected, ...base,
        elementConversions: Object.freeze(selected.elementConversions.map(element => element === null ? null : contract(element))),
        cloneSources: Object.freeze(selected.cloneSources.map(apply)) });
      case "source-union-variant": return Object.freeze({ ...selected, ...base, path: path(selected.path),
        payloadCarrier: apply(selected.payloadCarrier), payloadConversion: selected.payloadConversion === null ? null : contract(selected.payloadConversion) });
      case "option-map": return Object.freeze({ ...selected, ...base, element: contract(selected.element) });
      case "option-some": return Object.freeze({ ...selected, ...base,
        element: selected.element === null ? null : contract(selected.element) });
      case "closed-value-from-option": case "js-value-from-array": return Object.freeze({ ...selected, ...base,
        element: apply(selected.element), elementConversion: contract(selected.elementConversion) });
      case "union-fold": return Object.freeze({ ...selected, ...base, arms: Object.freeze(selected.arms.map(arm => Object.freeze({
        ...arm, carrier: apply(arm.carrier), path: path(arm.path), conversion: contract(arm.conversion) }))) });
      case "js-value-from-structural-to-json": return Object.freeze({ ...selected, ...base,
        resultCarrier: apply(selected.resultCarrier), resultConversion: contract(selected.resultConversion) });
      case "js-value-from-properties": return Object.freeze({ ...selected, ...base,
        fields: Object.freeze(selected.fields.map(field => Object.freeze({ ...field,
          sourceCarrier: apply(field.sourceCarrier), conversion: contract(field.conversion) }))) });
      case "js-value-from-structural-object": return Object.freeze({ ...selected, ...base,
        fields: Object.freeze(selected.fields.map(field => Object.freeze({ ...field,
          sourceCarrier: apply(field.sourceCarrier), conversion: contract(field.conversion) }))) });
      default: return Object.freeze({ ...selected, ...base });
    }
  };
  const part = (selected: RustCallablePhysicalValueConversionPreparation): RustCallablePhysicalValueConversionPreparation => selected.kind === "callable"
    ? Object.freeze({ ...selected, conversion: substituteRustCallablePhysicalConversion(selected.conversion, bindings, apply) })
    : selected.kind === "value" ? Object.freeze({ ...selected, contract: contract(selected.contract) }) : selected;
  return Object.freeze({ ...conversion,
    logical: substituteRustCallableConversion(conversion.logical, bindings.types, bindings.lifetimes, bindings.consts),
    carrier: apply(conversion.carrier), parameters: Object.freeze(conversion.parameters.map(apply)), result: apply(conversion.result),
    error: apply(conversion.error), source: Object.freeze({ parameters: Object.freeze(conversion.source.parameters.map(apply)),
      result: apply(conversion.source.result), error: apply(conversion.source.error) }),
    arguments: Object.freeze(conversion.arguments.map(part)), resultPlan: part(conversion.resultPlan),
    errors: Object.freeze(conversion.errors.map(source => Object.freeze({ ...source, errorType: apply(source.errorType) }))) });
}

export function rustCallablePhysicalSignature(carrier: TargetTypeRef): RustCallablePhysicalSignature | undefined {
  if (!isRustTargetTypeRef(carrier)) return undefined;
  const named = rustNamedTypeCarrierValue(carrier);
  const arguments_ = named?.id === rustCallableTargetId && named.genericArguments?.[0]?.kind === "lifetime"
    ? rustOnlyTypeGenericArguments(named.genericArguments.slice(1)) : undefined;
  const tuple = arguments_?.length === 2 ? arguments_[0]
    : carrier.kind === "closure" && carrier.fallible !== true && carrier.args.length === 1 ? carrier.args[0] : undefined;
  const resultCarrier = tuple?.kind === "tuple" ? arguments_?.[1] ?? (carrier.kind === "closure" ? carrier.result : undefined) : undefined;
  const result = rustNamedTypeCarrierValue(resultCarrier);
  const resultArguments = result?.id === "rust.core.Result" ? rustOnlyTypeGenericArguments(result.genericArguments) : undefined;
  return tuple?.kind !== "tuple" || resultArguments?.length !== 2 ? undefined : Object.freeze({
    parameters: tuple.elements, result: resultArguments[0]!, error: resultArguments[1]!,
  });
}

export function rustCallableConversionPhysical(
  conversion: RustCallableConversion,
  source: RustCallablePhysicalSignature,
  fileName: string,
  definitions: RustTypeDefinitions,
  sourceSignatureFor: (carrier: TargetTypeRef) => RustCallablePhysicalSignature | undefined,
): RustCallablePhysicalConversionPreparation | undefined {
  if (definitions === undefined || typeof sourceSignatureFor !== "function")
    throw new Error("Callable physical conversion requires its explicit type definitions and selected source signature decoder.");
  let remaining = 4096;
  const select = (logical: RustCallableConversion, actual: RustCallablePhysicalSignature, depth: number): RustCallablePhysicalConversionPreparation | undefined => {
    if (remaining-- <= 0 || depth > 128 || logical === null || typeof logical !== "object" ||
      actual === null || typeof actual !== "object" || !isClosedMetadata(actual) ||
      !hasExactObjectKeys(actual, ["parameters", "result", "error"]) || !isDenseDataArray(actual.parameters) ||
      !actual.parameters.every(isRustTargetTypeRef) || !isRustTargetTypeRef(actual.result) || !isRustTargetTypeRef(actual.error) ||
      !rustCallableConversionMatches(logical, logical.source, logical.target, definitions)) return undefined;
    const source = rustCallableProtocol(logical.source)!;
    const target = rustCallableProtocol(logical.target) ?? rustClosureProtocol(logical.target);
    if (target === undefined || source.parameters.length !== actual.parameters.length) return undefined;
    const errors: RustNativeErrorSource<TargetTypeRef>[] = [{ identity: "invoke", variant: "Error0", errorType: actual.error }];
    const parameters: TargetTypeRef[] = [...target.parameters];
    const arguments_: RustCallablePhysicalValueConversionPreparation[] = [];
    for (const [index, parameter] of logical.parameters.entries()) {
      if (remaining-- <= 0) return undefined;
      const expected = actual.parameters[index]!;
      if (parameter.kind === "identity") {
        parameters[index] = expected;
        arguments_.push({ kind: "identity" });
      } else if (parameter.kind === "borrow") {
        if (expected.kind !== "reference" || expected.mutable || expected.lifetime !== undefined) return undefined;
        parameters[index] = expected.referent;
        arguments_.push({ kind: "borrow" });
      } else if (parameter.kind === "value" && parameter.conversion.kind !== "callable-adapter") {
        const contract = rustValueConversionContract(parameter.conversion, definitions);
        if (contract === undefined || !rustTargetTypeRefEquals(contract.target, expected)) return undefined;
        parameters[index] = contract.source;
        arguments_.push(valuePlan(contract, `parameter:${index}`));
      } else return undefined;
    }
    let result: TargetTypeRef;
    let resultPlan: RustCallablePhysicalValueConversionPreparation;
    if (logical.result.kind === "identity") {
      result = actual.result;
      resultPlan = { kind: "identity" };
    } else if (logical.result.kind === "absence" || logical.result.kind === "discard") {
      result = target.result;
      resultPlan = { kind: logical.result.kind };
    } else if (logical.result.kind === "value" && logical.result.conversion.kind === "callable-adapter") {
      const nestedSignature = sourceSignatureFor(actual.result);
      const nested = nestedSignature === undefined ? undefined : select(logical.result.conversion, nestedSignature, depth + 1);
      if (nested === undefined) return undefined;
      result = nested.carrier;
      resultPlan = { kind: "callable", conversion: nested };
    } else if (logical.result.kind === "value" && logical.result.conversion.kind !== "callable-adapter") {
      const contract = rustValueConversionContract(logical.result.conversion, definitions);
      if (contract === undefined || !rustTargetTypeRefEquals(contract.source, actual.result)) return undefined;
      result = contract.target;
      resultPlan = valuePlan(contract, "result");
    } else return undefined;
    const error = rustNativeErrorJoinTargetType(fileName, errors.map(source => source.errorType));
    if (error === undefined) return undefined;
    const signature = { parameters, result, error };
    const carrier = physicalTarget(logical.target, signature);
    return carrier === undefined ? undefined : snapshotClosedMetadata({ logical, source: actual, carrier,
      ...signature, arguments: arguments_, resultPlan, errors });

    function valuePlan(contract: RustValueConversionContract, identity: string): RustCallablePhysicalValueConversionPreparation {
      const errorType = conversionError(contract);
      if (errorType === undefined) return { kind: "value", contract };
      errors.push({ identity, variant: `Error${errors.length}`, errorType });
      return { kind: "value", contract, errorIdentity: identity };
    }
  };
  return select(conversion, source, 0);
}

export function rustCallableConversionErrorArities(
  conversion: RustCallableConversion,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): readonly number[] | undefined {
  const arities = new Set<number>();
  let remaining = 4096;
  const visit = (selected: RustCallableConversion, depth: number): boolean => {
    if (remaining-- <= 0 || depth > 128 || selected === null || typeof selected !== "object" ||
      !rustCallableConversionMatches(selected, selected.source, selected.target, definitions)) return false;
    let arity = 1;
    for (const part of [...selected.parameters, selected.result]) {
      if (remaining-- <= 0) return false;
      if (part.kind !== "value") continue;
      if (part.conversion.kind === "callable-adapter") {
        if (!visit(part.conversion, depth + 1)) return false;
      } else {
        const contract = rustValueConversionContract(part.conversion, definitions);
        if (contract === undefined) return false;
        if (conversionError(contract) !== undefined) arity += 1;
      }
    }
    if (arity > 1) arities.add(arity);
    return true;
  };
  return visit(conversion, 0) ? Object.freeze([...arities].sort((left, right) => left - right)) : undefined;
}

function conversionError(contract: RustValueConversionContract): TargetTypeRef | undefined {
  return !contract.fallible ? undefined : contract.errorBoundary === "provider-native"
    ? contract.errorCarrier : rustRuntimeErrorTargetType();
}

function physicalTarget(logical: TargetTypeRef, signature: RustCallablePhysicalSignature): TargetTypeRef | undefined {
  const result = rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([signature.result, signature.error]),
    [], undefined, [], undefined, []);
  const tuple: TargetTypeRef = { kind: "tuple", elements: signature.parameters };
  if (rustCallableInputProtocol(logical) !== undefined) return { kind: "closure", args: [tuple], result };
  if (logical.kind === "closure") return rustTargetTypeRefEquals(signature.error, rustRuntimeErrorTargetType())
    ? { ...logical, args: signature.parameters, result, fallible: false } : undefined;
  const lifetime = rustCallableProtocol(logical)?.lifetime;
  return logical.kind !== "target-named" || logical.id !== rustCallableTargetId || lifetime === undefined ? undefined
    : rustNamedTargetType(rustCallableTargetId, "rt::Callable", [rustLifetimeGenericArgument(lifetime),
      ...rustTypeGenericArguments([tuple, result])], [], undefined, [], undefined, []);
}

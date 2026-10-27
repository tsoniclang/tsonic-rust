import { closedMetadataKey, hasExactObjectKeys, isClosedMetadata, isDenseDataArray, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustRuntimeCallableTargetType, rustRuntimeErrorTargetType } from "../../target-model/types/carriers/runtime-carriers.js";
import { rustCallableInputProtocol, rustCallableProtocol, rustClosureProtocol } from "../../target-model/types/carriers/callables.js";
import { rustNamedTargetType, rustNamedTypeCarrierValue } from "../../target-model/types/carriers/native.js";
import { rustCallableTargetId, rustInfallibleTargetId } from "../../target-model/types/carriers/source-types.js";
import { isRustNeverCarrier } from "../../target-model/types/carriers/js.js";
import { rustProgramErrorOwner } from "../../target-model/types/carriers/program-errors.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustTypeGenericArguments } from "../../target-model/types/generic-arguments.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustNativeErrorJoinTargetType, type RustNativeErrorSource } from "../../target-model/types/native-error-joins.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { emptyRustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { type RustCallableConversion } from "../../target-model/conversions/callable.js";
import { rustCallableConversionMatches } from "./callable.js";
import { type RustValueConversionContract } from "../../target-model/conversions/contracts.js";
import { rustValueConversionContract } from "./contracts.js";
import { selectRustSourceValueConversion } from "./selection.js";
import type { RustCallbackOperationTemplate } from "../../target-model/operations/model.js";

import { rustCallableConversionSource, rustCallablePhysicalSignature, type RustCallablePhysicalConversion, type RustCallablePhysicalSignature, type RustCallablePhysicalValueConversion } from "../../target-model/conversions/callable-physical.js";
export function rustCallableConversionPhysical(
  conversion: RustCallableConversion,
  source: RustCallablePhysicalSignature,
  fileName: string,
  closureError: Extract<RustCallbackOperationTemplate["failure"], { readonly kind: "invocation" }>["resultError"] | undefined,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
  carriedError = false,
): RustCallablePhysicalConversion | undefined {
  let remaining = 4096;
  const select = (logical: RustCallableConversion, actual: RustCallablePhysicalSignature, depth: number,
    selectedClosureError: typeof closureError): RustCallablePhysicalConversion | undefined => {
    if (remaining-- <= 0 || depth > 128 || logical === null || typeof logical !== "object" ||
      actual === null || typeof actual !== "object" || !isClosedMetadata(actual) ||
      !hasExactObjectKeys(actual, ["parameters", "result", "error"]) || !isDenseDataArray(actual.parameters) ||
      !actual.parameters.every(isRustTargetTypeRef) || !isRustTargetTypeRef(actual.result) || !isRustTargetTypeRef(actual.error) ||
      !rustCallableConversionMatches(logical, logical.source, logical.target, definitions)) return undefined;
    const source = rustCallableConversionSource(logical.source)!;
    const target = rustCallableProtocol(logical.target) ?? rustClosureProtocol(logical.target);
    if (target === undefined || source.parameters.length !== actual.parameters.length) return undefined;
    if (logical.target.kind === "closure" && selectedClosureError === undefined ||
      logical.target.kind !== "closure" && selectedClosureError !== undefined) return undefined;
    const errorContract = logical.error === undefined ? undefined : rustValueConversionContract(logical.error, definitions);
    if (logical.error !== undefined && errorContract === undefined) return undefined;
    // A concrete invoked error is converted here; an abstract one (a native input's associated error) and the error of
    // a type-erased runtime callable are carried through the native error join unchanged.
    let errorPlan = !carriedError && errorContract !== undefined && rustTargetTypeRefEquals(errorContract.source, actual.error)
      ? errorContract : undefined;
    const targetError = "error" in target ? target.error
      : selectedClosureError?.kind === "native" ? selectedClosureError.carrier : undefined;
    if (logical.target.kind === "closure" && targetError !== undefined && !rustTargetTypeRefEquals(actual.error, targetError) &&
      !rustUninhabitedError(actual.error) && errorPlan === undefined) {
      const conversion = selectRustSourceValueConversion(actual.error, targetError, definitions);
      const contract = conversion === undefined ? undefined : rustValueConversionContract(conversion, definitions);
      if (contract === undefined || contract.fallible || contract.category !== "exact" || contract.sourceMode !== "value" ||
        !rustTargetTypeRefEquals(contract.source, actual.error) || !rustTargetTypeRefEquals(contract.target, targetError)) return undefined;
      errorPlan = contract;
    }
    const eliminated = errorPlan === undefined && targetError !== undefined &&
      rustProgramErrorOwner(targetError)?.kind !== "logical" &&
      !rustTargetTypeRefEquals(actual.error, targetError) && rustUninhabitedError(actual.error);
    const errors: RustNativeErrorSource<TargetTypeRef>[] = [{ identity: "invoke", variant: "Error0",
      errorType: eliminated ? targetError! : errorPlan?.target ?? actual.error }];
    const parameters: TargetTypeRef[] = [...target.parameters];
    const arguments_: RustCallablePhysicalValueConversion[] = [];
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
    let resultPlan: RustCallablePhysicalValueConversion;
    if (logical.result.kind === "identity") {
      result = actual.result;
      resultPlan = { kind: "identity" };
    } else if (logical.result.kind === "absence" || logical.result.kind === "discard") {
      result = target.result;
      resultPlan = { kind: logical.result.kind };
    } else if (logical.result.kind === "value" && logical.result.conversion.kind === "callable-adapter") {
      const nestedSignature = rustCallablePhysicalSignature(actual.result);
      const nested = nestedSignature === undefined ? undefined : select(logical.result.conversion, nestedSignature, depth + 1,
        logical.result.conversion.target.kind === "closure" ? { kind: "native", carrier: rustRuntimeErrorTargetType() } : undefined);
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
    if (logical.target.kind === "closure" && targetError !== undefined && !rustTargetTypeRefEquals(error, targetError)) return undefined;
    const signature = { parameters, result, error };
    const carrier = physicalTarget(logical.target, signature);
    return carrier === undefined ? undefined : snapshotClosedMetadata({ logical, source: actual, carrier,
      ...signature, arguments: arguments_, resultPlan, errors, ...(errorPlan === undefined ? {} : { errorPlan }),
      ...(eliminated ? { eliminatedInvokeError: true as const } : {}) });

    function valuePlan(contract: RustValueConversionContract, identity: string): RustCallablePhysicalValueConversion {
      const errorType = conversionError(contract);
      if (errorType === undefined) return { kind: "value", contract };
      errors.push({ identity, variant: `Error${errors.length}`, errorType });
      return { kind: "value", contract, errorIdentity: identity };
    }
  };
  return select(conversion, source, 0, closureError);
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
  const result = rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([signature.result, signature.error]));
  const tuple: TargetTypeRef = { kind: "tuple", elements: signature.parameters };
  if (rustCallableInputProtocol(logical) !== undefined) return { kind: "closure", args: [tuple], result };
  if (logical.kind === "closure") return { ...logical, args: signature.parameters, result, fallible: false };
  const lifetime = rustCallableProtocol(logical)?.lifetime;
  return logical.kind !== "target-named" || logical.id !== rustCallableTargetId || lifetime === undefined ? undefined
    : rustRuntimeCallableTargetType(lifetime, signature.parameters, result);
}

// Distinct producers stored in one place share one boxed callable of their shared signature (RULINGS ruling 2). The
// producers must agree on lifetime, parameters and result. Their resolved errors must be one inhabited error, which the
// shared callable carries, or uninhabited, which each such producer's write eliminates.
export function rustCallableErrorJoin(
  alternatives: readonly { readonly physical: TargetTypeRef; readonly error: TargetTypeRef }[],
): TargetTypeRef | undefined {
  const first = rustNamedTypeCarrierValue(alternatives[0]?.physical);
  const lifetime = first?.genericArguments?.[0];
  const signature = alternatives[0] === undefined ? undefined : rustCallablePhysicalSignature(alternatives[0].physical);
  if (first?.id !== rustCallableTargetId || lifetime?.kind !== "lifetime" || signature === undefined || alternatives.length > 4096) return undefined;
  let error: TargetTypeRef | undefined;
  for (const alternative of alternatives) {
    const selected = rustCallablePhysicalSignature(alternative.physical);
    const named = rustNamedTypeCarrierValue(alternative.physical);
    if (selected === undefined || named?.id !== rustCallableTargetId ||
      closedMetadataKey(named.genericArguments?.[0]) !== closedMetadataKey(lifetime) ||
      selected.parameters.length !== signature.parameters.length ||
      !selected.parameters.every((parameter, index) => rustTargetTypeRefEquals(parameter, signature.parameters[index])) ||
      !rustTargetTypeRefEquals(selected.result, signature.result)) return undefined;
    if (rustUninhabitedError(alternative.error)) continue;
    if (error !== undefined && !rustTargetTypeRefEquals(error, alternative.error)) return undefined;
    error = alternative.error;
  }
  const result = rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([signature.result,
    error ?? { kind: "target-named", id: rustInfallibleTargetId }]));
  return snapshotClosedMetadata(rustRuntimeCallableTargetType(lifetime.lifetime, signature.parameters, result));
}

export function rustUninhabitedError(error: TargetTypeRef): boolean {
  const named = error.kind === "target-named" ? error : rustNamedTypeCarrierValue(error);
  return isRustNeverCarrier(error) || named?.id === rustInfallibleTargetId && (named.genericArguments?.length ?? 0) === 0;
}

// The same boxed callable carrying another error; an independent frame family member with an uninhabited error is
// written into its family's callable this way.
export function rustCallableWithError(physical: TargetTypeRef, error: TargetTypeRef): TargetTypeRef | undefined {
  const named = rustNamedTypeCarrierValue(physical);
  const lifetime = named?.genericArguments?.[0];
  const signature = rustCallablePhysicalSignature(physical);
  if (named?.id !== rustCallableTargetId || lifetime?.kind !== "lifetime" || signature === undefined) return undefined;
  const result = rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([signature.result, error]));
  return snapshotClosedMetadata(rustRuntimeCallableTargetType(lifetime.lifetime, signature.parameters, result));
}

// The physical boxed callable a declared callable protocol carrier denotes: `Callable<'l, (P..), Result<R, E>>`.
// A concrete callable parameter is passed in this form, so its storage and invocation read its physical error.
export function rustCallablePhysicalCarrier(declared: TargetTypeRef): TargetTypeRef | undefined {
  if (rustCallablePhysicalSignature(declared) !== undefined) return declared;
  if (declared.kind !== "target-named" || declared.id !== rustCallableTargetId) return undefined;
  const lifetime = declared.genericArguments?.[0];
  const types = declared.genericArguments?.slice(1).map(argument => argument.kind === "type" ? argument.type : undefined);
  const [parameters, result, error] = types ?? [];
  if ( lifetime?.kind !== "lifetime" || types?.length !== 3 || parameters?.kind !== "tuple" ||
    result === undefined || error === undefined) return undefined;
  return snapshotClosedMetadata(rustRuntimeCallableTargetType(lifetime.lifetime, parameters.elements,
    rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([result, error]))));
}

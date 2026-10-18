import type { RustCompilerFunction, RustCompilerType } from "../model/model.js";
import { rustCompilerTypeSemanticKey } from "../model/rustdoc-types.js";
import type { RustNativeResultLoanContract } from "../../../target-model/operations/result-loans.js";
import { compilerFunctionResult } from "./representability.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { substituteRustCompilerType, substituteRustCompilerArgument, substituteRustCompilerTrait } from "../model/rustdoc-types.js";
import type { RustCompilerNativeDeclarationProjection, RustCompilerNativeTypeProjection,
  RustNativeResultRetentionRequest } from "./model.js";
import type { RustCompilerGenericArgument, RustCompilerNativeRetentionQuestion,
  RustCompilerLifetime } from "../model/model.js";
import type { TargetTypeRef, RustTargetGenericArgument } from "../../../target-model/types/model.js";
import { rustNamedTypeCarrierValue } from "../../../target-model/types/carriers/native.js";
import { rustLifetimeKey } from "../../../target-model/lifetimes/index.js";
import { sourcePrimitiveByRustName } from "./model.js";

export function projectRustNativeResultLoans(
  fn: RustCompilerFunction, valueType: RustCompilerType,
): RustNativeResultLoanContract {
  const selected = compilerFunctionResult(fn.result);
  if (selected.type !== valueType) throw new Error("Native result-loan projection requires its original selected result type.");
  const contract = fn.resultLoans;
  if (!selected.fallible) return contract;
  return Object.freeze({ ...contract, valueTypeIdentity: rustCompilerTypeSemanticKey(valueType),
    loans: Object.freeze(contract.loans.filter(loan => loan.resultPath[0] === "argument:0").map(loan =>
      Object.freeze({ ...loan, resultPath: Object.freeze(loan.resultPath.slice(1)) }))),
  });
}

export function projectRustNativeExplicitReceiverResultLoans(contract: RustNativeResultLoanContract): RustNativeResultLoanContract {
  type Origin = import("../../../target-model/operations/result-loans.js").RustNativeResultLoanOrigin;
  const transported = new Map<Origin, Origin>();
  const transport = (origin: Origin): Origin => {
    let selected = transported.get(origin);
    if (selected === undefined) {
      selected = Object.freeze({ ...origin, input: projectRustNativeExplicitReceiverInput(origin.input) });
      transported.set(origin, selected);
    }
    return selected;
  };
  return Object.freeze({ ...contract, loans: Object.freeze(contract.loans.map(loan => Object.freeze({ ...loan,
    origins: Object.freeze(loan.origins.map(transport)),
  }))), inputLoans: Object.freeze({ ...contract.inputLoans, origins: Object.freeze(contract.inputLoans.origins.map(transport)) }) });
}

export function projectRustNativeExplicitReceiverInput(input: import("../../../target-model/operations/result-loans.js").RustNativeResultLoanOrigin["input"]):
  Extract<typeof input, { readonly kind: "argument" }> {
  return Object.freeze({ kind: "argument", sourceIndex: input.kind === "receiver" ? 0 : input.sourceIndex + 1 });
}

export function projectRustNativeResultRetentionQuestion(
  request: RustNativeResultRetentionRequest, declaration: RustCompilerNativeDeclarationProjection,
  applications: readonly RustCompilerNativeTypeProjection[],
): RustCompilerNativeRetentionQuestion {
  const fn = declaration.declaration;
  if (fn.identity.itemId !== request.declarationIdentity || rustCompilerTypeSemanticKey(compilerFunctionResult(fn.result).type) !== request.resultTypeIdentity)
    throw new Error("A native retention request requires its exact original declaration and selected native result identity.");
  const original = fn.resultLoans.inputLoans.origins.find(origin =>
    closedMetadataKey(origin) === closedMetadataKey(request.origin));
  if (original === undefined) throw new Error("A native retention request has a foreign declared input/lifetime relation.");
  const types = new Map<string, RustCompilerType>();
  const consts = new Map<string, import("../model/model.js").RustCompilerConstArgument>();
  const parameters = declaration.parameters.map(row => row.native);
  const applicationIdentity = closedMetadataKey({
    declaration: fn.identity, result: request.resultTypeIdentity, phase: request.phase,
    arguments: request.arguments,
    types: [...request.application.types], lifetimes: [...request.application.lifetimes], consts: [...request.application.consts],
  });
  for (const row of declaration.parameters) {
    const argumentIndex = fn.genericParameters.indexOf(row.native);
    const argument = argumentIndex < 0 ? undefined : request.arguments[argumentIndex];
    if (row.native.kind === "type" && row.projected.kind === "type") {
      const actual = argument?.kind === "type" ? argument.type : request.application.types.get(row.projected.targetIdentity);
      if (actual !== undefined && !(actual.kind === "type-parameter" && actual.identity === row.projected.targetIdentity))
        types.set(row.native.identity.itemId, nativeType(actual));
    } else if (row.native.kind === "const" && row.projected.kind === "const") {
      const actual = argument?.kind === "const" ? argument.value : request.application.consts.get(row.projected.targetIdentity);
      if (actual !== undefined) {
        if (actual.kind === "parameter" || actual.kind === "infer") throw new Error("Native retention requires its actual normalized const argument, not an unresolved target substitution.");
        consts.set(row.native.identity.itemId, actual);
      }
    }
  }
  const substitutions = { types, consts, lifetimes: new Map<string, RustCompilerLifetime>() };
  const resultType = substituteRustCompilerType(compilerFunctionResult(fn.resultLoanTypes.result).type, substitutions);
  const lifetime = fn.resultLoanTypes.lifetimes.find(value => value.key === original.lifetime)?.lifetime;
  if (lifetime === undefined || lifetime.kind === "static" || lifetime.kind === "placeholder")
    throw new Error("A native retention question has no exact applied result lifetime corresponding to its original input relation.");
  const inputType = original.input.kind === "receiver" ? fn.receiver?.type :
    fn.receiver?.kind === "custom" ? original.input.sourceIndex === 0 ? fn.receiver.type : fn.parameters[original.input.sourceIndex - 1]?.type
      : fn.parameters[original.input.sourceIndex]?.type;
  if (inputType === undefined) throw new Error("A native retention question has no original native input type.");
  const appliedInput = substituteRustCompilerType(inputType, substitutions);
  const referent = appliedInput.kind === "reference" ? appliedInput.target : { kind: "unit" as const };
  const remaining: RustCompilerNativeRetentionQuestion["parameters"][number][] = parameters.filter(parameter => parameter.kind === "lifetime" ||
    !(parameter.kind === "type" ? types.has(parameter.identity.itemId) : consts.has(parameter.identity.itemId)));
  for (const row of fn.resultLoanTypes.lifetimes) {
    const lifetime = row.lifetime;
    if (lifetime.kind === "elided" && !remaining.some(parameter => parameter.kind === "lifetime" &&
      parameter.lifetime.kind === "elided" && parameter.lifetime.ownerIdentity === lifetime.ownerIdentity &&
      parameter.lifetime.position === lifetime.position)) {
      remaining.push({ kind: "lifetime", lifetime, outlives: [] });
    }
  }
  return Object.freeze({ id: request.id, declaration: fn.identity, dependency: declaration.dependency,
    applicationIdentity, resultType, phase: request.phase, origin: Object.freeze({ lifetime, referent, mutable: original.mutable }),
    invocation: Object.freeze({ path: declaration.publicPath,
      ownerArguments: Object.freeze(declaration.ownerParameters.map(parameterArgument)),
      method: declaration.method,
      trait: fn.traitDispatch === undefined ? undefined : substituteRustCompilerTrait(fn.traitDispatch, substitutions),
      inputs: Object.freeze(fn.resultLoanTypes.inputs.map(row => Object.freeze({ input: row.input,
        type: substituteRustCompilerType(row.type, substitutions) }))),
      genericArguments: Object.freeze(fn.genericParameters.filter(parameter => parameter.kind !== "lifetime").map(parameterArgument)),
      selectedInput: original.input, selectedKind: original.kind, asynchronous: fn.asynchronous, unsafe: fn.unsafe,
      fallible: compilerFunctionResult(fn.result).fallible,
    }),
    parameters: Object.freeze(remaining), requirements: Object.freeze(fn.typeRequirements.filter(parameter => !types.has(parameter.identity.itemId))) });

  function parameterArgument(parameter: import("../model/model.js").RustCompilerGenericParameter): RustCompilerGenericArgument {
    return substituteRustCompilerArgument(parameter.kind === "type"
      ? { kind: "type", type: { kind: "generic", identity: parameter.identity, name: parameter.name } }
      : parameter.kind === "lifetime" ? { kind: "lifetime", lifetime: parameter.lifetime }
        : { kind: "const", value: { kind: "parameter", identity: parameter.identity, name: parameter.name } }, substitutions);
  }

  function nativeType(actual: TargetTypeRef): RustCompilerType {
    if (actual.kind === "source-primitive") {
      const primitive = [...sourcePrimitiveByRustName].find(([, source]) => source === actual.name);
      if (primitive !== undefined) return { kind: "primitive", name: primitive[0] };
    }
    for (const projected of applications) {
      if (rustTargetTypeRefEquals(projected.target, actual)) return projected.native;
    }
    if (actual.kind === "type-parameter") {
      const found = declaration.parameters.find(row => row.native.kind === "type" && row.projected.targetIdentity === actual.identity);
      if (found?.native.kind === "type") return { kind: "generic", identity: found.native.identity, name: found.native.name };
    }
    if (actual.kind === "tuple") return { kind: "tuple", elements: actual.elements.map(nativeType) };
    const actualNamed = rustNamedTypeCarrierValue(actual);
    if (actual.kind === "target-named" || actualNamed !== undefined) {
      const identity = actualNamed?.id ?? (actual.kind === "target-named" ? actual.id : undefined);
      const candidates = applications.filter(row => (row.target.kind === "target-named" && row.target.id === identity ||
        rustNamedTypeCarrierValue(row.target)?.id === identity) && row.native.kind === "path");
      const identities = new Set(candidates.map(row => row.native.kind === "path" ? row.native.identity.itemId : ""));
      const found = candidates[0];
      if (found?.native.kind === "path" && identities.size === 1) {
        const arguments_ = actualNamed?.genericArguments ?? (actual.kind === "target-named" ? actual.genericArguments ?? [] : []);
        const originalArguments = found.native.genericArguments;
        const projectedArguments = rustNamedTypeCarrierValue(found.target)?.genericArguments ??
          (found.target.kind === "target-named" ? found.target.genericArguments ?? [] : []);
        if (arguments_.length !== originalArguments.length || projectedArguments.length !== arguments_.length)
          throw new Error("Native retention requires the complete forward native type argument/default projection.");
        return { ...found.native, genericArguments: arguments_.map((argument, index) => nativeArgument(argument, originalArguments[index]!)) };
      }
    }
    throw new Error("Native retention lacks the original native type application for an actual selected generic argument.");
  }
  function nativeArgument(actual: RustTargetGenericArgument, original: RustCompilerGenericArgument): RustCompilerGenericArgument {
    if (actual.kind === "type" && original.kind === "type") return { kind: "type", type: nativeType(actual.type) };
    if (actual.kind === "const" && original.kind === "const" && actual.value.kind !== "parameter" && actual.value.kind !== "infer")
      return { kind: "const", value: actual.value };
    if (actual.kind === "lifetime" && original.kind === "lifetime") {
      if (actual.lifetime.kind === "static") return { kind: "lifetime", lifetime: { kind: "static" } };
      const target = declaration.parameters.find(row => row.native.kind === "lifetime" && row.projected.kind === "lifetime" &&
        row.projected.targetIdentity === rustLifetimeKey(actual.lifetime));
      if (target?.native.kind === "lifetime") return { kind: "lifetime", lifetime: target.native.lifetime };
      throw new Error("Native retention lacks the original forward native binder for an applied lifetime.");
    }
    throw new Error("Native retention generic argument differs from its exact normalized native declaration kind.");
  }
}

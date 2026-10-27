import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { AstReader, Node } from "@tsonic/tsts";
import { sourceCallableValueParameters, type TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustCallableParameterAbi } from "../../../target-model/records/callables/callable-adapters.js";

import { rustCallableInvocationResult } from "../../../policy/types/callables/return-contexts.js";
import type { RustProjectTypeDefinition } from "../../project-types/index.js";
import { rustCallableProtocol, rustClosureProtocol, rustSourceTypeCarrierValue, rustTargetGenericTypeArguments, substituteRustTargetTypeParameters } from "../../../target-model/types/index.js";

export function sourceCallableParameterAbis(
  input: { readonly ast: AstReader; readonly source: TargetSourceProgram; readonly records: RustProgramRecords },
  callable: Node,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
): RustCallableParameterAbi[] | undefined {
  const parameters = sourceCallableValueParameters(input.ast, callable, input.source.semantics.forNode(callable));
  if (parameters === undefined) {
    return undefined;
  }
  const abis = parameters.map((parameter) => {
    const abi = input.records.sourceParameterAbi.get(parameter);
    return abi === undefined ? undefined : substituteRustCallableParameterAbi(abi, substitutions);
  });
  return abis.some((abi) => abi === undefined)
    ? undefined
    : abis as RustCallableParameterAbi[];
}

export function sourceCallableReturnCarrier(
  input: { readonly records: RustProgramRecords },
  callable: Node,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
): TargetTypeRef | undefined {
  const retainedResult = rustCallableInvocationResult(input.records, callable);
  const operation = retainedResult === undefined
    ? input.records.targetOperation.get(callable)
    : undefined;
  const operationReturn = operation?.kind === "closure"
    ? rustClosureProtocol(operation.resultCarrier)?.result ??
      rustCallableProtocol(operation.resultCarrier)?.result ??
      (operation.resultCarrier.kind === "function-pointer" ? operation.resultCarrier.result : undefined)
    : undefined;
  const returnCarrier = retainedResult ?? operationReturn;
  return returnCarrier === undefined
    ? undefined
    : substituteRustTargetTypeParameters(returnCarrier, substitutions);
}

export function substituteRustCallableParameterAbi(
  abi: RustCallableParameterAbi,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
): RustCallableParameterAbi {
  return Object.freeze({
    form: abi.form,
    valueCarrier: substituteRustTargetTypeParameters(abi.valueCarrier, substitutions),
    parameterCarrier: substituteRustTargetTypeParameters(abi.parameterCarrier, substitutions),
    mode: abi.mode,
    ...(abi.entryConversion === undefined ? {} : { entryConversion: abi.entryConversion }),
  });
}

export function projectOwnerTypeSubstitutions(
  owner: RustProjectTypeDefinition,
  carrier: TargetTypeRef,
): Map<string, TargetTypeRef> {
  const value = rustSourceTypeCarrierValue(carrier);
  const typeArguments = rustTargetGenericTypeArguments(value?.genericArguments);
  if (typeArguments.length !== owner.typeParameterIdentities.length) {
    failTargetAnalysisInvariant("tsonic-rust", "Callable owner arguments do not match the sealed project type-parameter arity.", owner.declaration);
  }
  return new Map(owner.typeParameterIdentities.map((name, index) =>
    [name, typeArguments[index]!] as const));
}

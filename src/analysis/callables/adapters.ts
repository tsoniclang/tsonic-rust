import type { AstReader, Node } from "@tsonic/tsts";
import type { RustPlanBuilder } from "../facts/plan-store.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustCallableParameterAbi, RustCallableParameterAdapter, RustCallableRestSegment, RustCallableValueAdapter } from "../facts/callable-adapters.js";
import { rustSourceParameterAbiFactKey, rustTargetOperationFactKey } from "../facts/keys.js";
import { rustCallableInvocationResult } from "../facts/callable-results.js";
import type { RustProjectTypeDefinition, RustProjectTypePolicy } from "../project-types/type-policy.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { isRustCopyCarrier, rustCallableProtocol, rustCarrierSupportsClone, rustClosureProtocol, rustOptionElementCarrier, rustSourceTypeCarrierValue, rustTargetGenericTypeArguments, substituteRustTargetTypeParameters } from "../../target-model/types/index.js";
import { rustRestSequenceElements } from "../../target-model/operations/rest-assembly.js";
import { selectRustValueCarrierReconciliation } from "../../policy/types/value-carrier-reconciliation.js";
import { rustContextualValueConversionIsFallible } from "../../target-model/conversions/contextual.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { isRustUnitCarrier } from "../../target-model/types/index.js";

export function sourceCallableParameterAbis(
  input: { readonly ast: AstReader; readonly facts: RustPlanBuilder },
  callable: Node,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
): RustCallableParameterAbi[] | undefined {
  const parameters = input.ast.parameters(callable);
  if (!isDenseDataArray(parameters) || parameters.some((parameter) => parameter === undefined)) {
    return undefined;
  }
  const abis = (parameters as readonly Node[]).map((parameter) => {
    const abi = input.facts.get(parameter, rustSourceParameterAbiFactKey) ??
      input.facts.resolve(parameter, rustSourceParameterAbiFactKey);
    return abi === undefined ? undefined : substituteRustCallableParameterAbi(abi, substitutions);
  });
  return abis.some((abi) => abi === undefined)
    ? undefined
    : abis as RustCallableParameterAbi[];
}

export function sourceCallableReturnCarrier(
  input: { readonly facts: RustPlanBuilder },
  callable: Node,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
): TargetTypeRef | undefined {
  const retainedResult = rustCallableInvocationResult(input.facts, callable);
  const operation = retainedResult === undefined
    ? input.facts.get(callable, rustTargetOperationFactKey) ??
      input.facts.resolve(callable, rustTargetOperationFactKey)
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
    throw new Error("Callable owner arguments do not match the sealed project type-parameter arity.");
  }
  return new Map(owner.typeParameterIdentities.map((name, index) =>
    [name, typeArguments[index]!] as const));
}

export function selectRustCallableParameterAdapters(
  contractParameters: readonly RustCallableParameterAbi[],
  implementationParameters: readonly RustCallableParameterAbi[],
  projectTypes: RustProjectTypePolicy,
  definitions: RustTypeDefinitions,
): RustCallableParameterAdapter[] | undefined {
  const wellFormed = (parameters: readonly RustCallableParameterAbi[]) => isDenseDataArray(parameters) &&
    parameters.every((parameter, index) => parameter.form !== "rest" || index === parameters.length - 1 &&
      parameter.mode === "value" && callableRestElement(parameter.parameterCarrier) !== undefined);
  if (!wellFormed(contractParameters) || !wellFormed(implementationParameters)) return undefined;
  const adapters: RustCallableParameterAdapter[] = [];
  let sourceIndex = 0;
  let restOffset = 0;
  for (const target of implementationParameters) {
    const source = contractParameters[sourceIndex];
    const runtimeAdapter = source === undefined ? undefined : selectRustCallableValueAdapter(
      source.parameterCarrier, target.parameterCarrier, projectTypes, definitions,
    );
    if (source !== undefined && restOffset === 0 && runtimeAdapter !== undefined &&
      (source.form === "rest") === (target.form === "rest") &&
      (source.mode === target.mode || source.mode === "mut-ref" && target.mode === "ref")) {
      adapters.push(Object.freeze({
        kind: "runtime-value",
        contractParameterIndex: sourceIndex,
        source,
        target,
        adapter: runtimeAdapter,
      }));
      sourceIndex += 1;
      continue;
    }
    if (target.form === "rest") {
      const element = callableRestElement(target.parameterCarrier);
      if (element === undefined) return undefined;
      const segments: RustCallableRestSegment[] = [];
      for (; sourceIndex < contractParameters.length; sourceIndex += 1) {
        const source = contractParameters[sourceIndex]!;
        const sourceElement = source.form === "rest" ? callableRestElement(source.parameterCarrier) : source.valueCarrier;
        const adapter = sourceElement === undefined ? undefined :
          selectRustCallableValueAdapter(sourceElement, element, projectTypes, definitions);
        if (adapter === undefined || source.form !== "required" && source.form !== "rest") return undefined;
        segments.push(Object.freeze(source.form === "rest"
          ? { kind: "sequence", contractParameterIndex: sourceIndex, source, offset: restOffset, adapter }
          : { kind: "value", contractParameterIndex: sourceIndex, source, adapter }));
      }
      adapters.push(Object.freeze({ kind: "rest", segments: Object.freeze(segments), target }));
      continue;
    }
    if (source === undefined) {
      if (target.form !== "optional" && target.form !== "default") {
        return undefined;
      }
      adapters.push(Object.freeze({ kind: "omitted", target }));
      continue;
    }
    if (source.form !== "required" && source.form !== "rest" ||
      source.mode !== "value" && !isRustCopyCarrier(source.valueCarrier) &&
        !rustCarrierSupportsClone(source.valueCarrier, definitions)) {
      return undefined;
    }
    const targetLogicalCarrier = target.form === "optional"
      ? rustOptionElementCarrier(target.parameterCarrier)
      : target.valueCarrier;
    const sourceLogicalCarrier = source.form === "rest" ? callableRestElement(source.parameterCarrier) : source.valueCarrier;
    const logicalAdapter = targetLogicalCarrier === undefined || sourceLogicalCarrier === undefined
      ? undefined
      : selectRustCallableValueAdapter(sourceLogicalCarrier, targetLogicalCarrier, projectTypes, definitions);
    if (logicalAdapter === undefined) {
      return undefined;
    }
    adapters.push(Object.freeze(source.form === "rest"
      ? { kind: "rest-element", contractParameterIndex: sourceIndex, source, offset: restOffset++, target, adapter: logicalAdapter }
      : { kind: "logical-value", contractParameterIndex: sourceIndex++, source, target, adapter: logicalAdapter }));
  }
  return adapters;
}

export function callableRestElement(carrier: TargetTypeRef): TargetTypeRef | undefined {
  const sequence = rustRestSequenceElements(carrier);
  return sequence?.collection === "vec" || sequence?.collection === "js-array" ? sequence.elements[0] : undefined;
}

export function selectRustCallableValueAdapter(
  sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
  projectTypes: RustProjectTypePolicy,
  definitions: RustTypeDefinitions,
): RustCallableValueAdapter | undefined {
  if (rustTargetTypeRefEquals(sourceCarrier, targetCarrier)) {
    return Object.freeze({ kind: "identity", sourceCarrier, targetCarrier });
  }
  const sourceOption = rustOptionElementCarrier(sourceCarrier);
  const targetOption = rustOptionElementCarrier(targetCarrier);
  if (targetOption !== undefined && isRustUnitCarrier(sourceCarrier)) {
    return Object.freeze({ kind: "absent-completion", sourceCarrier, targetCarrier });
  }
  if (targetOption !== undefined && sourceOption === undefined) {
    const element = selectRustCallableValueAdapter(sourceCarrier, targetOption, projectTypes, definitions);
    return element === undefined
      ? undefined
      : Object.freeze({ kind: "option-some", sourceCarrier, targetCarrier, element });
  }
  if (sourceOption !== undefined && targetOption !== undefined) {
    const element = selectRustCallableValueAdapter(sourceOption, targetOption, projectTypes, definitions);
    return element === undefined
      ? undefined
      : Object.freeze({ kind: "option-map", sourceCarrier, targetCarrier, element });
  }
  const selected = selectRustValueCarrierReconciliation(sourceCarrier, targetCarrier, projectTypes, definitions);
  switch (selected.kind) {
    case "identity":
      return Object.freeze({ kind: "identity", sourceCarrier, targetCarrier });
    case "conversion":
      return Object.freeze({
        kind: "conversion",
        sourceCarrier,
        targetCarrier,
        conversion: selected.fact.conversion,
      });
    case "project-upcast":
      return Object.freeze({ kind: "project-upcast", sourceCarrier, targetCarrier });
    case "call-scoped-lifetime":
      return Object.freeze({ kind: "call-scoped-lifetime", sourceCarrier, targetCarrier });
    case "incompatible":
      return undefined;
  }
}

export function rustCallableValueAdapterIsFallible(adapter: RustCallableValueAdapter, definitions: RustTypeDefinitions = emptyRustTypeDefinitions): boolean {
  switch (adapter.kind) {
    case "conversion":
      return rustContextualValueConversionIsFallible(adapter.conversion, definitions);
    case "option-some":
    case "option-map":
      return rustCallableValueAdapterIsFallible(adapter.element, definitions);
    case "identity":
    case "absent-completion":
    case "call-scoped-lifetime":
    case "project-upcast":
    case "project-structural-view":
      return false;
  }
}

export function rustCallableParameterAdapterIsFallible(
  adapter: RustCallableParameterAdapter,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): boolean {
  switch (adapter.kind) {
    case "runtime-value":
    case "logical-value":
    case "rest-element":
      return rustCallableValueAdapterIsFallible(adapter.adapter, definitions);
    case "rest":
      return adapter.segments.some(segment => rustCallableValueAdapterIsFallible(segment.adapter, definitions));
    case "omitted":
      return false;
  }
}

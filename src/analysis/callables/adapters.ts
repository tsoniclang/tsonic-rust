import type { AstReader, Node } from "@tsonic/tsts";
import type { RustPlanBuilder } from "../facts/plan-store.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustCallableParameterAbi, RustCallableParameterAdapter, RustCallableValueAdapter } from "../facts/callable-adapters.js";
import { rustSourceCallableReturnFactKey, rustSourceParameterAbiFactKey, rustTargetOperationFactKey } from "../facts/keys.js";
import type { RustProjectTypeDefinition, RustProjectTypePolicy } from "../project-types/type-policy.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { isRustCopyCarrier, isRustVecCarrier, rustCallableProtocol, rustCarrierSupportsClone, rustClosureProtocol, rustOptionElementCarrier, rustSourceTypeCarrierValue, rustTargetGenericTypeArguments, substituteRustTargetTypeParameters } from "../../target-model/types/index.js";
import { selectRustValueCarrierReconciliation } from "../../policy/types/value-carrier-reconciliation.js";
import { rustContextualValueConversionIsFallible } from "../../target-model/conversions/contextual.js";

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
  const fact = input.facts.get(callable, rustSourceCallableReturnFactKey) ??
    input.facts.resolve(callable, rustSourceCallableReturnFactKey);
  const operation = fact === undefined
    ? input.facts.get(callable, rustTargetOperationFactKey) ??
      input.facts.resolve(callable, rustTargetOperationFactKey)
    : undefined;
  const operationReturn = operation?.kind === "closure"
    ? rustClosureProtocol(operation.resultCarrier)?.result ??
      rustCallableProtocol(operation.resultCarrier)?.result ??
      (operation.resultCarrier.kind === "function-pointer" ? operation.resultCarrier.result : undefined)
    : undefined;
  const returnCarrier = fact?.returnCarrier ?? operationReturn;
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
  });
}

export function projectOwnerTypeSubstitutions(
  owner: RustProjectTypeDefinition,
  carrier: TargetTypeRef,
): Map<string, TargetTypeRef> {
  const value = rustSourceTypeCarrierValue(carrier);
  const typeArguments = rustTargetGenericTypeArguments(value?.genericArguments);
  if (typeArguments.length !== owner.typeParameterNames.length) {
    throw new Error("Callable owner arguments do not match the sealed project type-parameter arity.");
  }
  return new Map(owner.typeParameterNames.map((name, index) =>
    [name, typeArguments[index]!] as const));
}

export function selectRustCallableParameterAdapters(
  contractParameters: readonly RustCallableParameterAbi[],
  implementationParameters: readonly RustCallableParameterAbi[],
  projectTypes: RustProjectTypePolicy,
): RustCallableParameterAdapter[] | undefined {
  const adapters: RustCallableParameterAdapter[] = [];
  for (const [implementationIndex, target] of implementationParameters.entries()) {
    if (target.form === "rest") {
      if (!isRustVecCarrier(target.parameterCarrier)) {
        return undefined;
      }
      const targetElementCarrier = target.parameterCarrier.element;
      const remaining = contractParameters.slice(implementationIndex);
      const sourceRest = remaining.length === 1 && remaining[0]?.form === "rest"
        ? remaining[0]
        : undefined;
      if (sourceRest !== undefined && isRustVecCarrier(sourceRest.parameterCarrier)) {
        const elementAdapter = selectRustCallableValueAdapter(
          sourceRest.parameterCarrier.element,
          targetElementCarrier,
          projectTypes,
        );
        if (elementAdapter === undefined) {
          return undefined;
        }
        adapters.push(Object.freeze({
          kind: "sequence-rest",
          contractParameterIndex: implementationIndex,
          source: sourceRest,
          target,
          elementAdapter,
        }));
        continue;
      }
      if (remaining.some((source) => source.form !== "required")) {
        return undefined;
      }
      const elementAdapters = remaining.map((source) =>
        selectRustCallableValueAdapter(source.valueCarrier, targetElementCarrier, projectTypes));
      if (elementAdapters.some((adapter) => adapter === undefined)) {
        return undefined;
      }
      adapters.push(Object.freeze({
        kind: "fixed-rest",
        contractParameterIndexes: Object.freeze(remaining.map((_source, index) => implementationIndex + index)),
        sources: Object.freeze(remaining),
        target,
        elementAdapters: Object.freeze(elementAdapters as RustCallableValueAdapter[]),
      }));
      continue;
    }
    const source = contractParameters[implementationIndex];
    if (source === undefined) {
      if (target.form !== "optional" && target.form !== "default") {
        return undefined;
      }
      adapters.push(Object.freeze({ kind: "omitted", target }));
      continue;
    }
    const runtimeAdapter = selectRustCallableValueAdapter(
      source.parameterCarrier,
      target.parameterCarrier,
      projectTypes,
    );
    if (runtimeAdapter !== undefined &&
      (source.mode === target.mode || source.mode === "mut-ref" && target.mode === "ref")) {
      adapters.push(Object.freeze({
        kind: "runtime-value",
        contractParameterIndex: implementationIndex,
        source,
        target,
        adapter: runtimeAdapter,
      }));
      continue;
    }
    if (source.form !== "required" ||
      source.mode !== "value" && !isRustCopyCarrier(source.valueCarrier) &&
        !rustCarrierSupportsClone(source.valueCarrier)) {
      return undefined;
    }
    const targetLogicalCarrier = target.form === "optional"
      ? rustOptionElementCarrier(target.parameterCarrier)
      : target.valueCarrier;
    const logicalAdapter = targetLogicalCarrier === undefined
      ? undefined
      : selectRustCallableValueAdapter(source.valueCarrier, targetLogicalCarrier, projectTypes);
    if (logicalAdapter === undefined) {
      return undefined;
    }
    adapters.push(Object.freeze({
      kind: "logical-value",
      contractParameterIndex: implementationIndex,
      source,
      target,
      adapter: logicalAdapter,
    }));
  }
  return adapters;
}

export function selectRustCallableValueAdapter(
  sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
  projectTypes: RustProjectTypePolicy,
): RustCallableValueAdapter | undefined {
  if (rustTargetTypeRefEquals(sourceCarrier, targetCarrier)) {
    return Object.freeze({ kind: "identity", sourceCarrier, targetCarrier });
  }
  const sourceOption = rustOptionElementCarrier(sourceCarrier);
  const targetOption = rustOptionElementCarrier(targetCarrier);
  if (targetOption !== undefined && sourceOption === undefined) {
    const element = selectRustCallableValueAdapter(sourceCarrier, targetOption, projectTypes);
    return element === undefined
      ? undefined
      : Object.freeze({ kind: "option-some", sourceCarrier, targetCarrier, element });
  }
  if (sourceOption !== undefined && targetOption !== undefined) {
    const element = selectRustCallableValueAdapter(sourceOption, targetOption, projectTypes);
    return element === undefined
      ? undefined
      : Object.freeze({ kind: "option-map", sourceCarrier, targetCarrier, element });
  }
  const selected = selectRustValueCarrierReconciliation(sourceCarrier, targetCarrier, projectTypes);
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

export function rustCallableValueAdapterIsFallible(adapter: RustCallableValueAdapter): boolean {
  switch (adapter.kind) {
    case "conversion":
      return rustContextualValueConversionIsFallible(adapter.conversion);
    case "option-some":
    case "option-map":
      return rustCallableValueAdapterIsFallible(adapter.element);
    case "identity":
    case "call-scoped-lifetime":
    case "project-upcast":
      return false;
  }
}

export function rustCallableParameterAdapterIsFallible(
  adapter: RustCallableParameterAdapter,
): boolean {
  switch (adapter.kind) {
    case "runtime-value":
    case "logical-value":
      return rustCallableValueAdapterIsFallible(adapter.adapter);
    case "fixed-rest":
      return adapter.elementAdapters.some(rustCallableValueAdapterIsFallible);
    case "sequence-rest":
      return rustCallableValueAdapterIsFallible(adapter.elementAdapter);
    case "omitted":
      return false;
  }
}

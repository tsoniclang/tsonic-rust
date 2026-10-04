import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type {
  RustCallbackOperationTemplate,
  RustProviderOperationTemplate,
} from "../../facts/keys.js";
import {
  rustCallableProtocol,
  rustFutureOutputCarrier,
} from "../../../target-model/types/index.js";
import { mapRustTargetTypes } from "../../../target-model/types/carriers/substitution.js";

export interface RustCallbackOperationSelection {
  readonly fact: RustProviderOperationTemplate;
  readonly resultCarrier?: TargetTypeRef;
  readonly parameterCarriers?: readonly (TargetTypeRef | undefined)[];
  readonly callback: RustCallbackOperationTemplate;
}

export function finalizeRustCallbackOperation(
  selection: RustCallbackOperationSelection,
  argumentCarriers: readonly TargetTypeRef[],
  acceptsConversion: (source: TargetTypeRef, target: TargetTypeRef) => boolean = () => false,
): RustCallbackOperationSelection | undefined {
  const callback = argumentCarriers[selection.callback.sourceArgumentIndex];
  const originalTemplate = selection.parameterCarriers?.[selection.callback.sourceArgumentIndex];
  const callbackTemplate = originalTemplate?.kind === "closure" && rustCallableProtocol(callback) !== undefined
    ? { ...originalTemplate, fallible: true as const } : originalTemplate;
  if (callbackTemplate !== originalTemplate) {
    selection = { ...selection, parameterCarriers: selection.parameterCarriers?.map((carrier, index) =>
      index === selection.callback.sourceArgumentIndex ? callbackTemplate : carrier) };
  }
  const callbackProtocol = rustCallbackProtocol(callback);
  if (callback === undefined || callbackTemplate === undefined || callbackProtocol === undefined) {
    return undefined;
  }
  if (selection.callback.shape === "map") {
    const selectedCallback = replaceRustInferCarrier(callbackTemplate, callbackProtocol.result);
    const selectedProtocol = rustCallbackProtocol(selectedCallback);
    if (selectedProtocol === undefined || !rustCallbackCarrierMatchesTemplate(selectedCallback, callback) &&
      !acceptsConversion(callback, selectedCallback)) return undefined;
    const output = selection.callback.resultProjection === "awaited"
      ? rustFutureOutputCarrier(selectedProtocol.result)
      : selectedProtocol.result;
    if (output === undefined) return undefined;
    const resultCarrier = replaceRustInferCarrier(selection.fact.resultCarrier, output);
    const parameterCarriers = [...(selection.parameterCarriers ?? [])];
    for (const [index, template] of parameterCarriers.entries()) {
      if (template === undefined) return undefined;
      const actual = argumentCarriers[index];
      const expected = replaceRustInferCarrier(template, selectedProtocol.result);
      if (actual !== undefined && !rustCallbackCarrierMatchesTemplate(expected, actual) &&
        !acceptsConversion(actual, expected)) return undefined;
      parameterCarriers[index] = expected;
    }
    return {
      ...selection,
      fact: {
        ...selection.fact,
        resultCarrier,
        parameterCarriers,
      },
      resultCarrier,
      parameterCarriers,
    };
  }
  if (selection.callback.shape === "direct") {
    const templates = selection.parameterCarriers ?? [];
    if (templates.length !== argumentCarriers.length || !templates.every((template, index) =>
      template !== undefined && argumentCarriers[index] !== undefined &&
      (rustCallbackCarrierMatchesTemplate(template, argumentCarriers[index]!) ||
        acceptsConversion(argumentCarriers[index]!, template)))) {
      return undefined;
    }
    return {
      ...selection,
      fact: { ...selection.fact, parameterCarriers: templates as readonly TargetTypeRef[] },
      parameterCarriers: templates,
    };
  }
  const accumulatorIndex = selection.callback.accumulatorArgumentIndex;
  const accumulator = accumulatorIndex === undefined
    ? undefined
    : argumentCarriers[accumulatorIndex];
  if (!rustCallbackCarrierMatchesTemplate(callbackTemplate, callback) && !acceptsConversion(callback, callbackTemplate) || accumulator === undefined ||
    (callbackProtocol.parameters[0] !== undefined &&
      !rustTargetTypeRefEquals(callbackProtocol.parameters[0], accumulator)) ||
    !rustTargetTypeRefEquals(callbackProtocol.result, accumulator)) {
    return undefined;
  }
  const parameterCarriers = [...argumentCarriers];
  parameterCarriers[selection.callback.sourceArgumentIndex] = callbackTemplate;
  return {
    ...selection,
    fact: {
      ...selection.fact,
      resultCarrier: accumulator,
      parameterCarriers,
    },
    resultCarrier: accumulator,
    parameterCarriers,
  };
}

export function rustCallbackProtocol(
  carrier: TargetTypeRef | undefined,
): { readonly representation: "closure" | "function-pointer" | "callable"; readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef; readonly fallible: boolean } | undefined {
  if (carrier?.kind === "closure") {
    return { representation: "closure", parameters: carrier.args, result: carrier.result, fallible: carrier.fallible === true };
  }
  if (carrier?.kind === "function-pointer") {
    return { representation: "function-pointer", parameters: carrier.args, result: carrier.result, fallible: false };
  }
  const callable = rustCallableProtocol(carrier);
  return callable === undefined
    ? undefined
    : { representation: "callable", parameters: callable.parameters, result: callable.result, fallible: true };
}

export function replaceRustInferCarrier(template: TargetTypeRef, replacement: TargetTypeRef): TargetTypeRef {
  return mapRustTargetTypes(template, carrier => carrier.kind === "opaque" && carrier.id === "tsonic.rust.infer"
    ? replacement : carrier);
}

function rustCallbackCarrierMatchesTemplate(
  template: TargetTypeRef,
  actual: TargetTypeRef,
): boolean {
  if (template.kind === "opaque" && template.id === "tsonic.rust.infer") {
    return true;
  }
  const templateProtocol = rustCallbackProtocol(template);
  const actualProtocol = rustCallbackProtocol(actual);
  if (templateProtocol !== undefined || actualProtocol !== undefined) {
    return templateProtocol !== undefined && actualProtocol !== undefined &&
      templateProtocol.representation === actualProtocol.representation &&
      templateProtocol.fallible === actualProtocol.fallible &&
      templateProtocol.parameters.length === actualProtocol.parameters.length &&
      templateProtocol.parameters.every((parameter, index) =>
        actualProtocol.parameters[index] !== undefined &&
        rustCallbackCarrierMatchesTemplate(parameter, actualProtocol.parameters[index]!)) &&
      rustCallbackCarrierMatchesTemplate(templateProtocol.result, actualProtocol.result);
  }
  return rustTargetTypeRefEquals(template, actual);
}

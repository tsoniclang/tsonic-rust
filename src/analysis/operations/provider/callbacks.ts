import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type {
  RustCallbackOperationTemplate,
  RustProviderOperationTemplate,
} from "../../facts/keys.js";
import {
  rustCallbackProtocol,
  rustJsArrayTargetType,
} from "../../../target-model/types/index.js";

export interface RustCallbackOperationSelection {
  readonly fact: RustProviderOperationTemplate;
  readonly resultCarrier?: TargetTypeRef;
  readonly parameterCarriers?: readonly (TargetTypeRef | undefined)[];
  readonly callback: RustCallbackOperationTemplate;
}

export function finalizeRustCallbackOperation(
  selection: RustCallbackOperationSelection,
  argumentCarriers: readonly TargetTypeRef[],
): RustCallbackOperationSelection | undefined {
  const callback = argumentCarriers[selection.callback.sourceArgumentIndex];
  const callbackTemplate = selection.parameterCarriers?.[selection.callback.sourceArgumentIndex];
  const callbackProtocol = rustCallbackProtocol(callback);
  if (callback === undefined || callbackTemplate === undefined || callbackProtocol === undefined ||
    !rustCallbackCarrierMatchesTemplate(callbackTemplate, callback)) {
    return undefined;
  }
  if (selection.callback.shape === "map") {
    const resultCarrier = rustJsArrayTargetType(callbackProtocol.result);
    const parameterCarriers = [...(selection.parameterCarriers ?? [])];
    parameterCarriers[selection.callback.sourceArgumentIndex] = callback;
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
      rustCallbackCarrierMatchesTemplate(template, argumentCarriers[index]!))) {
      return undefined;
    }
    return {
      ...selection,
      fact: { ...selection.fact, parameterCarriers: argumentCarriers },
      parameterCarriers: argumentCarriers,
    };
  }
  const accumulatorIndex = selection.callback.accumulatorArgumentIndex;
  const accumulator = accumulatorIndex === undefined
    ? undefined
    : argumentCarriers[accumulatorIndex];
  if (accumulator === undefined ||
    (callbackProtocol.parameters[0] !== undefined &&
      !rustTargetTypeRefEquals(callbackProtocol.parameters[0], accumulator)) ||
    !rustTargetTypeRefEquals(callbackProtocol.result, accumulator)) {
    return undefined;
  }
  const parameterCarriers = [...argumentCarriers];
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
      templateProtocol.parameters.length === actualProtocol.parameters.length &&
      templateProtocol.parameters.every((parameter, index) =>
        actualProtocol.parameters[index] !== undefined &&
        rustCallbackCarrierMatchesTemplate(parameter, actualProtocol.parameters[index]!)) &&
      rustCallbackCarrierMatchesTemplate(templateProtocol.result, actualProtocol.result);
  }
  return rustTargetTypeRefEquals(template, actual);
}

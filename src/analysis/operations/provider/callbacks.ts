import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type {
  RustCallbackOperationTemplate,
  RustProviderOperationTemplate,
  RustValueConversion,
} from "../../facts/keys.js";
import {
  rustCallableBoundaryProtocol,
  rustCallableSignaturesAlphaEquivalent,
  rustCallableProtocol,
  rustCallTraitSatisfies,
  rustJsArrayTargetType,
} from "../../../target-model/types/index.js";
import { applyRustProviderArgumentConversion } from "../../../policy/operations/forms.js";
import { rustLifetimeSemanticKey } from "../../../target-model/semantics/index.js";

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
  const callbackProtocol = rustCallableBoundaryProtocol(callback);
  const callbackMatch = callback === undefined || callbackTemplate === undefined
    ? undefined
    : selectRustCallbackCarrierMatch(callbackTemplate, callback);
  if (callback === undefined || callbackTemplate === undefined || callbackProtocol === undefined ||
    callbackMatch === undefined) {
    return undefined;
  }
  const adapted = applyRustCallbackCarrierConversion(selection, argumentCarriers.length, callbackMatch);
  if (adapted === undefined) {
    return undefined;
  }
  if (selection.callback.shape === "map") {
    const resultCarrier = rustJsArrayTargetType(callbackProtocol.result);
    const parameterCarriers = [...(selection.parameterCarriers ?? [])];
    parameterCarriers[selection.callback.sourceArgumentIndex] = callback;
    return {
      ...adapted,
      fact: {
        ...adapted.fact,
        resultCarrier,
        parameterCarriers,
      },
      resultCarrier,
      parameterCarriers,
    };
  }
  if (selection.callback.shape === "direct") {
    const templates = selection.parameterCarriers ?? [];
    if (templates.length !== argumentCarriers.length || !templates.every((template, index) => {
      const actual = argumentCarriers[index];
      const match = template === undefined || actual === undefined
        ? undefined
        : selectRustCallbackCarrierMatch(template, actual);
      return match !== undefined &&
        (index === selection.callback.sourceArgumentIndex || match.conversion === undefined);
    })) {
      return undefined;
    }
    return {
      ...adapted,
      fact: { ...adapted.fact, parameterCarriers: argumentCarriers },
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
    ...adapted,
    fact: {
      ...adapted.fact,
      resultCarrier: accumulator,
      parameterCarriers,
    },
    resultCarrier: accumulator,
    parameterCarriers,
  };
}

interface RustCallbackCarrierMatch {
  readonly conversion?: RustValueConversion;
}

function applyRustCallbackCarrierConversion(
  selection: RustCallbackOperationSelection,
  sourceArgumentCount: number,
  match: RustCallbackCarrierMatch,
): RustCallbackOperationSelection | undefined {
  if (match.conversion === undefined) {
    return selection;
  }
  if (selection.callback.argumentAdapter !== undefined) {
    return selection;
  }
  const target = applyRustProviderArgumentConversion(
    selection.fact.target,
    selection.callback.sourceArgumentIndex,
    sourceArgumentCount,
    match.conversion,
  );
  const fallibleTarget = applyRustProviderArgumentConversion(
    selection.callback.fallibleTarget,
    selection.callback.sourceArgumentIndex,
    sourceArgumentCount,
    match.conversion,
  );
  return target === undefined || fallibleTarget === undefined
    ? undefined
    : {
        ...selection,
        fact: { ...selection.fact, target },
        callback: { ...selection.callback, fallibleTarget },
      };
}

function selectRustCallbackCarrierMatch(
  template: TargetTypeRef,
  actual: TargetTypeRef,
): RustCallbackCarrierMatch | undefined {
  if (template.kind === "inference-variable") {
    return {};
  }
  if (template.kind === "closure") {
    const templateProtocol = rustCallableBoundaryProtocol(template);
    const actualProtocol = rustCallableBoundaryProtocol(actual);
    if (templateProtocol === undefined || actualProtocol === undefined ||
      !rustCallTraitSatisfies(actualProtocol.callTrait, templateProtocol.callTrait) ||
      !callbackSignaturesMatch(templateProtocol, actualProtocol)) {
      return undefined;
    }
    if (actualProtocol.invocation === "runtime-call" &&
      actualProtocol.failureChannel !== "result") {
      return undefined;
    }
    const conversion = actualProtocol.invocation === "direct"
      ? undefined
      : Object.freeze({
          kind: "runtime-callable-callback" as const,
          source: actual,
          target: template,
        });
    return conversion === undefined ? {} : { conversion };
  }
  if (template.kind === "function-pointer") {
    if (actual.kind !== "function-pointer" || template.safety !== actual.safety ||
      template.abi !== actual.abi || template.variadic !== actual.variadic) {
      return undefined;
    }
    return callbackSignaturesMatch(template, actual) ? {} : undefined;
  }
  const templateRuntime = rustCallableProtocol(template);
  const actualRuntime = rustCallableProtocol(actual);
  if (templateRuntime !== undefined || actualRuntime !== undefined) {
    return templateRuntime !== undefined && actualRuntime !== undefined &&
        templateRuntime.storage === actualRuntime.storage &&
        templateRuntime.asynchronous === actualRuntime.asynchronous &&
        optionalLifetimeMatches(templateRuntime.lifetime, actualRuntime.lifetime) &&
        callbackSignaturesMatch(templateRuntime, actualRuntime)
      ? {}
      : undefined;
  }
  return rustTargetTypeRefEquals(template, actual) ? {} : undefined;
}

function optionalLifetimeMatches(
  left: import("../../../target-model/semantics/index.js").RustLifetimeRef | undefined,
  right: import("../../../target-model/semantics/index.js").RustLifetimeRef | undefined,
): boolean {
  return left === undefined || right === undefined
    ? left === right
    : rustLifetimeSemanticKey(left) === rustLifetimeSemanticKey(right);
}

function callbackSignaturesMatch(
  template: import("../../../target-model/types/index.js").RustCallableSignature,
  actual: import("../../../target-model/types/index.js").RustCallableSignature,
): boolean {
  if (template.binder !== undefined || actual.binder !== undefined) {
    return rustCallableSignaturesAlphaEquivalent(template, actual);
  }
  return template.parameters.length === actual.parameters.length &&
    template.parameters.every((parameter, index) => {
      const match = actual.parameters[index] === undefined
        ? undefined
        : selectRustCallbackCarrierMatch(parameter, actual.parameters[index]!);
      return match !== undefined && match.conversion === undefined;
    }) && (() => {
      const match = selectRustCallbackCarrierMatch(template.result, actual.result);
      return match !== undefined && match.conversion === undefined;
    })();
}

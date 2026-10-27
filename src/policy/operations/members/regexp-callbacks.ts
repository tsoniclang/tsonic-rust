import { rustJsArrayTargetType, rustJsStringTargetType, rustJsValueTargetType, rustStringTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

import type { RustProviderOperationForm, RustValueConversion } from "../../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

import type { RustRegExpReplacementCallbackEvidence, RustRegExpReplacementCallbackContract } from "../../../target-model/records/callables/regexp-callbacks.js";
import { rustCallbackProtocol } from "./callbacks.js";
export function finalizeRustRegExpReplacementCallbackContract(
  evidence: RustRegExpReplacementCallbackEvidence,
  sourceCarrier: TargetTypeRef,
): RustRegExpReplacementCallbackContract | undefined {
  const expected = rustCallbackProtocol(evidence.sourceCarrier);
  const selected = rustCallbackProtocol(sourceCarrier);
  if (expected === undefined || selected === undefined || expected.parameters.length !== selected.parameters.length ||
    !rustTargetTypeRefEquals(expected.result, selected.result) ||
    !expected.parameters.every((parameter, index) => rustTargetTypeRefEquals(parameter, selected.parameters[index]))) {
    return undefined;
  }
  return Object.freeze({
    ...evidence,
    sourceCarrier,
    targetCarrier: {
      kind: "closure" as const,
      args: [rustJsArrayTargetType(rustJsValueTargetType())],
      result: stringCarrier(evidence.lane),
    },
  });
}

export function applyRustRegExpReplacementCallbackConversion(
  form: RustProviderOperationForm,
  sourceArgumentIndex: number,
  sourceArgumentCount: number,
  contract: RustRegExpReplacementCallbackContract,
  sourceFallible: boolean,
): RustProviderOperationForm | undefined {
  if (form.form !== "call" && form.form !== "free-call" &&
    form.form !== "receiver-method" && form.form !== "arg-receiver-method" &&
    form.form !== "arg-structural-method") {
    return undefined;
  }
  const existing = form.argConversions;
  const target = rustCallbackProtocol(contract.targetCarrier);
  if (target?.representation !== "closure") return undefined;
  if (sourceArgumentIndex < 0 || sourceArgumentIndex >= sourceArgumentCount ||
    (existing !== undefined && existing.length !== sourceArgumentCount) ||
    existing?.[sourceArgumentIndex] !== undefined ||
    ((form.form === "arg-receiver-method" || form.form === "arg-structural-method") &&
      sourceArgumentIndex === 0)) {
    return undefined;
  }
  const conversions = existing === undefined
    ? Array.from(
        { length: sourceArgumentCount },
        (): RustValueConversion | undefined => undefined,
      )
    : [...existing];
  conversions[sourceArgumentIndex] = Object.freeze({
    kind: "js-argument-vector-callback",
    lane: contract.lane,
    source: contract.sourceCarrier,
    target: { kind: "closure" as const, args: target.parameters, result: target.result,
      ...(contract.lane === "native" || sourceFallible ? { fallible: true as const } : {}) },
    projections: contract.projections,
    sourceFallible,
  });
  return Object.freeze({ ...form, argConversions: Object.freeze(conversions) });
}

function stringCarrier(lane: "native" | "exact"): TargetTypeRef {
  return lane === "native" ? rustStringTargetType() : rustJsStringTargetType();
}

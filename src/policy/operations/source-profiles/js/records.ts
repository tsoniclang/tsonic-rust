import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustTargetOperationFact } from "../../../../target-model/records/operations/operations.js";
import type { RustProviderOperationTemplate } from "../../../../target-model/operations/model.js";
import { rustSourcePrimitiveTargetType, rustJsArrayTargetType } from "../../../../target-model/types/index.js";
import { rustTupleTargetType } from "../../../types/collections/tuple-carrier.js";

export function selectRustRecordObjectOperation(
  kind: Extract<RustTargetOperationFact, { readonly kind: "object-shape-projection" }>["projection"],
  staticCall: boolean, carrier: TargetTypeRef, key: TargetTypeRef, value: TargetTypeRef,
): RustProviderOperationTemplate & { readonly parameterCarriers: readonly TargetTypeRef[] } {
  const result = kind === "has-own" ? rustSourcePrimitiveTargetType("bool") : kind === "assign" ? carrier :
    rustJsArrayTargetType(kind === "keys" ? key : kind === "values" ? value : rustTupleTargetType([key, value]));
  const parameters = kind === "has-own" ? staticCall ? [carrier, key] : [key] :
    kind === "assign" ? [carrier, carrier] : [carrier];
  return {
    kind: "provider-operation", operationId: `tsonic.rust.record.${kind}`, operationKind: "method",
    target: kind === "has-own" && !staticCall ? { form: "receiver-method", name: "contains_key", argModes: ["ref"] } :
      { form: "call", path: kind === "has-own" ? "rt::Record::contains_key" : `js_abi::record_${kind}`,
        argModes: parameters.map(() => "ref") },
    parameterCarriers: parameters, resultCarrier: result,
    ...(kind === "keys" || kind === "has-own" ? {} : { carrierRequirements: [{ carrier: value, requirement: "clone" as const,
      source: { kind: "argument" as const, sourceIndex: kind === "assign" ? 1 : 0, projection: [1] } }] }),
    isAsync: false, isFallible: false, errorBoundary: "none",
  };
}

export function selectRustRecordDeleteOperation(receiver: TargetTypeRef, key: TargetTypeRef): RustProviderOperationTemplate {
  return {
    kind: "provider-operation", operationId: "tsonic.rust.record.delete", operationKind: "indexer",
    target: { form: "receiver-method", name: "remove", argModes: ["ref"] },
    parameterCarriers: [key], receiverCarrier: receiver, resultCarrier: rustSourcePrimitiveTargetType("bool"),
    isAsync: false, isFallible: false, errorBoundary: "none",
  };
}

import type { RustProviderOperationTemplate } from "../../../target-model/operations/model.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustSourcePrimitiveTargetType } from "../../../target-model/types/index.js";
import type { RustNativeIndexSelection } from "./native-indices.js";

export function selectRustFixedArrayPropertyPlan(): RustProviderOperationTemplate {
  return {
    kind: "provider-operation",
    operationId: "tsonic.rust.fixed-array.length",
    operationKind: "property",
    target: { form: "receiver-method", name: "len", emptyTestMethod: "is_empty" },
    resultCarrier: rustSourcePrimitiveTargetType("native-uint"),
    parameterCarriers: [],
    evaluation: "pure",
    isAsync: false,
    isFallible: false,
    errorBoundary: "none",
  };
}

type RustFixedIndexOperation = Extract<RustTargetOperationFact, { readonly kind: "fixed-index" }>;

export function selectRustFixedArrayElementPlan(element: TargetTypeRef, index: bigint): RustFixedIndexOperation;
export function selectRustFixedArrayElementPlan(element: TargetTypeRef, index: RustNativeIndexSelection): RustProviderOperationTemplate;
export function selectRustFixedArrayElementPlan(element: TargetTypeRef,
  index: bigint | RustNativeIndexSelection): RustFixedIndexOperation | RustProviderOperationTemplate {
  if (typeof index === "bigint") return {
    kind: "fixed-index",
    operationId: "tsonic.rust.fixed-array.index",
    index,
  };
  return {
    kind: "provider-operation",
    operationId: "tsonic.rust.fixed-array.dynamic-index",
    operationKind: "indexer",
    target: { form: "index", ...(index.conversion === undefined ? {} : { indexConversion: index.conversion }) },
    resultCarrier: element,
    parameterCarriers: [index.carrier],
    evaluation: "pure",
    isAsync: false,
    isFallible: false,
    errorBoundary: "none",
  };
}

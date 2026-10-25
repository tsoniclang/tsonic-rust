import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustProviderOperationTemplate } from "../../../target-model/operations/model.js";
import type { RustCheckedElementSelectionInput } from "../../model/contracts.js";
import { isRustCopyCarrier } from "../../constraints/native-traits.js";
import type { RustNativeIndexSelection } from "./native-indices.js";

export function selectRustNativeArrayElementPlan(ownerName: "Array" | "ReadonlyArray", element: TargetTypeRef,
  index: RustNativeIndexSelection, accessMode: RustCheckedElementSelectionInput["accessMode"]): RustProviderOperationTemplate {
  return {
    kind: "provider-operation",
    operationId: `tsonic.rust.native.${ownerName}.index`,
    operationKind: "indexer",
    target: { form: "index", ...(index.conversion === undefined ? {} : { indexConversion: index.conversion }) },
    resultCarrier: element,
    parameterCarriers: [index.carrier],
    evaluation: "pure",
    isAsync: false,
    isFallible: false,
    errorBoundary: "none",
    ...((accessMode === "read" || accessMode === "read-write") && !isRustCopyCarrier(element)
      ? { carrierRequirements: [{ carrier: element, requirement: "clone" as const,
          source: { kind: "receiver" as const, projection: [0] } }] } : {}),
  };
}

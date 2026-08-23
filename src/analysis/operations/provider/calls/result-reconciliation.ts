import { selectRustSourceResultRepresentationConversion } from "../../../../policy/conversions/selection.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type {
  RustProviderFactOperationKind,
  RustRuntimeSetOperationKind,
} from "../../../facts/keys.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { InstantiatedProviderOperationTemplate } from "./instantiation.js";

export function reconcileSelectedProviderOperationResult<
  OperationKind extends RustProviderFactOperationKind | RustRuntimeSetOperationKind,
>(
  instantiation: InstantiatedProviderOperationTemplate<OperationKind>,
  selectedResultCarrier: TargetTypeRef | undefined,
): InstantiatedProviderOperationTemplate<OperationKind> | undefined {
  if (selectedResultCarrier === undefined || rustTargetTypeRefEquals(
    instantiation.template.sourceResultCarrier ?? instantiation.template.resultCarrier,
    selectedResultCarrier,
  )) {
    return instantiation;
  }
  if (instantiation.template.sourceResultCarrier !== undefined ||
    instantiation.template.resultConversion !== undefined) {
    return instantiation;
  }
  const representationConversion = selectRustSourceResultRepresentationConversion(
    instantiation.template.resultCarrier,
    selectedResultCarrier,
  );
  if (representationConversion === undefined) {
    return instantiation;
  }
  if (instantiation.template.isAsync) {
    return {
      ...instantiation,
      template: {
        ...instantiation.template,
        resultCarrier: selectedResultCarrier,
        resultConversion: representationConversion,
      },
    };
  }
  return {
    ...instantiation,
    template: {
      ...instantiation.template,
      sourceResultCarrier: selectedResultCarrier,
    },
  };
}

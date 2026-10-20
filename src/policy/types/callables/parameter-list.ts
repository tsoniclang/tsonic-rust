import { isRustJsArrayCarrier, rustJsArrayLikeElementTargetType, rustJsArrayTargetType, rustOptionElementCarrier, rustVecTargetType } from "../../../target-model/types/index.js";
import { rustTupleTargetType } from "../collections/tuple-carrier.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

import type { SourceCallableTypeEvidence } from "@tsonic/target-api/source";

import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function resolveRustSignatureParameterListTarget(
  parameters: SourceCallableTypeEvidence["parameters"],
  elements: readonly TargetTypeRef[],
  options: { readonly jsEnabled: boolean },
): TargetTypeRef | undefined {
  const restIndexes = parameters.flatMap((parameter, index) =>
    parameter.parameterKind === "rest" ? [index] : []
  );
  if (restIndexes.length === 0) {
    return rustTupleTargetType(elements);
  }
  if (restIndexes.length !== 1) {
    return undefined;
  }
  const restIndex = restIndexes[0]!;
  const restCarrier = elements[restIndex];
  const restElement = restCarrier?.kind === "array"
    ? restCarrier.element
    : isRustJsArrayCarrier(restCarrier)
      ? rustJsArrayLikeElementTargetType(restCarrier)
      : undefined;
  if (restElement === undefined) {
    return undefined;
  }
  const homogeneous = elements.every((element, index) => {
    const value = index === restIndex
      ? restElement
      : rustOptionElementCarrier(element) ?? element;
    return rustTargetTypeRefEquals(value, restElement);
  });
  if (!homogeneous) {
    return undefined;
  }
  return options.jsEnabled
    ? rustJsArrayTargetType(restElement)
    : rustVecTargetType(restElement);
}

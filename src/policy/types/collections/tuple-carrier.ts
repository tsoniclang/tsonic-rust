import type { TargetTypeRef } from "../../../target-model/types/model.js";

import { rustFixedArrayTargetType } from "../../../target-model/types/carriers/native.js";
export function rustTupleTargetType(elements: readonly TargetTypeRef[]): TargetTypeRef {
  const [first] = elements;
  if (elements.length >= 2 && first?.kind === "source-primitive" && elements.every((element) =>
    element.kind === "source-primitive" && element.name === first.name)) {
    return rustFixedArrayTargetType(first, elements.length);
  }
  return { kind: "tuple", elements };
}

import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustRuntimeUnionVariant } from "../../target-model/types/carriers/runtime-unions.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { getRustTypeofRuntimeKind } from "../operations/syntax/runtime-kind.js";
import { emptyRustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";

import { isRustJsValueCarrier } from "../../target-model/types/carriers/js.js";

import { rustClosedValuePayloads } from "../../target-model/types/carriers/closed-values.js";
export function rustClosedValuePayloadProjection(source: TargetTypeRef, selected: TargetTypeRef): RustRuntimeUnionVariant | undefined {
  return !isRustJsValueCarrier(source) ? undefined : rustClosedValuePayloads.find(payload =>
    rustTargetTypeRefEquals(payload.carrier, selected))?.variant;
}

export function rustClosedValueCategoryProjection(selected: TargetTypeRef): boolean {
  const category = getRustTypeofRuntimeKind(selected, emptyRustTypeDefinitions);
  if (typeof category !== "string" || category === "object") return false;
  const candidates = rustClosedValuePayloads.filter(payload =>
    getRustTypeofRuntimeKind(payload.carrier, emptyRustTypeDefinitions) === category);
  return candidates.length === 1 && rustTargetTypeRefEquals(candidates[0]!.carrier, selected);
}

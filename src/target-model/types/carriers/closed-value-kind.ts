import type { TargetTypeRef } from "../model.js";
import { rustTargetTypeRefEquals } from "../equality.js";
import { rustJsValueTargetId, rustTsValueTargetId } from "./source-types.js";

export function isRustClosedValueCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier !== undefined && (rustTargetTypeRefEquals(carrier, { kind: "target-named", id: rustTsValueTargetId }) ||
    rustTargetTypeRefEquals(carrier, { kind: "target-named", id: rustJsValueTargetId }));
}

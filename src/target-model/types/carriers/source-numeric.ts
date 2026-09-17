import type { TargetTypeRef } from "../model.js";
import { rustTargetTypeRefEquals } from "../equality.js";
import { isRustBigIntCarrier } from "./js.js";
import { rustJsNumericTargetType } from "./native.js";
import { isRustNumericCarrier } from "./primitives.js";

export function rustCarrierSupportsSourceNumeric(carrier: TargetTypeRef): boolean {
  return isRustBigIntCarrier(carrier) || rustTargetTypeRefEquals(carrier, rustJsNumericTargetType()) ||
    isRustNumericCarrier(carrier) && carrier.name !== "native-int" && carrier.name !== "native-uint";
}

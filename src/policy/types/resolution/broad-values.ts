import {
  rustJsValueTargetType,
  rustTsValueTargetType,
} from "../../../target-model/types/index.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function rustBroadSourceValueTargetType(jsEnabled: boolean): TargetTypeRef {
  return jsEnabled ? rustJsValueTargetType() : rustTsValueTargetType();
}

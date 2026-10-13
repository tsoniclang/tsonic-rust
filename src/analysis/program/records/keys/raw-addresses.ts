import { defineRustPlanKey } from "../key.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { RustRawAddressPlan } from "../../../../target-model/records/raw-addresses.js";


export const rustRawAddressPlanKey = defineRustPlanKey<RustRawAddressPlan>("rawAddressPlan", (left, right) =>
  left.method === right.method && ("width" in left ? "width" in right && left.width === right.width : !("width" in right)) &&
  rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier) &&
  left.arguments.length === right.arguments.length && left.arguments.every((argument, index) => {
    const other = right.arguments[index];
    return other !== undefined && argument.expression === other.expression && argument.input === other.input &&
      rustTargetTypeRefEquals(argument.carrier, other.carrier);
  }));

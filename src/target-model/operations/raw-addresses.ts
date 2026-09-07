import type { Node } from "@tsonic/tsts";
import { defineRustPlanKey } from "../facts/keys.js";
import type { TargetTypeRef } from "../types/model.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";

export type RustRawAddressPlan = {
  readonly resultCarrier: TargetTypeRef;
  readonly arguments: readonly {
    readonly expression: Node;
    readonly carrier: TargetTypeRef;
    readonly input: "raw-ref" | "raw-owner-ref" | "u64" | "i128" | "u128";
  }[];
} & ({ readonly method: "same" | "hash" } | {
  readonly method: "address" | "from_address" | "offset" | "offset_unsigned";
  readonly width: 32 | 64;
});

export const rustRawAddressPlanKey = defineRustPlanKey<RustRawAddressPlan>("rawAddressPlan", (left, right) =>
  left.method === right.method && ("width" in left ? "width" in right && left.width === right.width : !("width" in right)) &&
  rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier) &&
  left.arguments.length === right.arguments.length && left.arguments.every((argument, index) => {
    const other = right.arguments[index];
    return other !== undefined && argument.expression === other.expression && argument.input === other.input &&
      rustTargetTypeRefEquals(argument.carrier, other.carrier);
  }));

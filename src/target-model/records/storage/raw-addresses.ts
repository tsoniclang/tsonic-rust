import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";

export type RustRawAddressPlan = {
  readonly resultCarrier: TargetTypeRef;
  readonly arguments: readonly {
    readonly expression: Node;
    readonly carrier: TargetTypeRef;
    readonly input: "raw-ref" | "raw-owner-ref" | "u64" | "i128" | "u128";
    readonly cast: boolean;
  }[];
} & ({ readonly method: "same" | "hash" } | {
  readonly method: "address" | "from_address" | "offset" | "offset_unsigned";
  readonly width: 32 | 64;
});

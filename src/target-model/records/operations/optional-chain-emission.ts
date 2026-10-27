import type { Node } from "@tsonic/tsts";
import type { RustOptionalChainFact } from "../../operations/model.js";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustRecordFamily } from "../program.js";

export interface RustOptionalChainEmission {
  readonly fact: RustOptionalChainFact;
  readonly unit: boolean;
  /**
   * The closure form of a chain whose present branch is free of error effects, await and yield: Option::map for a
   * mapped result, Option::and_then when the present branch already yields the Option. Undefined selects the match form.
   */
  readonly closure: "map" | "and_then" | undefined;
  readonly structuralGuard: {
    readonly receiverNode: Node;
    readonly receiverCarrier: TargetTypeRef;
    readonly storageIndex: number;
    readonly selectedStorageCarrier: TargetTypeRef;
  } | undefined;
}

export interface RustOptionalChainEmissionRecords {
  readonly optionalChainEmission: RustRecordFamily<RustOptionalChainEmission>;
}

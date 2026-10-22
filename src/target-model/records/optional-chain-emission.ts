import type { Node } from "@tsonic/tsts";
import type { RustOptionalChainFact } from "../operations/model.js";
import type { TargetTypeRef } from "../types/model.js";
import type { RustRecordFamily } from "./program.js";

export interface RustOptionalChainEmission {
  readonly fact: RustOptionalChainFact;
  readonly unit: boolean;
  /** A mapped chain whose present branch is evaluated by Option::map: infallible and free of await and yield. */
  readonly mapClosure: boolean;
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

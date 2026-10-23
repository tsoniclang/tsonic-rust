import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import type { RustRecordFamily } from "./program.js";
import type { RustAwaitSelection } from "../types/await.js";
import type { RustAwaitValueLeafFact } from "./await-values.js";

export interface RustNativeTaskScope {
  readonly name: string;
  readonly carrier: TargetTypeRef;
  readonly errorCarrier: TargetTypeRef;
}

export type RustNativeTaskUse =
  | { readonly kind: "entry"; readonly scope: RustNativeTaskScope; readonly inputCarrier: TargetTypeRef;
      readonly initializer: { readonly inputCarrier: TargetTypeRef; readonly passing: "borrow" } | undefined }
  | { readonly kind: "initializer"; readonly scope: RustNativeTaskScope; readonly inputCarrier: TargetTypeRef; readonly passing: "borrow" }
  | { readonly kind: "owner"; readonly scope: RustNativeTaskScope;
      readonly inputCarrier: TargetTypeRef;
      readonly captureCarrier: TargetTypeRef | undefined;
      readonly binding: "borrowed-parameter" | "owned-parameter" | "owned-capture" | "borrowed-capture" }
  | { readonly kind: "call"; readonly scope: RustNativeTaskScope;
      readonly passing: "borrow" | "clone" | "move" }
  | { readonly kind: "spawn"; readonly scope: RustNativeTaskScope;
      readonly operand: Node; readonly completion: RustAwaitSelection<RustAwaitValueLeafFact> };

export interface RustNativeTaskRecords {
  readonly nativeTaskUse: RustRecordFamily<RustNativeTaskUse>;
}

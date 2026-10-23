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
  | { readonly kind: "entry"; readonly scope: RustNativeTaskScope }
  | { readonly kind: "owner"; readonly scope: RustNativeTaskScope;
      readonly binding: "borrowed-parameter" | "owned-parameter" | "owned-capture" }
  | { readonly kind: "call"; readonly scope: RustNativeTaskScope;
      readonly passing: "borrow" | "clone" | "move" }
  | { readonly kind: "spawn"; readonly scope: RustNativeTaskScope;
      readonly operand: Node; readonly completion: RustAwaitSelection<RustAwaitValueLeafFact> };

export interface RustNativeTaskRecords {
  readonly nativeTaskUse: RustRecordFamily<RustNativeTaskUse>;
}

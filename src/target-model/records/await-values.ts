import type { RustAwaitSelection } from "../types/await.js";
import type { TargetTypeRef } from "../types/model.js";
import type { RustFinalizedValueConversion } from "./finalized-operation.js";
import type { RustFutureValueFact } from "./object-methods.js";

export interface RustAwaitValueLeafFact {
  readonly carrier: TargetTypeRef;
  readonly future?: RustFutureValueFact;
  readonly completion: { readonly kind: "absence" } |
    { readonly kind: "value"; readonly conversion: RustFinalizedValueConversion };
}

export interface RustAwaitValueFact {
  readonly operandCarrier: TargetTypeRef;
  readonly resultCarrier: TargetTypeRef;
  readonly selection: RustAwaitSelection<RustAwaitValueLeafFact>;
}

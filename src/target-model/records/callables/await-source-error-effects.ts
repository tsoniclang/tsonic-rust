import type { TargetTypeRef } from "../../types/model.js";
import type { RustSourceErrorEffectEdge } from "../errors/source-error-effects.js";

export interface RustAwaitSourceErrorBranch {
  readonly carrier: TargetTypeRef;
  readonly edge: RustSourceErrorEffectEdge;
}

export interface RustAwaitSourceErrorEffectsFact {
  readonly branches: readonly RustAwaitSourceErrorBranch[];
}

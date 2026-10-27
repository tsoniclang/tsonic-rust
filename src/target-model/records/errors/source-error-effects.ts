import type { Node } from "@tsonic/tsts";
import type { RustErrorEffectsFact, RustNativeErrorEffect } from "./error-effects.js";

export interface RustSourceErrorEffectEdge {
  readonly declaration: Node;
  readonly kind: "invoke" | "await";
  readonly effects: RustErrorEffectsFact;
  readonly nativeErrors: readonly {
    readonly source: RustNativeErrorEffect;
    readonly target: RustNativeErrorEffect;
  }[];
}

export interface RustSourceErrorEffectsFact {
  readonly edges: readonly RustSourceErrorEffectEdge[];
}

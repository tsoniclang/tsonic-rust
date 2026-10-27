import type { TargetTypeRef } from "../../types/model.js";

export const rustJsRejectionErrorIdentity = "js-rejection";

export interface RustNativeErrorEffect {
  readonly identity: string;
  readonly errorType: TargetTypeRef;
}

export interface RustErrorEffectsFact {
  readonly localErrors: boolean;
  readonly nativeErrors: readonly RustNativeErrorEffect[];
}

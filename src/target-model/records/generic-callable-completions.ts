import type { TargetTypeRef } from "../types/model.js";

import type { RustGenericCallablePhysicalMember } from "./generic-callables.js";

export interface RustGenericCallableMemberCompletion {
  readonly result: TargetTypeRef;
  readonly variant: string | undefined;
}

export type RustGenericCallableCompletionSelection =
  | { readonly kind: "direct"; readonly result: TargetTypeRef }
  | { readonly kind: "selected"; readonly result: TargetTypeRef;
      readonly members: ReadonlyMap<RustGenericCallablePhysicalMember, RustGenericCallableMemberCompletion> }
  | { readonly kind: "unresolved"; readonly reason: string };

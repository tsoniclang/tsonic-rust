import type { TargetTypeRef } from "../types/model.js";

import type { RustNativeErrorSource } from "../types/native-error-joins.js";
import type { RustSourceCallEffectsFact } from "./object-methods.js";
import type { RustGenericCallableEffectsFact } from "./generic-callable-effects.js";
import type { RustGenericCallablePhysicalDefinition, RustGenericCallablePhysicalMember } from "./generic-callables.js";

export interface RustGenericCallableErrorIndex {
  forDefinition(definition: RustGenericCallablePhysicalDefinition): RustGenericCallableErrorSelection | undefined;
}

export interface RustGenericCallableMemberErrors {
  readonly effects: RustSourceCallEffectsFact;
  readonly invocation: RustNativeErrorSource<TargetTypeRef> | undefined;
  readonly awaiting: RustNativeErrorSource<TargetTypeRef> | undefined;
}

export interface RustGenericCallableErrorSelection {
  readonly effects: RustGenericCallableEffectsFact;
  readonly invocation: readonly RustNativeErrorSource<TargetTypeRef>[];
  readonly awaiting: readonly RustNativeErrorSource<TargetTypeRef>[];
  readonly members: ReadonlyMap<RustGenericCallablePhysicalMember, RustGenericCallableMemberErrors>;
}

import type { RustGenericCallablePhysicalDefinition, RustGenericCallablePhysicalMember } from "./generic-callables.js";
import type { RustNativeErrorSource } from "../types/native-error-joins.js";
import type { TargetTypeRef } from "../types/model.js";
import type { RustSourceCallEffectsFact } from "./object-methods.js";
import type { RustGenericCallableEffectsFact } from "./generic-callable-effects.js";
import type { RustRecordFamily } from "./program.js";
import type { RustPhysicalErrorOwner } from "./error-regions.js";

export interface RustProjectMemberError {
  readonly carrier: TargetTypeRef;
  readonly owner: RustPhysicalErrorOwner;
}

export interface RustGenericCallableMemberErrorEmission {
  readonly effects: RustSourceCallEffectsFact;
  readonly invocation: RustNativeErrorSource<TargetTypeRef> | undefined;
  readonly awaiting: RustNativeErrorSource<TargetTypeRef> | undefined;
}

export interface RustGenericCallableErrorEmission {
  readonly effects: RustGenericCallableEffectsFact;
  readonly invocation: readonly RustNativeErrorSource<TargetTypeRef>[];
  readonly awaiting: readonly RustNativeErrorSource<TargetTypeRef>[];
  readonly members: ReadonlyMap<RustGenericCallablePhysicalMember, RustGenericCallableMemberErrorEmission>;
}

export interface RustErrorEmissionRecords {
  readonly projectMemberError: RustRecordFamily<RustProjectMemberError>;
  readonly genericCallableErrors: { readonly get: (definition: RustGenericCallablePhysicalDefinition) => RustGenericCallableErrorEmission | undefined };
  readonly nativeErrorJoinName: { readonly get: (fileName: string, arity: number) => string | undefined };
}

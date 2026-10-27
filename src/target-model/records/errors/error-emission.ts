import type { RustGenericCallablePhysicalDefinition, RustGenericCallablePhysicalMember } from "../callables/generic-callables.js";
import type { RustNativeErrorSource } from "../../types/native-error-joins.js";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustSourceCallEffectsFact } from "../objects/object-methods.js";
import type { RustGenericCallableEffectsFact } from "../callables/generic-callable-effects.js";
import type { RustRecordFamily } from "../program.js";
import type { RustPhysicalErrorOwner } from "./error-regions.js";
import type { RustErrorJoinDeclaration } from "./error-regions.js";
import type { RustErrorRegionSelection } from "./error-regions.js";
import type { RustSourceErrorRegionSelection } from "./error-regions.js";
import type { RustSourceErrorEffectEdge } from "./source-error-effects.js";
import type { Node } from "@tsonic/tsts";

export interface RustSourceErrorRegionEmission {
  readonly local: RustSourceErrorRegionSelection["local"];
  readonly operand: RustErrorRegionSelection;
  readonly channels: ReadonlyMap<string, {
    readonly targetIdentity: string;
    readonly uninhabited: boolean;
    readonly jsRejection: boolean;
  }>;
}

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
  readonly awaitErrorEdge: { readonly get: (node: Node, carrier: TargetTypeRef) => RustSourceErrorEffectEdge | undefined };
  readonly sourceErrorRegion: { readonly get: (edge: RustSourceErrorEffectEdge) => RustSourceErrorRegionEmission | undefined };
  readonly nativeErrorJoinDeclarations: { readonly get: (fileName: string) => readonly RustErrorJoinDeclaration[] | undefined };
  readonly errorDeclarationOwner: RustRecordFamily<string>;
  readonly errorMemberOwner: RustRecordFamily<RustPhysicalErrorOwner>;
  readonly projectMemberError: RustRecordFamily<RustProjectMemberError>;
  readonly genericCallableErrors: { readonly get: (definition: RustGenericCallablePhysicalDefinition) => RustGenericCallableErrorEmission | undefined };
  readonly nativeErrorJoinName: { readonly get: (fileName: string, arity: number) => string | undefined };
}

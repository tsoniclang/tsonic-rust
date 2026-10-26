import type { RustProjectTypeDefinition } from "../types/project-types.js";
import type { RustLifetimeRef } from "../lifetimes/index.js";

export type RustObjectRepresentationKind = "value" | "shared-immutable" | "shared-mutable" | "closed-hierarchy" | "open-hierarchy";

export interface RustObjectNativeLifetimeContract {
  readonly dispatchObjectLifetime: RustLifetimeRef | undefined;
  readonly ownedCallableFieldLifetime: RustLifetimeRef | undefined;
  readonly typeOutlives: readonly { readonly identity: string; readonly lifetime: RustLifetimeRef }[];
}

export interface RustObjectRepresentation {
  readonly definition: RustProjectTypeDefinition;
  readonly kind: RustObjectRepresentationKind;
  readonly mutable: boolean;
  readonly identityObserved: boolean;
  readonly escapes: boolean;
  readonly constructionCount: number;
  readonly dispatchObjectLifetime: RustLifetimeRef | undefined;
}

import type { RustProjectTypeDefinition } from "../types/project-types.js";
import type { RustLifetimeRef } from "../lifetimes/index.js";

export type RustObjectRepresentationKind = "value" | "shared-immutable" | "shared-mutable" | "closed-hierarchy" | "open-hierarchy";

export interface RustObjectRepresentation {
  readonly definition: RustProjectTypeDefinition;
  readonly kind: RustObjectRepresentationKind;
  readonly mutable: boolean;
  readonly identityObserved: boolean;
  readonly escapes: boolean;
  readonly constructionCount: number;
  readonly dispatchObjectLifetime: RustLifetimeRef | undefined;
}

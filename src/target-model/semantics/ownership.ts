import type { RustSemanticIdentity } from "./identity.js";
import type { RustLifetimeRef } from "./lifetimes.js";
import type { RustTypeRef } from "./types.js";

export type RustSourceValueContract =
  | {
      readonly kind: "ordinary-typescript";
      readonly carrier: RustTypeRef;
    }
  | {
      readonly kind: "owned";
      readonly target: RustTypeRef;
    }
  | {
      readonly kind: "shared-reference";
      readonly target: RustTypeRef;
      readonly lifetime: RustLifetimeRef;
    }
  | {
      readonly kind: "mutable-reference";
      readonly target: RustTypeRef;
      readonly lifetime: RustLifetimeRef;
    };

export type RustPlaceProjection =
  | { readonly kind: "field"; readonly identity: RustSemanticIdentity; readonly displayName: string }
  | { readonly kind: "tuple-field"; readonly index: number }
  | { readonly kind: "fixed-index"; readonly index: number }
  | { readonly kind: "dynamic-index"; readonly expressionId: string }
  | { readonly kind: "dereference" }
  | { readonly kind: "downcast"; readonly variant: RustSemanticIdentity };

export interface RustPlaceRef {
  readonly rootId: string;
  readonly projections: readonly RustPlaceProjection[];
}

export interface RustRegionRef {
  readonly id: string;
  readonly kind: "lexical" | "flow" | "suspension" | "call" | "static";
  readonly parentId?: string;
}

export interface RustTraitProof {
  readonly trait: RustSemanticIdentity;
  readonly type: RustTypeRef;
  readonly evidenceId: string;
}

export type RustOwnershipOperation =
  | { readonly kind: "move"; readonly place: RustPlaceRef }
  | { readonly kind: "copy"; readonly place: RustPlaceRef; readonly proof: RustTraitProof }
  | { readonly kind: "clone"; readonly place: RustPlaceRef; readonly proof: RustTraitProof }
  | { readonly kind: "to-owned"; readonly place: RustPlaceRef; readonly proof: RustTraitProof }
  | { readonly kind: "shared-borrow"; readonly place: RustPlaceRef; readonly loanId: string }
  | { readonly kind: "mutable-borrow"; readonly place: RustPlaceRef; readonly loanId: string }
  | {
      readonly kind: "reborrow";
      readonly place: RustPlaceRef;
      readonly mutable: boolean;
      readonly sourceLoanId: string;
      readonly loanId: string;
    }
  | { readonly kind: "load"; readonly place: RustPlaceRef; readonly proof: RustTraitProof }
  | { readonly kind: "store"; readonly place: RustPlaceRef }
  | { readonly kind: "replace"; readonly place: RustPlaceRef }
  | { readonly kind: "take"; readonly place: RustPlaceRef; readonly proof: RustTraitProof };

export interface RustLoan {
  readonly id: string;
  readonly kind: "shared" | "mutable";
  readonly place: RustPlaceRef;
  readonly reservationRegion: RustRegionRef;
  readonly activationRegion?: RustRegionRef;
  readonly liveRegion: RustRegionRef;
  readonly reservationPointId: string;
  readonly activationPointId: string;
  readonly livePointIds: readonly string[];
  readonly twoPhase: boolean;
}

export interface RustDropState {
  readonly place: RustPlaceRef;
  readonly state:
    | "uninitialized"
    | "initialized"
    | "conditionally-initialized"
    | "partially-moved"
    | "moved"
    | "dropped";
  readonly region: RustRegionRef;
  readonly flowPointId: string;
  readonly movedProjections: readonly RustPlaceRef[];
  readonly initializedProjections: readonly RustPlaceRef[];
}

export interface RustDropObligation {
  readonly place: RustPlaceRef;
  readonly carrier: RustTypeRef;
  readonly region: RustRegionRef;
  readonly flowPointId: string;
  readonly successorPointId: string;
  readonly order: number;
  readonly action: "drop" | "drop-remaining-fields" | "conditional-drop";
  readonly requiredOutlives: readonly RustLifetimeRef[];
  readonly customDropProof?: RustDropImplementationProof;
}

export type RustDropImplementationProof =
  | { readonly kind: "trait"; readonly proof: RustTraitProof }
  | { readonly kind: "declaration"; readonly declaration: RustSemanticIdentity };

export interface RustCapture {
  readonly place: RustPlaceRef;
  readonly carrier: RustTypeRef;
  readonly storageCarrier: RustTypeRef;
  readonly representationCarrier: RustTypeRef;
  readonly mode: "shared" | "mutable" | "copy" | "move" | "clone";
  readonly bodyEffect: "read" | "mutate" | "move";
  readonly crossesSuspension: boolean;
  readonly executionDomain: RustExecutionDomain;
  readonly requiresStatic: boolean;
  readonly proof?: RustTraitProof;
  readonly sendProof?: RustTraitProof;
  readonly syncProof?: RustTraitProof;
}

export interface RustPinState {
  readonly place: RustPlaceRef;
  readonly carrier: RustTypeRef;
  readonly pointee: RustTypeRef;
  readonly pinnedAtPointId: string;
  readonly movementProof?: RustTraitProof;
}

export interface RustSuspensionPoint {
  readonly occurrenceId: string;
  readonly flowPointId: string;
  readonly kind: "await" | "yield";
  readonly region: RustRegionRef;
}

export interface RustSuspendedValue {
  readonly place: RustPlaceRef;
  readonly carrier: RustTypeRef;
}

export interface RustExecutionContract {
  readonly kind: RustExecutionDomain;
  readonly storage: RustExecutionStorage;
  readonly captureStyle: "lexical" | "move";
  readonly lifetime: RustLifetimeRef;
  readonly requiresSend: boolean;
  readonly requiresSync: boolean;
  readonly captures: readonly RustCapture[];
  readonly suspendedValues: readonly RustSuspendedValue[];
  readonly suspensionPoints: readonly RustSuspensionPoint[];
}

export type RustValueReadDisposition =
  | { readonly kind: "copy"; readonly proof: RustTraitProof }
  | { readonly kind: "move" }
  | { readonly kind: "clone"; readonly proof: RustTraitProof }
  | { readonly kind: "borrowed"; readonly mutable: boolean };

export type RustExecutionDomain = "local" | "threaded";
export type RustExecutionStorage = "borrowed" | "owned";

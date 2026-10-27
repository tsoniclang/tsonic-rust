import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustRecordContributionEvidence, RustRecordContributionFact } from "../objects/record-contributions.js";

export type RustDispatchMemberRole =
  | "read"
  | "write"
  | "capture"
  | "content"
  | "method-virtual"
  | "method-exact";

export type RustGeneratedProjectFieldRole =
  | "wrapper-identity"
  | "wrapper-dispatch"
  | "wrapper-state"
  | "base-state"
  | "index-storage";

export interface RustVariantReachability {
  readonly used: ReadonlySet<string>;
  readonly read: ReadonlySet<string>;
  readonly constructed: ReadonlySet<string>;
}

export interface RustStructuralReachability {
  readonly constructed: boolean;
  readonly used: boolean;
  readonly fieldsRead: ReadonlySet<number>;
  readonly fieldsWritten: ReadonlySet<number>;
  readonly variants: RustVariantReachability;
}

export interface RustGeneratedItemUsage {
  readonly usedProjectTypes: ReadonlySet<Node>;
  readonly constructedProjectTypes: ReadonlySet<Node>;
  readonly reifiedProjectTypes: ReadonlySet<Node>;
  readonly invokedProjectConstructors: ReadonlySet<Node>;
  readonly readAuthoredFields: ReadonlySet<Node>;
  readonly usedProjectFields: ReadonlyMap<Node, ReadonlySet<RustGeneratedProjectFieldRole>>;
  readonly usedDispatchMembers: ReadonlyMap<Node, ReadonlySet<RustDispatchMemberRole>>;
  readonly usedDowncasts: ReadonlyMap<Node, ReadonlySet<Node>>;
  readonly usedCheckedProjections: ReadonlySet<Node>;
  readonly structuralCarriers: ReadonlyMap<TargetTypeRef, RustStructuralReachability>;
  readonly declarationVariants: ReadonlyMap<Node, RustVariantReachability>;
  readonly recordContributions: ReadonlyMap<RustRecordContributionFact, RustRecordContributionEvidence>;
  readonly projectThisReferences: ReadonlyMap<Node, ReadonlyMap<Node, readonly Node[]>>;
}

export interface RustReachability extends RustGeneratedItemUsage {
  readonly usedPromiseObjects: ReadonlySet<Node>;
  readonly externallyReachable: ReadonlySet<Node>;
  readonly suppressedDeclarations: ReadonlySet<Node>;
}

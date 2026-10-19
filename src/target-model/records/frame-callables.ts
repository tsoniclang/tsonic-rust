import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import type { RustCallableOrigin, RustCallableSignature } from "../types/carriers/callable-signatures.js";
import type { RustClosureCaptureFact } from "./operation-selections.js";
import type { RustCallableActivation } from "./callable-ownership.js";

export interface RustFrameCallableImplementation {
  readonly declaration: Node;
  readonly carrier: TargetTypeRef;
  readonly capture: RustClosureCaptureFact;
  readonly variantName: string;
  readonly functionName: string;
  readonly stateName: string;
  readonly captures: RustClosureCaptureFact["captures"];
  readonly receiverFields: RustClosureCaptureFact["receiverFields"];
  readonly receivers: RustClosureCaptureFact["receivers"];
  readonly copy: boolean;
  readonly independent: boolean;
}

export interface RustFrameCallableEntryDefinition {
  readonly key: string;
  readonly targetName: string;
  readonly signature: RustCallableSignature;
  readonly implementations: readonly RustFrameCallableImplementation[];
  readonly copy: boolean;
  readonly environmentIndexes: readonly number[];
  readonly hasIndependent: boolean;
}

export interface RustFrameCallableBinding {
  readonly declaration: Node;
  readonly fieldName: string;
  readonly carrier: TargetTypeRef;
  readonly entry: RustFrameCallableEntryDefinition | undefined;
  readonly initialization: "ready" | "deferred";
  readonly storage: "value" | "location" | "cell" | "borrow-cell";
}

export interface RustFrameCallableDefinition {
  readonly activation: RustCallableActivation;
  readonly owner: RustCallableOrigin;
  readonly ownerFileName: string;
  readonly targetName: string;
  readonly counterName: string;
  readonly storage: { readonly kind: "standalone"; readonly instanceFieldName?: string }
    | { readonly kind: "object"; readonly mutable: boolean };
  readonly entries: readonly RustFrameCallableEntryDefinition[];
  readonly bindings: readonly RustFrameCallableBinding[];
  readonly environmentParameters: readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[];
  readonly constructionExposure?: { readonly declaration: Node; readonly expression: Node };
}

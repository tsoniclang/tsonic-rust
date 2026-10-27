import type { TargetTypeRef, RustTargetTraitRef, RustTargetGenericArgument } from "../../types/model.js";
import type { RustCallableSignature } from "../../types/carriers/callable-signatures.js";
import type { RustNativeCallableCompletion } from "../../types/callable-completions.js";
import type { RustLifetimeBinder, RustLifetimeRef } from "../../lifetimes/index.js";
import type { Node } from "@tsonic/tsts";
import type { SourceStorageSubject } from "@tsonic/target-api/analysis";

/** Identity prefix of every generated native callable protocol trait. */
export const rustNativeCallableProtocolIdPrefix = "native-protocol:";

export interface RustNativeCallableInput extends RustNativeCallableProtocolBinding {
  readonly owner: Node;
  readonly subject: SourceStorageSubject;
  readonly carrier: TargetTypeRef;
  readonly implementation: Extract<TargetTypeRef, { readonly kind: "type-parameter" }>;
}

export interface RustNativeCallableCall {
  readonly node: Node;
  readonly input: RustNativeCallableInput;
  readonly invocationError: TargetTypeRef;
  readonly invocationErrorSource: string;
  readonly completion?: RustNativeCallableCompletion;
  readonly awaitErrors: readonly TargetTypeRef[];
  readonly awaitErrorSources: readonly string[];
}

export interface RustNativeCallableOutlivesBound {
  readonly carrier: TargetTypeRef;
  readonly lifetime: RustLifetimeRef;
}

export interface RustNativeCallableProtocol {
  readonly identity: string;
  readonly ownerFileName: string;
  readonly targetName: string;
  readonly boundProducerName?: string;
  readonly signature: RustCallableSignature;
  readonly environmentParameters: readonly RustTargetGenericArgument[];
  readonly method: {
    readonly parameters: readonly TargetTypeRef[];
    readonly result: TargetTypeRef;
    readonly sourceResult: TargetTypeRef;
    readonly binder: RustLifetimeBinder;
    readonly outlives: readonly RustNativeCallableOutlivesBound[];
  };
  readonly completion?: RustNativeCallableCompletion;
  readonly result: TargetTypeRef;
  readonly trait: RustTargetTraitRef;
  /** Associated type projections in the signature (an indexed field output): each owner must implement the trait. */
  readonly associatedObligations: readonly { readonly owner: TargetTypeRef; readonly trait: RustTargetTraitRef }[];
}

export interface RustNativeCallableProtocolBinding {
  readonly protocol: RustNativeCallableProtocol;
  readonly environment: readonly RustTargetGenericArgument[];
  readonly trait: RustTargetTraitRef;
}

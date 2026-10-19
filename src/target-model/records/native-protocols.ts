import type { TargetTypeRef, RustTargetTraitRef } from "../types/model.js";
import type { RustCallableSignature } from "../types/carriers/callable-signatures.js";
import type { RustNativeCallableCompletion } from "../types/callable-completions.js";
import type { RustLifetimeBinder, RustLifetimeRef } from "../lifetimes/index.js";

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
  readonly method: {
    readonly parameters: readonly TargetTypeRef[];
    readonly result: TargetTypeRef;
    readonly binder: RustLifetimeBinder;
    readonly outlives: readonly RustNativeCallableOutlivesBound[];
  };
  readonly completion?: RustNativeCallableCompletion;
  readonly result: TargetTypeRef;
  readonly trait: RustTargetTraitRef;
}

export interface RustNativeCallableProtocolBinding {
  readonly protocol: RustNativeCallableProtocol;
  readonly environment: readonly TargetTypeRef[];
  readonly trait: RustTargetTraitRef;
}

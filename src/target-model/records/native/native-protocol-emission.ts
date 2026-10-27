import type { RustNativeCallableProtocol, RustNativeCallableCall } from "./native-protocols.js";
import type { Node } from "@tsonic/tsts";
import type { RustNativeCallableCompletion } from "../../types/callable-completions.js";
import type { TargetTypeRef, RustTargetGenericArgument } from "../../types/model.js";
import type { RustGenericCallablePhysicalDefinition } from "../callables/generic-callables.js";

export interface RustNativeGenericProducerBridge {
  readonly ownerFileName: string;
  readonly definition: RustGenericCallablePhysicalDefinition;
  readonly returnCarrier: TargetTypeRef;
  readonly future: { readonly optional: boolean } | undefined;
}

type RustProducerTypeParameter = Extract<TargetTypeRef, { readonly kind: "type-parameter" }>;

export interface RustNativeProducerBridge {
  readonly implementation: RustProducerTypeParameter;
  readonly invocationError: RustProducerTypeParameter;
  readonly arguments: RustProducerTypeParameter;
  readonly genericArguments: readonly RustTargetGenericArgument[];
  readonly boundTypes: readonly RustProducerTypeParameter[];
  readonly errors: readonly { readonly ordinal: number; readonly parameter: RustProducerTypeParameter }[];
  readonly futureBounds: readonly { readonly parameter: RustProducerTypeParameter; readonly output: TargetTypeRef; readonly error: RustProducerTypeParameter }[];
  readonly concreteResult: TargetTypeRef;
  readonly implementationResult: TargetTypeRef;
  readonly higherRanked: {
    readonly helperResult: TargetTypeRef;
    readonly publicResult: TargetTypeRef;
    readonly outputs: readonly TargetTypeRef[];
  } | undefined;
}

export interface RustNativeProtocolEmission {
  readonly invoked: boolean;
  readonly nativeFutures: NonNullable<RustNativeCallableCompletion>["futures"];
  readonly producer: RustNativeProducerBridge | undefined;
  readonly genericProducers: readonly RustNativeGenericProducerBridge[];
}

export interface RustNativeProtocolReader {
  readonly get: (protocol: RustNativeCallableProtocol) => RustNativeProtocolEmission | undefined;
}

export interface RustNativeInputInvocationEmission {
  readonly call: RustNativeCallableCall;
  readonly callee: Node;
  readonly reference: boolean;
  /** Set when the call is in a catching try body: its invocation error converts into this program error. */
  readonly caught: TargetTypeRef | undefined;
}

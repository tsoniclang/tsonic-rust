import type { Node } from "@tsonic/tsts";

import type { TargetTypeRef } from "../types/model.js";

import type { RustGenericCallablePhysicalDefinition } from "./generic-callables.js";

import type { RustNativeCallableInput } from "./native-protocols.js";

import type { RustNativeCallableProtocol } from "./native-protocols.js";

export interface RustNativeGenericProducerBinding {
  readonly inputs: readonly RustNativeCallableInput[];
  readonly definition: RustGenericCallablePhysicalDefinition;
}

export interface RustNativeGenericProducerForwarding {
  readonly owner: Node;
  readonly input: RustNativeCallableInput;
  readonly trait: TargetTypeRef;
}

export interface RustNativeGenericProducerPlan {
  readonly bindings: readonly RustNativeGenericProducerBinding[];
  readonly open: readonly { readonly invocation: Node; readonly input: RustNativeCallableInput;
    readonly inputs: readonly RustNativeCallableInput[] }[];
  readonly unresolved: readonly { readonly invocation: Node; readonly input: RustNativeCallableInput; readonly reason: string }[];
  forProtocol(protocol: RustNativeCallableProtocol): readonly RustNativeGenericProducerBinding[];
  forwardingFor(owner: Node): readonly RustNativeGenericProducerForwarding[];
  errorAritiesFor(fileName: string): readonly number[] | undefined;
}

export interface RustNativeGenericProducerRequests {
  readonly bindings: readonly { readonly input: RustNativeCallableInput; readonly definition: RustGenericCallablePhysicalDefinition }[];
  readonly forwarding: ReadonlyMap<Node, readonly RustNativeGenericProducerForwarding[]>;
  readonly open: RustNativeGenericProducerPlan["open"];
  readonly unresolved: RustNativeGenericProducerPlan["unresolved"];
}

export interface RustNativeGenericProducerPublication {
  readonly bindingsByProtocol: ReadonlyMap<RustNativeCallableProtocol, readonly RustNativeGenericProducerBinding[]>;
  readonly open: RustNativeGenericProducerPlan["open"];
  readonly unresolved: RustNativeGenericProducerPlan["unresolved"];
  readonly forwarding: ReadonlyMap<Node, readonly RustNativeGenericProducerForwarding[]>;
  readonly errorArities: ReadonlyMap<string, readonly number[] | undefined>;
}

import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef, RustTargetGenericArgument } from "../../types/model.js";
import type { RustProducerErrorReference } from "../../types/carriers/producer-errors.js";
import type { RustDeferredProducerChannel } from "../errors/deferred-producer-effects.js";

export interface RustNativeCallableProducer {
  readonly declaration: Node;
  readonly identity: string;
  readonly fileName: string;
  readonly environment: readonly RustTargetGenericArgument[];
}

export interface RustNativeCallableProducerPlan {
  readonly producers: readonly RustNativeCallableProducer[];
  forDeclaration(declaration: Node): RustNativeCallableProducer | undefined;
  forIdentity(identity: string): RustNativeCallableProducer | undefined;
  errorFor(declaration: Node, channel: RustProducerErrorReference["channel"]): TargetTypeRef | undefined;
  deferredFor(declaration: Node, ordinal: number): RustDeferredProducerChannel | undefined;
  deferredErrorFor(declaration: Node, ordinal: number): TargetTypeRef | undefined;
  outwardReturnFor(declaration: Node): TargetTypeRef | undefined;
  invocationResultFor(declaration: Node): TargetTypeRef | undefined;
  bodyResultFor(declaration: Node): TargetTypeRef | undefined;
  physicalFor(declaration: Node, carrier: TargetTypeRef): TargetTypeRef | undefined;
}

export interface RustNativeCallableProducerPublication {
  readonly byDeclaration: ReadonlyMap<Node, RustNativeCallableProducer>;
  readonly byIdentity: ReadonlyMap<string, RustNativeCallableProducer>;
  readonly errors: ReadonlyMap<Node, ReadonlyMap<RustProducerErrorReference["channel"], TargetTypeRef>>;
  readonly deferred: ReadonlyMap<Node, ReadonlyMap<number, RustDeferredProducerChannel>>;
  readonly outwardReturns: ReadonlyMap<Node, TargetTypeRef>;
  readonly invocationResults: ReadonlyMap<Node, TargetTypeRef>;
  readonly bodyResults: ReadonlyMap<Node, TargetTypeRef>;
  readonly physical: ReadonlyMap<Node, ReadonlyMap<string, TargetTypeRef>>;
}

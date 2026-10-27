import type { Node } from "@tsonic/tsts";
import type { RustNativeCallableProducerPlan, RustNativeCallableProducerPublication } from "../../../../target-model/records/native/native-producers.js";
import type { RustProducerErrorReference } from "../../../../target-model/types/carriers/producer-errors.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";

export function sealRustNativeCallableProducers(input: RustNativeCallableProducerPublication): RustNativeCallableProducerPlan {
  return Object.freeze({
    producers: Object.freeze([...input.byDeclaration.values()]),
    forDeclaration: (declaration: Node) => input.byDeclaration.get(declaration),
    forIdentity: (identity: string) => input.byIdentity.get(identity),
    errorFor: (declaration: Node, channel: RustProducerErrorReference["channel"]) => input.errors.get(declaration)?.get(channel),
    deferredFor: (declaration: Node, ordinal: number) => input.deferred.get(declaration)?.get(ordinal),
    deferredErrorFor: (declaration: Node, ordinal: number) => input.deferred.get(declaration)?.get(ordinal)?.errorCarrier,
    outwardReturnFor: (declaration: Node) => input.outwardReturns.get(declaration),
    invocationResultFor: (declaration: Node) => input.invocationResults.get(declaration),
    bodyResultFor: (declaration: Node) => input.bodyResults.get(declaration),
    physicalFor: (declaration: Node, carrier: TargetTypeRef) => input.physical.get(declaration)?.get(closedMetadataKey(carrier)),
  });
}

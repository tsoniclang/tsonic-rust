import type { AstReader } from "@tsonic/tsts";
import type { SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustCallableOrigin } from "../../policy/types/callable-origins.js";
import { rustCallableProtocol, rustNativeCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustFrameCallableTargetType, rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import type { RustCallableActivation, RustCallableOwnershipPlan } from "./ownership-plan.js";

export type RustCallableOwnershipCarrierSelection =
  | { readonly kind: "selected"; readonly carrier: TargetTypeRef }
  | { readonly kind: "unresolved"; readonly reason: string };

export function selectRustCallableOwnershipCarrier(input: {
  readonly ast: AstReader;
  readonly ownership: RustCallableOwnershipPlan;
  readonly subject: SourceStorageSubject;
  readonly logicalCarrier: TargetTypeRef;
  readonly environmentFor: (activation: RustCallableActivation) => readonly TargetTypeRef[] | undefined;
  readonly instanceFor: (declaration: RustCallableActivation["ownerDeclaration"]) => TargetTypeRef | undefined;
}): RustCallableOwnershipCarrierSelection {
  const generic = rustGenericCallableValue(input.logicalCarrier);
  const protocol = rustCallableProtocol(input.logicalCarrier) ?? rustNativeCallableProtocol(input.logicalCarrier) ??
    rustGenericCallableProtocol(input.logicalCarrier, generic?.signature.typeParameters);
  if (protocol === undefined)
    return Object.freeze({ kind: "unresolved", reason: "Callable ownership requires a valid native callable signature." });
  const selection = input.ownership.storageFor(input.subject);
  if (selection.kind === "unresolved") return selection;
  if (selection.kind === "ordinary") return Object.freeze({ kind: "selected", carrier: input.logicalCarrier });
  if (generic !== undefined && generic.signature.typeParameters.length !== 0)
    return Object.freeze({ kind: "unresolved", reason: "A quantified frame requires its exact generic entry invocation protocol." });
  const origin = rustCallableOrigin(input.ast, selection.activation.activationScope);
  if (origin === undefined)
    return Object.freeze({ kind: "unresolved", reason: "Callable frame storage has no exact source activation identity." });
  const previous = rustFrameCallableValue(input.logicalCarrier);
  if (previous !== undefined && (previous.owner.origin.fileName !== origin.fileName ||
    previous.owner.origin.declarationIdentity !== origin.declarationIdentity))
    return Object.freeze({ kind: "unresolved", reason: "A callable cannot silently change its physical activation owner." });
  const environment = input.environmentFor(selection.activation);
  const instance = selection.activation.kind === "class" ? input.instanceFor(selection.activation.ownerDeclaration) : undefined;
  const owner = selection.activation.kind === "lexical" ? { kind: "lexical" as const, origin }
    : instance === undefined ? undefined : { kind: "class" as const, origin, instance };
  const selected = environment === undefined || owner === undefined ? undefined
    : rustFrameCallableTargetType(protocol.parameters, protocol.result, owner, environment);
  if (selected === undefined)
    return Object.freeze({ kind: "unresolved", reason: "Callable frame storage has no exact owner, signature or captured type environment." });
  return Object.freeze({ kind: "selected", carrier: selected });
}

import type { AstReader } from "@tsonic/tsts";
import type { SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustCallableOrigin } from "../../policy/types/callable-origins.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustFrameCallableTargetType, rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import type { RustCallableOwnershipComponent } from "./ownership-components.js";
import type { RustCallableOwnershipPlan } from "./ownership-plan.js";

export type RustCallableOwnershipCarrierSelection =
  | { readonly kind: "selected"; readonly carrier: TargetTypeRef }
  | { readonly kind: "unresolved"; readonly reason: string };

export function selectRustCallableOwnershipCarrier(input: {
  readonly ast: AstReader;
  readonly ownership: RustCallableOwnershipPlan;
  readonly subject: SourceStorageSubject;
  readonly logicalCarrier: TargetTypeRef;
  readonly environmentFor: (component: RustCallableOwnershipComponent) => readonly TargetTypeRef[] | undefined;
}): RustCallableOwnershipCarrierSelection {
  const protocol = rustCallableProtocol(input.logicalCarrier);
  if (protocol === undefined)
    return Object.freeze({ kind: "unresolved", reason: "Callable ownership requires a valid native callable signature." });
  const selection = input.ownership.storageFor(input.subject);
  if (selection.kind === "unresolved") return selection;
  if (selection.kind === "ordinary") return Object.freeze({ kind: "selected", carrier: input.logicalCarrier });
  const generic = rustGenericCallableValue(input.logicalCarrier);
  if (generic !== undefined && generic.signature.typeParameters.length !== 0)
    return Object.freeze({ kind: "unresolved", reason: "A quantified frame requires its exact generic entry invocation protocol." });
  const origin = rustCallableOrigin(input.ast, selection.component.kind === "class"
    ? selection.component.ownerDeclaration : selection.component.identity);
  if (origin === undefined)
    return Object.freeze({ kind: "unresolved", reason: "Callable frame storage has no exact source activation identity." });
  const previous = rustFrameCallableValue(input.logicalCarrier);
  if (previous !== undefined && (previous.owner.fileName !== origin.fileName ||
    previous.owner.declarationIdentity !== origin.declarationIdentity))
    return Object.freeze({ kind: "unresolved", reason: "A callable cannot silently change its physical activation owner." });
  const environment = input.environmentFor(selection.component);
  const selected = environment === undefined ? undefined
    : rustFrameCallableTargetType(protocol.parameters, protocol.result, origin, environment);
  if (selected === undefined)
    return Object.freeze({ kind: "unresolved", reason: "Callable frame storage has no exact owner, signature or captured type environment." });
  return Object.freeze({ kind: "selected", carrier: selected });
}

import type { AstReader } from "@tsonic/tsts";
import type { SourceStorageProducer } from "@tsonic/target-api/analysis";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustCallableOrigin } from "../../policy/types/callables/callable-origins.js";
import { rustCallableProtocol, rustNativeCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustFrameCallableTargetType, rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import { selectRustCallableOwnership, type RustCallableOwnershipInput, type RustCallableOwnershipPlan } from "./ownership-plan.js";
import type { RustCallableActivation } from "../../target-model/records/callable-ownership.js";
import type { RustClassFrameInstantiation } from "../source-evidence/types/resolution/model.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export type RustCallableOwnershipCarrierSelection =
  | { readonly kind: "selected"; readonly carrier: TargetTypeRef }
  | { readonly kind: "unresolved"; readonly reason: string };

export function selectRustCallableOwnershipCarrier(input: {
  readonly ast: AstReader;
  readonly ownership: RustCallableOwnershipPlan;
  readonly source: Pick<SourceStorageProducer, "subject" | "bindings">;
  readonly selection: RustCallableOwnershipInput;
  readonly logicalCarrier: TargetTypeRef;
  readonly environmentFor: (activation: RustCallableActivation) => readonly TargetTypeRef[] | undefined;
  readonly classFrameFor: (declaration: RustCallableActivation["ownerDeclaration"]) => RustClassFrameInstantiation | undefined;
}): RustCallableOwnershipCarrierSelection {
  const generic = rustGenericCallableValue(input.logicalCarrier);
  const protocol = rustCallableProtocol(input.logicalCarrier) ?? rustNativeCallableProtocol(input.logicalCarrier) ??
    rustGenericCallableProtocol(input.logicalCarrier, generic?.signature.typeParameters);
  if (protocol === undefined)
    return Object.freeze({ kind: "unresolved", reason: "Callable ownership requires a valid native callable signature." });
  const selection = selectRustCallableOwnership(input.ownership, input.source.subject, input.selection);
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
  const classFrame = selection.activation.kind === "class" ? input.classFrameFor(selection.activation.ownerDeclaration) : undefined;
  const owner = selection.activation.kind === "lexical" ? { kind: "lexical" as const, origin }
    : classFrame === undefined ? undefined : { kind: "class" as const, origin, instance: classFrame.instance };
  const template = environment === undefined || owner === undefined ? undefined
    : rustFrameCallableTargetType(classFrame?.parameters ?? protocol.parameters,
      classFrame?.result ?? protocol.result, owner, environment);
  const selected = template === undefined || classFrame === undefined ? template
    : substituteRustTargetGenerics(template, classFrame.bindings.types, classFrame.bindings.lifetimes, classFrame.bindings.consts);
  if (selected === undefined)
    return Object.freeze({ kind: "unresolved", reason: "Callable frame storage has no exact owner, signature or captured type environment." });
  const selectedProtocol = rustCallableProtocol(selected);
  if (selectedProtocol === undefined || selectedProtocol.parameters.length !== protocol.parameters.length ||
    !selectedProtocol.parameters.every((parameter, index) => rustTargetTypeRefEquals(parameter, protocol.parameters[index])) ||
    !rustTargetTypeRefEquals(selectedProtocol.result, protocol.result))
    return Object.freeze({ kind: "unresolved", reason: "Callable frame instantiation differs from its exact checked invocation signature." });
  return Object.freeze({ kind: "selected", carrier: selected });
}

import type { AstReader } from "@tsonic/tsts";
import type { SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustCallableOrigin } from "../../policy/types/callables/callable-origins.js";
import { rustCallableProtocol, rustNativeCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustFrameCallableTargetType, rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import type { RustCallableOwnershipPlan } from "./ownership-plan.js";
import type { RustCallableActivation } from "../../target-model/records/callable-ownership.js";
import type { RustClassFrameInstantiationSelection, RustTargetTypeResolutionOptions } from "../source-evidence/types/resolution/model.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { appendRustDiagnostic, type RustFactWalk } from "../program/walk.js";

export type RustCallableOwnershipCarrierSelection =
  | { readonly kind: "selected"; readonly carrier: TargetTypeRef }
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "unresolved"; readonly reason: string };

export function resolveRustCallableOwnershipCarrier(
  walk: RustFactWalk,
  subject: SourceStorageSubject,
  logicalCarrier: TargetTypeRef,
  environmentFor: Parameters<RustTargetTypeResolutionOptions["callableStorageCarrier"]>[2],
  classFrameFor: Parameters<RustTargetTypeResolutionOptions["callableStorageCarrier"]>[3],
): TargetTypeRef | undefined {
  const selected = selectRustCallableOwnershipCarrier({
    ast: walk.context.ast, ownership: walk.context.callableOwnership,
    subject, logicalCarrier, classFrameFor,
    environmentFor(component) {
      const excluded = new Set([...component.slotDeclarations, component.ownerDeclaration]);
      const environments = component.callableDeclarations.map(declaration => environmentFor(declaration, excluded));
      return environments.some(environment => environment === undefined) ? undefined
        : Object.freeze(environments.flatMap(environment => environment!));
    },
  });
  if (selected.kind === "rejected")
    appendRustDiagnostic(walk, "RUST_CALLABLE_FRAME_RECEIVER_NOT_PROVEN", selected.reason, subject.node,
      ["target.capability=rust.callable-value.exact-receiver-instantiation"]);
  return selected.kind === "selected" ? selected.carrier : undefined;
}

export function selectRustCallableOwnershipCarrier(input: {
  readonly ast: AstReader;
  readonly ownership: RustCallableOwnershipPlan;
  readonly subject: SourceStorageSubject;
  readonly logicalCarrier: TargetTypeRef;
  readonly environmentFor: (activation: RustCallableActivation) => readonly TargetTypeRef[] | undefined;
  readonly classFrameFor: (declaration: RustCallableActivation["ownerDeclaration"]) => RustClassFrameInstantiationSelection | undefined;
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
  const classFrame = selection.activation.kind === "class" ? input.classFrameFor(selection.activation.ownerDeclaration) : undefined;
  if (classFrame?.kind === "rejected") return classFrame;
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

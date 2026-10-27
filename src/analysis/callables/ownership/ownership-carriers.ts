import type { AstReader } from "@tsonic/tsts";
import type { SourceStorageProducer } from "@tsonic/target-api/analysis";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustCallableOrigin } from "../../../policy/types/callables/callable-origins.js";
import { rustCallableInputTargetType, rustCallableProtocol, rustNativeCallableProtocol } from "../../../target-model/types/carriers/callables.js";
import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { rustFrameCallableTargetType, rustFrameCallableValue } from "../../../target-model/types/carriers/frame-callables.js";
import { selectRustCallableOwnership, type RustCallableOwnershipInput, type RustCallableOwnershipPlan } from "./ownership-plan.js";
import type { RustCallableActivation } from "../../../target-model/records/callables/callable-ownership.js";
import type { RustClassFrameInstantiationSelection, RustTargetTypeResolutionOptions } from "../../source-evidence/types/resolution/model.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { appendRustDiagnostic, type RustFactWalk } from "../../program/walk.js";
import { rustCallableInputMatches } from "../../../policy/conversions/callable-input.js";

export type RustCallableOwnershipCarrierSelection =
  | { readonly kind: "selected"; readonly carrier: TargetTypeRef }
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "unresolved"; readonly reason: string };

export function resolveRustCallableOwnershipCarrier(
  walk: RustFactWalk,
  source: Pick<SourceStorageProducer, "subject" | "bindings">,
  selection: RustCallableOwnershipInput,
  logicalCarrier: TargetTypeRef,
  environmentFor: Parameters<RustTargetTypeResolutionOptions["callableStorageCarrier"]>[3],
  classFrameFor: Parameters<RustTargetTypeResolutionOptions["callableStorageCarrier"]>[4],
): TargetTypeRef | undefined {
  const selected = selectRustCallableOwnershipCarrier({
    ast: walk.context.ast, ownership: walk.context.callableOwnership,
    source, selection, logicalCarrier, classFrameFor,
    formalInputFor(origin) {
      const { subject, bindings } = origin;
      const storage = walk.context.sourceStorage;
      if (subject.kind !== "input" || subject.projection.length !== 0 || !walk.context.ast.is.IsParameterDeclaration(subject.node)) return undefined;
      const original = storage.subject(subject.node, "input");
      const lexical = storage.bindingsForLexicalOwner(subject.node);
      if (original.kind !== "resolved" || original.subject !== subject || lexical.kind !== "resolved") return undefined;
      const selectedKey = storage.contextKeyFor([subject], bindings);
      const lexicalKey = storage.contextKeyFor([subject], lexical.bindings);
      return selectedKey.kind === "resolved" && lexicalKey.kind === "resolved" && selectedKey.key === lexicalKey.key
        ? walk.context.records.sourceParameterAbi.get(subject.node)?.valueCarrier : undefined;
    },
    environmentFor(component) {
      const excluded = new Set([...component.slotDeclarations, component.ownerDeclaration]);
      const environments = component.callableDeclarations.map(declaration => environmentFor(declaration, excluded));
      return environments.some(environment => environment === undefined) ? undefined
        : Object.freeze(environments.flatMap(environment => environment!));
    },
  });
  if (selected.kind === "rejected")
    appendRustDiagnostic(walk, "RUST_CALLABLE_FRAME_RECEIVER_NOT_PROVEN", selected.reason, source.subject.node,
      ["target.capability=rust.callable-value.exact-receiver-instantiation"]);
  return selected.kind === "selected" ? selected.carrier : undefined;
}

export function selectRustCallableOwnershipCarrier(input: {
  readonly ast: AstReader;
  readonly ownership: RustCallableOwnershipPlan;
  readonly source: Pick<SourceStorageProducer, "subject" | "bindings">;
  readonly selection: RustCallableOwnershipInput;
  readonly logicalCarrier: TargetTypeRef;
  readonly formalInputFor: (origin: Pick<SourceStorageProducer, "subject" | "bindings">) => TargetTypeRef | undefined;
  readonly environmentFor: (activation: RustCallableActivation) => readonly TargetTypeRef[] | undefined;
  readonly classFrameFor: (declaration: RustCallableActivation["ownerDeclaration"]) => RustClassFrameInstantiationSelection | undefined;
}): RustCallableOwnershipCarrierSelection {
  const generic = rustGenericCallableValue(input.logicalCarrier);
  const protocol = rustCallableProtocol(input.logicalCarrier) ?? rustNativeCallableProtocol(input.logicalCarrier) ??
    rustGenericCallableProtocol(input.logicalCarrier, generic?.signature.typeParameters);
  if (protocol === undefined)
    return Object.freeze({ kind: "unresolved", reason: "Callable ownership requires a valid native callable signature." });
  const origins = input.selection.kind === "storage" && input.selection.producers.kind === "open"
    ? input.selection.producers.producers : [];
  const signature = rustCallableInputTargetType(protocol.parameters, protocol.result);
  const physicalInputs = origins.flatMap(origin => {
    const carrier = input.formalInputFor(origin);
    return carrier === undefined || !rustCallableInputMatches(carrier, signature) ? [] : [{ ...origin, carrier }];
  });
  const selection = selectRustCallableOwnership(input.ownership, input.source.subject, input.selection, physicalInputs);
  if (selection.kind === "unresolved") return selection;
  if (selection.kind === "ordinary") {
    if (physicalInputs.length === 0) return Object.freeze({ kind: "selected", carrier: input.logicalCarrier });
    const carrier = physicalInputs[0]!.carrier;
    return physicalInputs.length === origins.length && physicalInputs.every(input => rustTargetTypeRefEquals(input.carrier, carrier))
      ? Object.freeze({ kind: "selected", carrier })
      : Object.freeze({ kind: "unresolved", reason: "Callable storage requires one exact physical ABI for every input and producer." });
  }
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

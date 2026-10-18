import type { Node } from "@tsonic/tsts";
import type { TargetUseSiteRef } from "@tsonic/target-api/analysis";
import type { RustClosureCaptureFact } from "../../target-model/records/operation-selections.js";
import type { RustNativeCaptureSlotFact, RustNativeStorageBindingRequest } from "../../target-model/records/physical-emission-contexts.js";
import type { RustNamedTypeTraitRequirement, RustTargetGenericArgument, RustTargetTraitRef, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import { rustNamedTypeRequirementsForArguments } from "../../target-model/types/carriers/native.js";
import { rustGenericCallableStorageArguments } from "../../target-model/types/carriers/generic-callable-storage.js";
import { substituteRustTargetGenericArgument, substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustGenericRequirementBound } from "../../target-model/lifetimes/model.js";
import { rustBuiltInCarrierDefinitions } from "../../target-model/types/carriers/built-ins.js";
import { rustRetainedErrorTargetId } from "../../target-model/types/carriers/source-error.js";
import { selectRustNativeCallableEnvironment, type RustNativeTypeInputContext } from "../../policy/types/model/native-type-selection.js";
import type { RustDeclarationGenericRequirementContract, RustDeclarationGenericRequirementIndex } from "../declarations/generic-requirements.js";
import type { RustFrameCallableDefinition, RustFrameCallableEntryDefinition, RustFrameCallableImplementation } from "./frame-values.js";
import type { RustGenericCallableEnvironment } from "./generic-environments.js";
import type { RustGenericCallablePhysicalMember } from "./generic-physical.js";
import type { RustGenericCallableDefinition, RustGenericCallableImplementation } from "./generic-values.js";
import type { RustLexicalFunctionSelection } from "./lexical-functions.js";
import type { RustNativeCallableProducer } from "./native-producers.js";
import type { RustSuspendedCallableImplementation } from "./suspended-values.js";

export type RustNativeCaptureEnvironment =
  | { readonly kind: "generic";
      readonly definition: RustGenericCallableDefinition;
      readonly implementation: RustGenericCallableImplementation;
      readonly member: RustGenericCallablePhysicalMember | undefined;
      readonly environment: RustGenericCallableEnvironment;
      readonly arguments: readonly RustTargetGenericArgument[] }
  | { readonly kind: "frame";
      readonly definition: RustFrameCallableDefinition;
      readonly entry: RustFrameCallableEntryDefinition;
      readonly implementation: RustFrameCallableImplementation }
  | { readonly kind: "suspended"; readonly implementation: RustSuspendedCallableImplementation }
  | { readonly kind: "native";
      readonly producer: RustNativeCallableProducer;
      readonly capture: RustClosureCaptureFact;
      readonly creation: { readonly kind: "definition" }
        | { readonly kind: "expression"; readonly use: TargetUseSiteRef } }
  | { readonly kind: "lexical";
      readonly declaration: Node;
      readonly producer: RustNativeCallableProducer;
      readonly lexical: Extract<RustLexicalFunctionSelection, { readonly kind: "resolved" }> };

export interface RustPreparedNativeCaptureInput {
  readonly environment: RustNativeCaptureEnvironment;
  readonly slots: readonly { readonly slot: RustNativeCaptureSlotFact; readonly slotIndex: number }[];
}

export type RustPreparedNativeStorageBindingRequest = Omit<RustNativeStorageBindingRequest, "source"> & {
  readonly source:
    | Exclude<RustNativeStorageBindingRequest["source"], { readonly kind: "capture" }>
    | { readonly kind: "capture"; readonly input: RustPreparedNativeCaptureInput;
        readonly slot: RustNativeCaptureSlotFact; readonly slotIndex: number;
        readonly initialization: "ready" | "deferred" };
};

export function rustNativeCaptureInputs(
  environment: RustNativeCaptureEnvironment,
  capture: Pick<RustClosureCaptureFact, "captures" | "receiverFields" | "receivers">,
): readonly RustPreparedNativeCaptureInput[] {
  const slots: RustNativeCaptureSlotFact[] = [
    ...capture.captures.map(value => Object.freeze({ kind: "binding" as const, capture: value })),
    ...capture.receiverFields.map(value => Object.freeze({ kind: "receiver-field" as const, capture: value })),
    ...capture.receivers.map(value => Object.freeze({ kind: "receiver" as const, capture: value })),
  ];
  return Object.freeze([Object.freeze({ environment,
    slots: Object.freeze(slots.map((slot, slotIndex) => Object.freeze({ slot, slotIndex }))) })]);
}

export function rustNativeCaptureInputsForCreation(
  inputs: readonly RustPreparedNativeCaptureInput[],
  use: TargetUseSiteRef,
): readonly RustPreparedNativeCaptureInput[] {
  return Object.freeze(inputs.map(input => input.environment.kind !== "native" ? input : Object.freeze({ ...input,
    environment: Object.freeze({ ...input.environment, creation: Object.freeze({ kind: "expression" as const, use }) }) })));
}

export function completeRustNativeNamedCaptureEnvironment(
  environment: Extract<RustNativeCaptureEnvironment, { readonly kind: "generic" | "frame" | "suspended" }>,
  input: {
    readonly bindings: RustTargetGenericBindings;
    readonly nativeContext: RustNativeTypeInputContext;
    readonly declarationGenericRequirements: Pick<RustDeclarationGenericRequirementIndex, "contractFor">;
  },
): (Extract<ReturnType<typeof selectRustNativeCallableEnvironment>, { readonly kind: "resolved" }> & {
    readonly arguments: readonly RustTargetGenericArgument[];
    readonly slotPaths: readonly (readonly string[])[];
  }) | Extract<ReturnType<typeof selectRustNativeCallableEnvironment>, { readonly kind: "rejected" }>
  | { readonly kind: "none" } {
  const implementation = environment.implementation;
  const subject = implementation.carrier;
  const reject = (reason: string): Extract<ReturnType<typeof selectRustNativeCallableEnvironment>, { readonly kind: "rejected" }> =>
    ({ kind: "rejected", subject, reason });
  const contracts: RustDeclarationGenericRequirementContract[] = [];
  const declarations = environment.kind === "frame"
    ? environment.definition.entries.flatMap(entry => entry.implementations.map(selected => selected.declaration))
    : [implementation.declaration];
  for (const declaration of declarations) {
    const contract = input.declarationGenericRequirements.contractFor(declaration);
    if (contract === undefined) return reject("A native capture environment requires every original declaration's completed generic contract.");
    contracts.push(contract);
  }
  let parameters: readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[];
  let originalArguments: readonly RustTargetGenericArgument[];
  let fileName: string;
  let storage: "value" | "shared" | "cyclic";
  let slots: number;
  if (environment.kind === "generic") {
    parameters = [];
    originalArguments = rustGenericCallableStorageArguments(environment.definition.signature.environmentParameters, environment.arguments);
    fileName = environment.implementation.sourceFileName;
    storage = environment.implementation.storage;
    slots = environment.environment.captures.length + environment.environment.receiverFields.length + environment.environment.receivers.length;
  } else if (environment.kind === "frame") {
    if (environment.implementation.independent) return reject("An independent callable requires its actual native producer, not a fabricated frame state.");
    parameters = environment.definition.environmentParameters;
    originalArguments = parameters.map(type => Object.freeze({ kind: "type" as const, type }));
    fileName = environment.definition.ownerFileName;
    storage = environment.implementation.copy ? "value" : "shared";
    slots = environment.implementation.captures.length + environment.implementation.receiverFields.length + environment.implementation.receivers.length;
    if (slots === 0 && parameters.length === 0) return Object.freeze({ kind: "none" });
  } else {
    parameters = environment.implementation.environment.typeParameters;
    originalArguments = [
      ...environment.implementation.environment.lifetimes.map(lifetime => Object.freeze({ kind: "lifetime" as const, lifetime })),
      ...parameters.map(type => Object.freeze({ kind: "type" as const, type })),
    ];
    fileName = environment.implementation.sourceFileName;
    storage = "cyclic";
    slots = environment.implementation.captures.length + environment.implementation.receiverFields.length + environment.implementation.receivers.length;
  }
  const requirements: { readonly identity: string; readonly traits: readonly RustTargetTraitRef[] }[] = [];
  for (const parameter of parameters) {
    const selected = contracts.flatMap(contract => [...contract.typeParameters, ...contract.capturedTypeParameters,
      ...(environment.kind === "suspended" ? contract.nativeInputs : [])]).filter(row => row.identity === parameter.identity);
    if (selected.length === 0) return reject("A native capture type parameter requires its exact original generic requirement row.");
    const traits: RustTargetTraitRef[] = [];
    for (const requirement of new Set(selected.flatMap(row => row.requirements))) {
      const bound = rustGenericRequirementBound(requirement, { identity: rustRetainedErrorTargetId,
        path: rustBuiltInCarrierDefinitions[rustRetainedErrorTargetId]?.renderPath });
      if (bound === undefined) return reject("A native capture requirement has no exact native bound declaration.");
      if (bound.kind === "trait-ref") traits.push(bound);
    }
    requirements.push({ identity: parameter.identity, traits });
  }
  const geometry = rustNamedTypeRequirementsForArguments(originalArguments, requirements);
  if (geometry === undefined) return reject("A native capture requirement has no exact original declaration-template TYPE slot.");
  const typeRequirements: RustNamedTypeTraitRequirement[] = [];
  for (const requirement of geometry) {
    const trait = substituteRustTargetGenerics(requirement.trait, input.bindings.types, input.bindings.lifetimes, input.bindings.consts);
    if (trait.kind !== "trait-ref") return reject("A native capture requirement lost its exact trait during original binding substitution.");
    typeRequirements.push({ ...requirement, trait });
  }
  const arguments_ = Object.freeze(originalArguments.map(argument => substituteRustTargetGenericArgument(argument,
    input.bindings.types, input.bindings.lifetimes, input.bindings.consts)));
  const selected = selectRustNativeCallableEnvironment({ fileName, stateName: implementation.stateName,
    arguments: arguments_, typeRequirements, storage }, input.nativeContext);
  if (selected.kind === "rejected") return selected;
  const slotPaths = Object.freeze(Array.from({ length: slots }, (_unused, index) => Object.freeze(
    environment.kind === "suspended" ? ["state", String(index)] : [`capture_${index}`])));
  return Object.freeze({ ...selected, arguments: arguments_, slotPaths });
}

import type { Node } from "@tsonic/tsts";
import type { TargetUseSiteRef } from "@tsonic/target-api/analysis";
import type { RustClosureCaptureFact } from "../../target-model/records/operation-selections.js";
import type { RustNativeStorageBindingRequest } from "../../target-model/records/physical-emission-contexts.js";
import type { RustTargetGenericArgument } from "../../target-model/types/model.js";
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
      readonly lexical: Extract<RustLexicalFunctionSelection, { readonly kind: "resolved" }> };

export type RustNativeCaptureSlot =
  | { readonly kind: "binding"; readonly capture: RustClosureCaptureFact["captures"][number] }
  | { readonly kind: "receiver-field"; readonly capture: RustClosureCaptureFact["receiverFields"][number] }
  | { readonly kind: "receiver"; readonly capture: RustClosureCaptureFact["receivers"][number] };

export interface RustPreparedNativeCaptureInput {
  readonly environment: RustNativeCaptureEnvironment;
  readonly slots: readonly { readonly slot: RustNativeCaptureSlot; readonly slotIndex: number }[];
}

export type RustPreparedNativeStorageBindingRequest = Omit<RustNativeStorageBindingRequest, "source"> & {
  readonly source:
    | Exclude<RustNativeStorageBindingRequest["source"], { readonly kind: "capture" }>
    | { readonly kind: "capture"; readonly input: RustPreparedNativeCaptureInput;
        readonly slot: RustNativeCaptureSlot; readonly slotIndex: number;
        readonly initialization: "ready" | "deferred" };
};

export function rustNativeCaptureInputs(
  environment: RustNativeCaptureEnvironment,
  capture: Pick<RustClosureCaptureFact, "captures" | "receiverFields" | "receivers">,
): readonly RustPreparedNativeCaptureInput[] {
  const slots: RustNativeCaptureSlot[] = [
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

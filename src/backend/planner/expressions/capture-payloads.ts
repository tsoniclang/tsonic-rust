import type { RustClosureCaptureFact } from "../../../analysis/facts/keys.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr, RustType } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCallableCaptureStorageType } from "../types/capture-storage.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustCapturedReceiverContext, rustCapturedReceiverFieldContext, rustCapturedReceiverFieldType } from "./receiver-captures.js";

export interface RustCallableCapturePayload {
  readonly captures: readonly (RustClosureCaptureFact["captures"][number] & { readonly storageCarrier?: TargetTypeRef })[];
  readonly receiverFields: readonly (RustClosureCaptureFact["receiverFields"][number] & { readonly storageCarrier?: TargetTypeRef })[];
  readonly receivers: readonly (RustClosureCaptureFact["receivers"][number] & { readonly storageCarrier?: TargetTypeRef })[];
}

export function rustCallablePayloadTypes(
  payload: RustCallableCapturePayload, context: RustPlanContext,
): readonly RustType[] | undefined {
  const types = [...payload.captures.map(capture => rustCallableCaptureStorageType(capture, capture.storageCarrier ?? capture.carrier, context)),
    ...payload.receiverFields.map(capture => {
      const type = rustTypeFromCarrierInContext(capture.storageCarrier ?? capture.carrier, context);
      return type === undefined ? undefined : rustCapturedReceiverFieldType(capture, type, context);
    }), ...payload.receivers.map(capture => rustTypeFromCarrierInContext(capture.storageCarrier ?? capture.carrier, context))];
  return types.some(type => type === undefined) ? undefined : types as readonly RustType[];
}

export function rustCallablePayloadContext(
  payload: RustCallableCapturePayload, owner: RustExpr, context: RustPlanContext,
): RustPlanContext {
  const field = (index: number): RustExpr => ({ kind: "field", receiver: owner, name: `capture_${index}` });
  const fields = rustCapturedReceiverFieldContext(payload.receiverFields, { ...context,
    capturedBindings: payload.captures.map((capture, index) => ({
      declaration: capture.declaration, expression: { kind: "reference", expr: field(index) },
      storage: capture.storage, valueCarrier: capture.carrier, borrowed: "shared",
    })),
  }, index => field(payload.captures.length + index));
  return rustCapturedReceiverContext(payload.receivers, fields,
    index => field(payload.captures.length + payload.receiverFields.length + index));
}

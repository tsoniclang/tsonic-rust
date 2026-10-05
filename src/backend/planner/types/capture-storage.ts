import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustLocationTargetType } from "../../../target-model/types/index.js";
import type { RustClosureCaptureFact } from "../../../analysis/facts/operations/keys.js";
import type { RustType } from "../../target-ast/nodes.js";
import { rustInlineBindingStorageType } from "../expressions/binding-storage.js";
import { rustTypeFromCarrierInContext, type RustTypeRenderingContext } from "./render.js";

export function rustCallableCaptureStorageType(
  capture: RustClosureCaptureFact["captures"][number], carrier: TargetTypeRef, context: RustTypeRenderingContext,
): RustType | undefined {
  const type = rustTypeFromCarrierInContext(capture.storage === "location" ? rustLocationTargetType(carrier) : carrier, context);
  return type === undefined ? undefined : capture.storage === "cell" || capture.storage === "borrow-cell"
    ? rustInlineBindingStorageType(capture.storage, type) : type;
}

import type { RustClosureCaptureFact } from "../../../target-model/records/operation-selections.js";
import type { RustType } from "../../target-ast/syntax/nodes.js";
import { requireRustNativeBindingStorage } from "../expressions/binding-storage.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromSelectedNativeCarrierInContext } from "./render.js";

export function rustCallableCaptureStorageType(
  capture: Pick<RustClosureCaptureFact["captures"][number], "declaration">, context: RustPlanContext,
): RustType {
  return rustTypeFromSelectedNativeCarrierInContext(requireRustNativeBindingStorage(capture.declaration, context).slotCarrier, context);
}

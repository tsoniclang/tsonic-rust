import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustFrameCallableBinding, RustFrameCallableEntryDefinition } from "../../target-model/records/callables/frame-callables.js";
import { isRustCopyCarrier } from "../constraints/native-traits.js";

export function selectRustFrameBindingStorage(input: {
  readonly entry: Pick<RustFrameCallableEntryDefinition, "copy"> | undefined;
  readonly carrier: TargetTypeRef;
  readonly location: boolean;
  readonly standalone: boolean;
  readonly mutableObject: boolean;
  readonly immutable: boolean;
  readonly classOwned: boolean;
}): RustFrameCallableBinding["storage"] {
  if (input.entry === undefined && input.location) return "location";
  if (!input.standalone && input.mutableObject || input.immutable && (input.classOwned || input.entry === undefined)) return "value";
  return input.entry?.copy === true || input.entry === undefined && isRustCopyCarrier(input.carrier) ? "cell" : "borrow-cell";
}

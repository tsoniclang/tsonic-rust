import type { Node } from "@tsonic/tsts";
import type { RustNativeCallableInput } from "../native/native-protocols.js";
import type { TargetTypeRef } from "../../types/model.js";

export interface RustRetainedCallableBoundary {
  readonly inputs: readonly RustNativeCallableInput[];
  readonly errorCarrier: TargetTypeRef;
}

export interface RustRetainedCallableInputPlan {
  forInput(input: RustNativeCallableInput): readonly TargetTypeRef[];
  forBoundary(call: Node, argumentIndex: number): RustRetainedCallableBoundary | undefined;
}

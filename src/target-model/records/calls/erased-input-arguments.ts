import type { RustNativeCallableInput } from "../native/native-protocols.js";
import type { TargetTypeRef } from "../../types/model.js";

/** A native input passed where a type-erased runtime callable is expected, erased into that callable. */
export interface RustErasedInputArgument {
  readonly input: RustNativeCallableInput;
  /** The type-erased runtime callable parameter the input is erased into. */
  readonly carrier: TargetTypeRef;
  readonly parameterCount: number;
}

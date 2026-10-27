import type { RustNativeCallableInput } from "../native/native-protocols.js";

export type RustLocationCallbackEmission =
  | { readonly kind: "direct" }
  | { readonly kind: "adapter"; readonly parameterCount: number; readonly input: RustNativeCallableInput | undefined };

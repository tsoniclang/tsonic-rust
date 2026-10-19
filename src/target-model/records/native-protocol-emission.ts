import type { RustNativeCallableProtocol } from "./native-protocols.js";
import type { RustNativeCallableCompletion } from "../types/callable-completions.js";

export interface RustNativeProtocolEmission {
  readonly invoked: boolean;
  readonly nativeFutures: NonNullable<RustNativeCallableCompletion>["futures"];
}

export interface RustNativeProtocolReader {
  readonly get: (protocol: RustNativeCallableProtocol) => RustNativeProtocolEmission | undefined;
}

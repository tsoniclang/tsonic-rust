import type { AstReader, SourceFile } from "@tsonic/tsts";
import type { RustNativeCallableInputPlan } from "./native-inputs.js";
import type { RustNativeCallableProtocol } from "./native-protocols.js";

export interface RustNativeCallableDispatchPlan {
  requiredFor(protocol: RustNativeCallableProtocol): boolean;
}

export function createRustNativeCallableDispatchPlan(input: {
  readonly ast: Pick<AstReader, "getFileName">;
  readonly closedSourceFiles: ReadonlySet<SourceFile>;
  readonly native: RustNativeCallableInputPlan;
}): RustNativeCallableDispatchPlan {
  const closed = new Set([...input.closedSourceFiles].map(file => input.ast.getFileName(file)));
  const invoked = new Set(input.native.calls.map(call => call.input.protocol));
  const owned = new Set(input.native.protocols);
  return Object.freeze({ requiredFor: (protocol: RustNativeCallableProtocol) =>
    !owned.has(protocol) || !closed.has(protocol.ownerFileName) || invoked.has(protocol) });
}

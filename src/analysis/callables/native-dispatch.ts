import type { AstReader, SourceFile } from "@tsonic/tsts";
import type { RustNativeCallableInputPlan } from "./native-inputs.js";
import type { RustNativeCallableDispatchPlan } from "../../target-model/records/native-dispatch.js";
import { sealRustNativeCallableDispatch } from "../program/records/native-dispatch.js";
import { sourceExpressionResultDisposition, type SourceProgramNavigation } from "@tsonic/target-api/source";

export function createRustNativeCallableDispatchPlan(input: {
  readonly ast: AstReader;
  readonly navigation: Pick<SourceProgramNavigation, "declarationUses">;
  readonly closedSourceFiles: ReadonlySet<SourceFile>;
  readonly native: RustNativeCallableInputPlan;
}): RustNativeCallableDispatchPlan {
  const closed = new Set([...input.closedSourceFiles].map(file => input.ast.getFileName(file)));
  const invoked = new Set(input.native.calls.map(call => call.input.protocol));
  for (const selected of input.native.inputs) {
    if (input.navigation.declarationUses(selected.subject.node).some(use => {
      const disposition = sourceExpressionResultDisposition(input.ast, use.reference);
      return disposition.kind !== "returned" && disposition.kind !== "discarded";
    })) invoked.add(selected.protocol);
  }
  const required = new Map(input.native.protocols.map(protocol =>
    [protocol, !closed.has(protocol.ownerFileName) || invoked.has(protocol)] as const));
  return sealRustNativeCallableDispatch(required);
}

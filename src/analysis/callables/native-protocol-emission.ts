import type { SourceFile } from "@tsonic/tsts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustNativeProtocolProducer } from "../program/records/native-protocol-emission.js";
import { rustJsPromiseOutputTargetType } from "../../target-model/types/carriers/promises.js";

export function analyzeRustNativeProtocolEmission(input: {
  readonly program: Pick<RustTargetProgram, "callableValues">;
  readonly sourceFiles: readonly SourceFile[];
  readonly producer: RustNativeProtocolProducer;
}): void {
  const protocols = Object.freeze([...input.program.callableValues.native.protocols]);
  for (const protocol of protocols) input.producer.select(protocol, {
    invoked: input.program.callableValues.nativeDispatch.requiredFor(protocol),
    nativeFutures: Object.freeze((protocol.completion?.futures ?? []).filter(future => rustJsPromiseOutputTargetType(future.carrier) === undefined)),
  });
  for (const sourceFile of input.sourceFiles) input.producer.sourceFile(sourceFile, protocols);
}

import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { SourceFile } from "@tsonic/tsts";
import type { RustAnalysisProgram } from "../../program/model.js";
import type { RustSuspendedCallableProducer } from "../../program/records/suspended-callables.js";
import { rustCallableProtocol, rustLocationTargetType } from "../../../target-model/types/index.js";
import { rustStaticLifetime } from "../../../target-model/lifetimes/index.js";
import { substituteElidedLifetime } from "../../../target-model/types/carriers/lifetime-elision.js";
import { bindRustElidedCallableInput } from "../../../policy/types/callables/lifetime-elision.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustCallablePhysicalSignature } from "../../../target-model/conversions/callable-physical.js";
import { rustNamedTargetType } from "../../../target-model/types/carriers/native.js";

export function analyzeRustSuspendedCallableEmission(input: {
  readonly program: Omit<RustAnalysisProgram, "reachability">;
  readonly sourceFiles: readonly SourceFile[];
  readonly producer: RustSuspendedCallableProducer;
}): void {
  const { program } = input;
  const implementations = program.callableValues.suspended.implementations;
  for (const implementation of implementations) {
    const { declaration } = implementation;
    const captures = program.callableValues.nativeCaptures.forDeclaration(declaration);
    if (captures.kind !== "resolved") failTargetAnalysisInvariant("tsonic-rust", "An admitted suspended callable requires its finalized native capture storage.", declaration);
    const captured = captures.captures.map(carrier => substituteElidedLifetime(carrier, rustStaticLifetime));
    if (implementation.storage.length !== implementation.captures.length + implementation.receiverFields.length + implementation.receivers.length ||
      !implementation.captures.every((capture, index) => rustTargetTypeRefEquals(implementation.storage[index], capture.storage === "location" ? rustLocationTargetType(captured[index]!) : captured[index])) ||
      !implementation.receiverFields.every((_capture, index) => rustTargetTypeRefEquals(implementation.storage[implementation.captures.length + index], substituteElidedLifetime(captures.receiverFields[index]!, rustStaticLifetime))) ||
      !implementation.receivers.every((_capture, index) => rustTargetTypeRefEquals(implementation.storage[implementation.captures.length + implementation.receiverFields.length + index], substituteElidedLifetime(captures.receivers[index]!, rustStaticLifetime))))
      failTargetAnalysisInvariant("tsonic-rust", "An admitted suspended callable requires its exact checked native state layout.", declaration);
    const protocol = rustCallableProtocol(implementation.carrier);
    const bound = protocol === undefined || implementation.elision === undefined ? undefined
      : bindRustElidedCallableInput(protocol.parameters, protocol.result, implementation.elision.lifetime);
    if (protocol === undefined || implementation.elision !== undefined && bound?.parameterIndex !== implementation.elision.parameterIndex)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted suspended callable requires its exact named input lifetime.", declaration);
    const physical = program.callableValues.nativeProducers.physicalFor(declaration, implementation.carrier);
    const signature = physical === undefined ? undefined : rustCallablePhysicalSignature(implementation.elision === undefined ? physical
      : substituteElidedLifetime(physical, implementation.elision.lifetime));
    if (signature === undefined || physical === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted suspended callable requires its exact physical invocation result.", declaration);
    input.producer.declaration(declaration, { implementation, physicalCarrier: physical, parameters: (bound ?? protocol).parameters,
      result: rustNamedTargetType("rust.core.Result", "Result", [{ kind: "type", type: signature.result }, { kind: "type", type: signature.error }]),
      captures: Object.freeze(captured) });
  }
  for (const sourceFile of input.sourceFiles) input.producer.sourceFile(sourceFile,
    implementations.filter(implementation => implementation.sourceFileName === program.source.ast.getFileName(sourceFile)));
}

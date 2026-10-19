import type { SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustNativeProtocolProducer } from "../program/records/native-protocol-emission.js";
import { rustJsPromiseOutputTargetType } from "../../target-model/types/carriers/promises.js";
import { analyzeRustNativeProducerBridge } from "./native-producer-bridges.js";
import { rustNativeFutureCallableResult } from "../../target-model/types/carriers/generic-callables.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import type { RustNativeGenericProducerBridge } from "../../target-model/records/native-protocol-emission.js";
import { emissionDiagnostic } from "./emission-contexts.js";

export function analyzeRustNativeProtocolEmission(input: {
  readonly program: Pick<RustTargetProgram, "callableValues" | "typeDefinitions" | "sourcePackageComponents">;
  readonly sourceFiles: readonly SourceFile[];
  readonly producer: RustNativeProtocolProducer;
}): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const protocols = Object.freeze([...input.program.callableValues.native.protocols]);
  const selections = input.program.callableValues.nativeGenericProducers;
  for (const selected of selections.unresolved) issues.push(emissionDiagnostic(selected.invocation, selected.reason));
  for (const protocol of protocols) {
    const genericProducers: RustNativeGenericProducerBridge[] = [];
    for (const binding of selections.forProtocol(protocol)) {
      const producer = binding.definition.ownerFileName;
      const components = input.program.sourcePackageComponents;
      const ownerFileName = components.canReferenceFile(producer, protocol.ownerFileName) ? producer
        : components.canReferenceFile(protocol.ownerFileName, producer) ? protocol.ownerFileName : undefined;
      const subject = binding.inputs[0]?.owner;
      if (subject === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native generic producer requires its original input owner.");
      if (ownerFileName === undefined) {
        issues.push(emissionDiagnostic(subject, "A native generic producer requires one acyclic source-package implementation owner."));
        continue;
      }
      const future = rustNativeFutureCallableResult(protocol.method.result);
      if (protocol.completion !== undefined && future === undefined || future !== undefined && protocol.completion?.futures.length !== 1) {
        issues.push(emissionDiagnostic(subject, "A native generic producer requires its exact selected single-future completion contract."));
        continue;
      }
      const returnCarrier = mapRustTargetTypes(protocol.result, type => type.kind !== "impl-trait" || type.captures === undefined ? type
        : { ...type, captures: type.captures.filter(argument => argument.kind !== "type" || argument.type.kind !== "type-parameter" ||
          argument.type.identity !== `${protocol.identity}:Self`) });
      genericProducers.push(Object.freeze({ ownerFileName, definition: binding.definition, returnCarrier,
        future: future === undefined ? undefined : Object.freeze({ optional: future.optional }) }));
    }
    input.producer.select(protocol, {
    invoked: input.program.callableValues.nativeDispatch.requiredFor(protocol),
    nativeFutures: Object.freeze((protocol.completion?.futures ?? []).filter(future => rustJsPromiseOutputTargetType(future.carrier) === undefined)),
    producer: analyzeRustNativeProducerBridge(protocol, input.program.typeDefinitions),
    genericProducers: Object.freeze(genericProducers),
    });
  }
  for (const sourceFile of input.sourceFiles) input.producer.sourceFile(sourceFile, protocols);
  return Object.freeze(issues);
}

import type { SourceFile } from "@tsonic/tsts";
import { Node_Expression, sourceEnclosingCallable } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../../program/model.js";
import type { RustNativeProtocolProducer } from "../../program/records/native-protocol-emission.js";
import { rustJsPromiseOutputTargetType } from "../../../target-model/types/carriers/promises.js";
import { analyzeRustNativeProducerBridge } from "../native/native-producer-bridges.js";
import { rustNativeFutureCallableResult } from "../../../target-model/types/carriers/generic-callables.js";
import { mapRustTargetTypes } from "../../../target-model/types/carriers/substitution.js";
import type { RustNativeGenericProducerBridge } from "../../../target-model/records/native-protocol-emission.js";
import { emissionDiagnostic } from "./emission-contexts.js";
import type { RustNativeCallableCall } from "../../../target-model/records/native-protocols.js";
import type { RustSourceCallEffectsFact } from "../../../target-model/records/object-methods.js";
import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import { rustEffectiveValueCarrier } from "../../conversions/value-carrier-queries.js";
import { rustNodeInCatchingTryBody } from "../../errors/catching-try.js";
import { rustProgramErrorTargetType } from "../../../target-model/types/carriers/js.js";
import { rustStructuralObjectCarrierValue } from "../../../target-model/types/carriers/source-types.js";

export function rustNativeInputEffectsMatch(call: RustNativeCallableCall, effects: RustSourceCallEffectsFact): boolean {
  return effects.invocation === "fallible" && effects.awaiting === (call.completion === undefined ? "not-applicable" : "fallible") &&
    closedMetadataEquals(effects.nativeInput, { invocationError: call.invocationError, invocationErrorSource: call.invocationErrorSource,
      awaitErrors: call.awaitErrors, awaitErrorSources: call.awaitErrorSources });
}

export function analyzeRustNativeProtocolEmission(input: {
  readonly program: Pick<RustAnalysisProgram, "source" | "records" | "errorRegions" | "callableValues" | "typeDefinitions" | "sourcePackageComponents" | "structuralShapes">;
  readonly sourceFiles: readonly SourceFile[];
  readonly producer: RustNativeProtocolProducer;
}): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  for (const selected of input.program.callableValues.native.inputs) input.producer.input(selected);
  for (const call of input.program.callableValues.native.calls) {
    const program = input.program;
    const callee = Node_Expression(program.source.ast, call.node);
    const carrier = callee === undefined ? undefined : rustEffectiveValueCarrier(program.records, callee);
    const effects = program.records.sourceCallEffects.get(call.node);
    const owner = sourceEnclosingCallable(call.node, program.source.ast);
    const file = program.source.ast.getSourceFile(call.node);
    const region = owner === undefined ? file === undefined ? undefined : program.errorRegions.initialization.moduleFor(file)?.region : program.errorRegions.get(owner);
    // In a catching try body the invocation error converts into the catch's program error, whatever the owner's region.
    const caught = rustNodeInCatchingTryBody(program.source.ast, call.node);
    if (callee === undefined || carrier === undefined || effects === undefined || !rustNativeInputEffectsMatch(call, effects) ||
      !caught && (region === undefined || region.kind === "infallible")) {
      issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: call.node,
        message: `Native callable invocation requires its exact selected error channel in the active region. Node kind: ${program.source.ast.kindName(call.node)}.`,
        evidence: ["target.capability=rust.backend.native-callable-error-channel"] });
      continue;
    }
    input.producer.call(call.node, { call, callee, reference: carrier.kind === "reference",
      caught: caught ? rustProgramErrorTargetType() : undefined });
  }
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
    const producer = analyzeRustNativeProducerBridge(protocol, input.program.typeDefinitions);
    const headers = [...protocol.method.parameters, protocol.method.result, protocol.result, protocol.trait,
      ...protocol.associatedObligations.flatMap(obligation => [obligation.owner, obligation.trait]),
      ...genericProducers.map(selected => selected.returnCarrier),
      ...producer === undefined ? [] : [producer.concreteResult, producer.implementationResult,
        ...producer.futureBounds.flatMap(bound => [bound.parameter, bound.output, bound.error]),
        ...producer.higherRanked === undefined ? [] : [producer.higherRanked.helperResult,
          producer.higherRanked.publicResult, ...producer.higherRanked.outputs]]];
    for (const carrier of headers) mapRustTargetTypes(carrier, (current, source) => {
      if (rustStructuralObjectCarrierValue(source) !== undefined &&
        input.program.structuralShapes.definitionForCarrier(source) === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted native protocol header requires its exact structural template application.");
      return current;
    });
    input.producer.select(protocol, {
    invoked: input.program.callableValues.nativeDispatch.requiredFor(protocol),
    nativeFutures: Object.freeze((protocol.completion?.futures ?? []).filter(future => rustJsPromiseOutputTargetType(future.carrier) === undefined)),
    producer,
    genericProducers: Object.freeze(genericProducers),
    });
  }
  for (const sourceFile of input.sourceFiles) input.producer.sourceFile(sourceFile, protocols);
  return Object.freeze(issues);
}

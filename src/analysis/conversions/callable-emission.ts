import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustCallableConversionProducer } from "../program/records/callables/callable-conversions.js";
import type { RustCallableOperandEmission, RustCallableConversionEmission, RustNativeCallablePhysicalSource } from "../../target-model/records/callables/callable-conversions.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustCallableConversion } from "../../target-model/conversions/callable.js";
import type { RustCallablePhysicalConversion, RustCallablePhysicalSignature } from "../../target-model/conversions/callable-physical.js";
import { rustProducerErrorReference } from "../../target-model/types/carriers/producer-errors.js";
import { rustProgramErrorOwner } from "../../target-model/types/carriers/program-errors.js";
import { rustRuntimeErrorTargetType } from "../../target-model/types/carriers/runtime-carriers.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustCallableWithError, rustUninhabitedError } from "../../policy/conversions/callable-physical.js";
import { rustCallablePhysicalSignature } from "../../target-model/conversions/callable-physical.js";
import { rustCallableProtocol } from "../../target-model/types/index.js";
import { rustCallableTargetId } from "../../target-model/types/carriers/source-types.js";
import type { RustCallableJoinWrite } from "../../target-model/records/native/native-storage.js";
import { rustCallableConversionPhysical } from "../../policy/conversions/callable-physical.js";
import { rustCallableInputProtocol } from "../../target-model/types/index.js";
import { rustNativeCallableOperand } from "../callables/native/native-conversions.js";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import type { RustCallableValueAdapter } from "../../target-model/records/callables/callable-adapters.js";
import { rustNativeCallablePhysicalSource } from "../../policy/conversions/native-callables.js";
import type { RustOperationAttempt } from "../program/operation-attempts.js";
import { rustCallableClosureErrorBoundary } from "./callable-error-boundary.js";
import { normalizeRustErrorType } from "../errors/error-types.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";

export function analyzeRustCallableEmission(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustCallableConversionProducer,
  attempts: Pick<WeakMap<Node, RustOperationAttempt>, "get">): readonly TargetTypeRef[] {
  const types: TargetTypeRef[] = [];
  const completeSource = (node: Node, physical: RustNativeCallablePhysicalSource): RustNativeCallablePhysicalSource => {
    const error = normalizeRustErrorType(physical.signature.error, { ast: program.source.ast, records: program.records,
      producers: program.callableValues.nativeProducers, definitions: program.typeDefinitions, components: program.sourcePackageComponents }, node);
    if (error === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted callable operand requires its completed physical invocation error.", node);
    if (rustTargetTypeRefEquals(error, physical.signature.error)) return physical;
    return Object.freeze({ ...physical,
      carrier: snapshotClosedMetadata(mapRustTargetTypes(physical.carrier, carrier =>
        rustTargetTypeRefEquals(carrier, physical.signature.error) ? error : carrier)),
      signature: Object.freeze({ ...physical.signature, error }) });
  };
  const operand = (node: Node, source: TargetTypeRef | undefined): RustCallableOperandEmission | undefined => {
    if (source === undefined) return undefined;
    const previous = producer.records.callableOperand.get(node, source);
    if (previous !== undefined) return previous;
    const selected = rustNativeCallableOperand(source, node, { records: program.records,
      storage: program.callableValues.nativeStorage, producers: program.callableValues.nativeProducers, frames: program.callableValues.frames });
    if (selected === undefined) return undefined;
    const physical = completeSource(node, selected);
    const reference = program.records.directCallableReference.get(node);
    const named = reference === undefined ? undefined : program.records.sourceCallableEmission.get(reference.sourceDeclaration, reference.carrier);
    const lambda = program.records.lambdaBody.get(node);
    const captures = program.records.closureCapture.get(node);
    const inline: RustCallableOperandEmission["inline"] = reference !== undefined && named?.construction.kind === "callable" && named.binding === undefined &&
      program.records.moduleCallableStorage.get(reference.sourceDeclaration)?.kind === "inline" ? { kind: "named", value: reference }
      : lambda?.construction === "native" && (lambda.protocol !== undefined || lambda.nativeClosure?.parameters.length === 1) && !lambda.borrowedInput &&
        program.records.frameImplementation.get(node)?.independent !== true &&
        captures?.recursiveDeclaration === undefined && captures?.invocationOwner !== "shared-state" ? { kind: "lambda" } : undefined;
    const value: RustCallableOperandEmission = Object.freeze({ physical, inline: inline === undefined ? undefined : Object.freeze(inline) });
    producer.operand(node, source, value);
    return value;
  };
  const contract = (node: Node, conversion: RustCallableConversion, source: RustNativeCallablePhysicalSource | undefined): void => {
    if (producer.records.callableContract.get(node, conversion) !== undefined) return;
    const file = program.source.ast.getSourceFile(node);
    const fileName = file === undefined ? undefined : program.source.ast.getFileName(file);
    const physical = source === undefined || fileName === undefined ? undefined
      : rustCallableConversionPhysical(conversion, providerCallbackSignature(conversion, source.signature), fileName,
        conversion.target.kind === "closure" ? rustCallableClosureErrorBoundary(node, program.source.ast, attempts) : undefined,
        program.typeDefinitions, source.erased === true);
    if (source === undefined || fileName === undefined || physical === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted callable adapter requires its exact physical source and closed native conversion.", node);
    const compile = (selected: RustCallablePhysicalConversion, actual: RustNativeCallablePhysicalSource): RustCallableConversionEmission => {
      const nested = new Map<RustCallablePhysicalConversion, RustCallableConversionEmission>();
      for (const value of [...selected.arguments, selected.resultPlan]) if (value.kind === "callable")
        nested.set(value.conversion, compile(value.conversion, { carrier: actual.signature.result, signature: value.conversion.source }));
      const value: RustCallableConversionEmission = Object.freeze({ physical: selected, source: actual, fileName,
        target: selected.logical.target.kind === "closure" ? "closure" : rustCallableInputProtocol(selected.logical.target) !== undefined ? "input" : "callable",
        invocation: rustCallableInputProtocol(selected.logical.source) === undefined ? "call" : "invoke", nested });
      types.push(selected.carrier, ...selected.parameters, selected.result, selected.error,
        actual.carrier, ...actual.signature.parameters, actual.signature.result, actual.signature.error,
        ...selected.errors.map(error => error.errorType));
      if (value.target !== "closure") types.push(Object.freeze({ kind: "tuple" as const, elements: selected.parameters }));
      return value;
    };
    producer.contract(node, conversion, compile(physical, source));
  };
  const providerCallbackSignature = (conversion: RustCallableConversion, signature: RustCallablePhysicalSignature): RustCallablePhysicalSignature => {
    if (conversion.target.kind !== "closure") return signature;
    const reference = rustProducerErrorReference(signature.error);
    const resolved = reference === undefined ? signature.error : program.errorRegions.producerError(reference);
    if (resolved === undefined) return signature;
    const owner = rustProgramErrorOwner(resolved);
    const error = owner?.kind === "logical" || owner?.kind === "physical" && owner.domain === "runtime" ? rustRuntimeErrorTargetType() : resolved;
    return rustTargetTypeRefEquals(error, signature.error) ? signature : Object.freeze({ ...signature, error });
  };
  // A producer-selected callable value whose error is uninhabited, wrapped into a union whose payload is the fixed
  // type-erased callable with an inhabited error, is written into that payload through the eliminating adapter.
  const erasedPayloadWrite = (node: Node): RustCallableJoinWrite | undefined => {
    const conversion = program.records.contextualValueConversion.get(node)?.conversion;
    // The payload is placed as is, or through a native representation change (a lifetime) that lowers to identity.
    if (conversion?.kind !== "source-union-variant" ||
      conversion.payloadConversion !== null && conversion.payloadConversion.kind !== "native-representation") return undefined;
    const payload = conversion.payloadCarrier;
    const slotError = payload.kind === "target-named" && payload.id === rustCallableTargetId ? rustCallableProtocol(payload)?.error : undefined;
    if (slotError === undefined || rustUninhabitedError(slotError)) return undefined;
    const binding = program.records.sourceBinding.get(node);
    const local = binding === undefined ? undefined : program.records.localBinding.get(binding.sourceDeclaration);
    const physical = local?.kind === "value" ? local.nativeCarrier : undefined;
    const produced = physical === undefined ? undefined : rustCallablePhysicalSignature(physical)?.error;
    const reference = rustProducerErrorReference(produced);
    const error = reference === undefined ? produced : program.errorRegions.producerError(reference);
    if (physical === undefined || error === undefined || !rustUninhabitedError(error)) return undefined;
    const carrier = rustCallableWithError(physical, slotError);
    if (carrier === undefined) failTargetAnalysisInvariant("tsonic-rust", "An erased union payload write requires the payload's exact callable error.", node);
    return Object.freeze({ source: physical, carrier });
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const read = program.records.valueRead.get(node);
    for (const source of [program.records.runtimeCarrier.get(node)?.carrier, read?.source, read?.contextualInput]) operand(node, source);
    const selected = program.records.contextualValueConversion.get(node);
    if (selected?.conversion.kind === "callable-adapter") contract(node, selected.conversion,
      operand(node, selected.conversion.source)?.physical);
    const joinWrite = program.callableValues.nativeStorage.joinWriteFor(node) ?? erasedPayloadWrite(node);
    if (joinWrite !== undefined) producer.joinWrite(node, joinWrite);
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "source-conversion" && operation.conversion?.kind === "callable-input") operand(node, operation.conversion.source);
  }
  const structuralAdapter = (node: Node, adapter: RustCallableValueAdapter): void => {
    if (adapter.kind === "option-some" || adapter.kind === "option-map") structuralAdapter(node, adapter.element);
    else if (adapter.kind === "conversion" && adapter.conversion.kind === "callable-adapter") {
      const selected = rustNativeCallablePhysicalSource(adapter.sourceCarrier,
        { kind: "selected", carrier: adapter.sourceCarrier, inputs: [], erased: true }, program.callableValues.frames);
      if (selected === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted structural callable adapter requires its exact physical source.", node);
      const physical = completeSource(node, selected);
      if (producer.records.callableOperand.get(node, adapter.conversion.source) === undefined)
        producer.operand(node, adapter.conversion.source, Object.freeze({ physical, inline: undefined }));
      contract(node, adapter.conversion, physical);
    }
  };
  const views = new Set(program.classValues.instanceViewImplementations.flatMap(selected =>
    program.records.structuralViewImplementations.get(selected.declaration, selected.ownerFileName) ?? []));
  for (const view of views) for (const member of view.fields)
    if (member.field !== undefined && member.readAdapter !== undefined &&
      rustCallablePhysicalSignature(member.readAdapter.sourceCarrier) !== undefined)
      structuralAdapter(member.declaration, member.readAdapter);
  for (const occurrence of program.physicalEmissionContexts.sourceOccurrences)
    for (const { slot, input } of occurrence.inputs) {
      const steps = input.conversion.kind === "semantic" ? [input.conversion]
        : input.conversion.kind === "sequence" ? input.conversion.steps : [];
      for (const step of steps) if (step.conversion.kind === "callable-input") operand(slot.node, step.sourceCarrier);
    }
  return Object.freeze(types);
}

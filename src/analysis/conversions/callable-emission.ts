import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustCallableConversionProducer } from "../program/records/callable-conversions.js";
import type { RustCallableOperandEmission, RustCallableConversionEmission, RustNativeCallablePhysicalSource } from "../../target-model/records/callable-conversions.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustCallableConversion } from "../../target-model/conversions/callable.js";
import { type RustCallablePhysicalConversion } from "../../target-model/conversions/callable-physical.js";
import { rustCallableConversionPhysical } from "../../policy/conversions/callable-physical.js";
import { rustCallableInputProtocol } from "../../target-model/types/index.js";
import { rustNativeCallableOperand } from "../callables/native-conversions.js";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";

export function analyzeRustCallableEmission(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustCallableConversionProducer): void {
  const operand = (node: Node, source: TargetTypeRef | undefined): RustCallableOperandEmission | undefined => {
    if (source === undefined) return undefined;
    const previous = producer.records.callableOperand.get(node, source);
    if (previous !== undefined) return previous;
    const physical = rustNativeCallableOperand(source, node, { records: program.records,
      storage: program.callableValues.nativeStorage, producers: program.callableValues.nativeProducers });
    if (physical === undefined) return undefined;
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
  const contract = (node: Node, conversion: RustCallableConversion): void => {
    if (producer.records.callableContract.get(node, conversion) !== undefined) return;
    const source = operand(node, conversion.source)?.physical;
    const file = program.source.ast.getSourceFile(node);
    const fileName = file === undefined ? undefined : program.source.ast.getFileName(file);
    const physical = source === undefined || fileName === undefined ? undefined
      : rustCallableConversionPhysical(conversion, source.signature, fileName, program.typeDefinitions);
    if (source === undefined || fileName === undefined || physical === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted callable adapter requires its exact physical source and closed native conversion.", node);
    const compile = (selected: RustCallablePhysicalConversion, actual: RustNativeCallablePhysicalSource): RustCallableConversionEmission => {
      const nested = new Map<RustCallablePhysicalConversion, RustCallableConversionEmission>();
      for (const value of [...selected.arguments, selected.resultPlan]) if (value.kind === "callable")
        nested.set(value.conversion, compile(value.conversion, { carrier: actual.signature.result, signature: value.conversion.source }));
      return Object.freeze({ physical: selected, source: actual, fileName,
        target: selected.logical.target.kind === "closure" ? "closure" : rustCallableInputProtocol(selected.logical.target) !== undefined ? "input" : "callable",
        invocation: rustCallableInputProtocol(selected.logical.source) === undefined ? "call" : "invoke", nested });
    };
    producer.contract(node, conversion, compile(physical, source));
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const read = program.records.valueRead.get(node);
    for (const source of [program.records.runtimeCarrier.get(node)?.carrier, read?.source, read?.contextualInput]) operand(node, source);
    const selected = program.records.contextualValueConversion.get(node);
    if (selected?.conversion.kind === "callable-adapter") contract(node, selected.conversion);
    const joinWrite = program.callableValues.nativeStorage.joinWriteFor(node);
    if (joinWrite !== undefined) producer.joinWrite(node, joinWrite);
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "source-conversion" && operation.conversion?.kind === "callable-input") operand(node, operation.conversion.source);
  }
  for (const occurrence of program.physicalEmissionContexts.sourceOccurrences)
    for (const { slot, input } of occurrence.inputs) {
      const steps = input.conversion.kind === "semantic" ? [input.conversion]
        : input.conversion.kind === "sequence" ? input.conversion.steps : [];
      for (const step of steps) if (step.conversion.kind === "callable-input") operand(slot.node, step.sourceCarrier);
    }
}

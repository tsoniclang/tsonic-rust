import type { AstReader, Node } from "@tsonic/tsts";
import { asSourceNode, Node_Expression } from "@tsonic/target-api/source";
import type { SourceProgramSemantics } from "@tsonic/target-api/source";
import { rejectedTargetStage, resolvedTargetStage, type TargetDiagnostic, type TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustFinalizedSourceInput } from "../../target-model/records/operations/finalized-operation.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustEmissionProviderOperation, RustPhysicalEmissionSourceOccurrence, RustPhysicalEmissionSourceSlot } from "../../target-model/records/native/physical-emission-contexts.js";
import { isRustAbsenceCarrier, isRustUnitCarrier } from "../../target-model/types/index.js";
import { rustFinalizedSourceInputs } from "../../target-model/operations/finalized-inputs.js";
import { rustRuntimeSetSourceInputs } from "../control-flow/statement-completion.js";

export function providerSourceInputNode(
  input: RustFinalizedSourceInput,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
): Node | undefined {
  return input.source.kind === "receiver" ? receiverNode : argumentNodes[input.source.sourceIndex];
}

export function providerSourceInputKey(input: RustFinalizedSourceInput): string {
  return input.source.kind === "receiver" ? "receiver" : `argument:${input.source.sourceIndex}`;
}

export function selectRustProviderSourceOccurrence(
  node: Node,
  operation: RustEmissionProviderOperation,
  receiver: Node | undefined,
  arguments_: readonly (Node | undefined)[],
): RustPhysicalEmissionSourceOccurrence | undefined {
  const slots: RustPhysicalEmissionSourceSlot[] = [];
  const evaluation = (carrier: RustFinalizedSourceInput["sourceCarrier"]) =>
    isRustAbsenceCarrier(carrier) || isRustUnitCarrier(carrier) ? "unit" as const : "value" as const;
  const sourceReceiver = operation.abi.sourceReceiver;
  if (sourceReceiver.kind === "receiver") {
    if (receiver === undefined) return undefined;
    slots.push(Object.freeze({ key: "receiver", node: receiver, operationNode: node, operation,
      source: Object.freeze({ kind: "receiver", row: sourceReceiver }),
      ...(sourceReceiver.disposition === "evaluation-only" ? { evaluationOnly: evaluation(sourceReceiver.carrier) } : {}) }));
  }
  for (const row of operation.abi.sourceArguments) {
    const argument = arguments_[row.sourceIndex];
    if (argument === undefined) return undefined;
    slots.push(Object.freeze({ key: `argument:${row.sourceIndex}`, node: argument, operationNode: node, operation,
      source: Object.freeze({ kind: "argument", row }),
      ...(row.disposition === "evaluation-only" ? { evaluationOnly: evaluation(row.carrier) } : {}) }));
  }
  const byKey = new Map(slots.map(slot => [slot.key, slot]));
  const inputs: { readonly input: RustFinalizedSourceInput; readonly slot: RustPhysicalEmissionSourceSlot }[] = [];
  for (const input of rustFinalizedSourceInputs(operation.abi)) {
    const slot = byKey.get(providerSourceInputKey(input));
    if (slot === undefined) return undefined;
    inputs.push(Object.freeze({ input, slot }));
  }
  return Object.freeze({ node, operation, receiverProjection: Object.freeze({ kind: "source" as const }),
    slots: Object.freeze(slots), inputs: Object.freeze(inputs),
    targetOrder: Object.freeze(inputs.map(value => value.slot.key)) });
}

export function prepareRustProviderSourceOccurrences(input: {
  readonly ast: AstReader;
  readonly semantics: SourceProgramSemantics;
  readonly nodes: readonly Node[];
  readonly isNativeNode: (node: Node) => boolean;
  readonly records: RustProgramRecords;
}): TargetStageResult<readonly RustPhysicalEmissionSourceOccurrence[]> {
  const occurrences: RustPhysicalEmissionSourceOccurrence[] = [];
  const diagnostics: TargetDiagnostic[] = [];
  for (const node of input.nodes) {
    if (!input.isNativeNode(node) || input.records.compileTimeSource.get(node) === true ||
      input.records.nativeUnreachable.get(node) === true || input.records.nativeParticipation.get(node) === "erased") continue;
    const facts = [input.records.targetOperation.get(node), input.records.compoundWrite.get(node)];
    const operations = [...new Set(facts)].flatMap<{
      readonly operation: RustEmissionProviderOperation;
      readonly receiverProjection: RustPhysicalEmissionSourceOccurrence["receiverProjection"];
    }>(fact => fact?.kind === "provider-operation" || fact?.kind === "runtime-set"
      ? [{ operation: fact, receiverProjection: Object.freeze({ kind: "source" as const }) }]
      : fact?.kind === "union-property" ? fact.variants.flatMap(variant => variant.operation === undefined ? []
        : [{ operation: variant.operation, receiverProjection: Object.freeze({ kind: "union-payload" as const, union: fact, variant }) }]) : []);
    if (operations.length === 0) continue;
    const checked = input.semantics.forNode(node).operations;
    const call = input.ast.is.IsCallExpression(node) || input.ast.is.IsNewExpression(node) ? checked.call(node) : undefined;
    const accessed = input.ast.is.IsDeleteExpression(node) ? Node_Expression(input.ast, node) : node;
    const property = accessed !== undefined && input.ast.is.IsPropertyAccessExpression(accessed) ? checked.propertyAccess(accessed) : undefined;
    const element = accessed !== undefined && input.ast.is.IsElementAccessExpression(accessed) ? checked.elementAccess(accessed) : undefined;
    const originalReceiver = asSourceNode(input.records.selectedOperation.get(node)?.provenance?.sourceReceiver, input.ast);
    for (const { operation, receiverProjection } of operations) {
      const setter = operation.kind === "runtime-set" ? rustRuntimeSetSourceInputs(input.ast, node, operation) : undefined;
      const receiver = operation.kind === "runtime-set" ? setter?.receiver
        : originalReceiver ?? call?.sourceReceiver?.expression ?? call?.sourceCalleeAccess?.receiver.expression ?? property?.receiver.expression ?? element?.receiver.expression;
      const arguments_ = operation.kind === "runtime-set" ? setter?.sourceArguments
        : call !== undefined ? call.sourceArguments.map(argument => argument.expression)
        : element !== undefined ? [element.argument.expression]
        : operation.abi.sourceArguments.length === 0 ? [] : undefined;
      const selected = arguments_ === undefined || operation.kind === "runtime-set" && setter === undefined ? undefined
        : selectRustProviderSourceOccurrence(node, operation, receiver, arguments_);
      if (selected === undefined) diagnostics.push({ code: "RUST_PROVIDER_SOURCE_OCCURRENCE_NOT_PREPARED", category: "error",
        source: "tsonic-rust", sourceNode: node, message: "An admitted native operation requires its exact original receiver and source argument occurrences.",
        evidence: ["rust.provider.source-occurrence"] });
      else occurrences.push(Object.freeze({ ...selected, receiverProjection }));
    }
  }
  return diagnostics.length === 0 ? resolvedTargetStage(Object.freeze(occurrences)) : rejectedTargetStage(diagnostics);
}

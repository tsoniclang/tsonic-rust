import type { Node } from "@tsonic/tsts";
import { forEachSourceImmediateEvaluationChild, Node_Expression, type SourceExpressionEffects } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustProviderEvaluationProducer } from "../program/records/native/provider-evaluation.js";
import type { RustProviderEvaluationEmission } from "../../target-model/records/native/provider-evaluation.js";
import type { RustFinalizedSourceInput } from "../../target-model/records/operations/finalized-operation.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustProviderInputBorrowMode } from "../../policy/operations/members/input-borrows.js";
import { rustContextualRuntimeConversionContract } from "../../policy/conversions/contextual.js";
import { rustValueCarrierBeforeContextualConversion } from "../conversions/value-carrier-queries.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustJsErrorTargetType, rustSliceElementCarrier } from "../../target-model/types/index.js";
import { rustParameterModeForCarriers } from "../../policy/ownership/source-parameter-contracts.js";
import { rustBorrowPureOperation } from "./borrowed-element-purity.js";

export function analyzeRustProviderEvaluation(program: Omit<RustAnalysisProgram, "reachability">,
  producer: RustProviderEvaluationProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const { ast } = program.source;
  const refuse = (node: Node, capability: string, message: string, code = "RUST_MISSING_TARGET_FACT"): void => {
    issues.push(Object.freeze({ code, category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${ast.kindName(node)}.`, evidence: Object.freeze([`target.capability=${capability}`]) }));
  };
  const effectful = (effects: SourceExpressionEffects): boolean => effects.invokes || effects.mutates || effects.suspends || effects.mayThrow;
  for (const source of program.physicalEmissionContexts.sourceOccurrences) {
    const mutable = producer.records.providerMutableOperands.get(source.node, source.operation);
    if (mutable === undefined) failTargetAnalysisInvariant("tsonic-rust", "Provider evaluation requires its admitted mutable operand inventory.", source.node);
    const force = new Set<string>();
    const effects = new Set<string>();
    const counts = new Map<string, number>();
    for (const key of source.targetOrder) counts.set(key, (counts.get(key) ?? 0) + 1);
    const byKey = new Map<string, RustFinalizedSourceInput[]>();
    for (const { input, slot } of source.inputs) {
      const values = byKey.get(slot.key) ?? [];
      values.push(input);
      byKey.set(slot.key, values);
    }
    const slots: RustProviderEvaluationEmission["slots"][number][] = [];
    for (const [index, slot] of source.slots.entries()) {
      const selectedMutable = mutable.find(input => input.key === slot.key);
      const effect = selectedMutable?.storage.kind === "direct" || selectedMutable?.storage.kind === "project-field"
        ? producer.records.providerStorageEffects.get(selectedMutable.node) : program.sourceNavigation.expressionEffects(slot.node);
      if (effect === undefined) failTargetAnalysisInvariant("tsonic-rust", "Provider evaluation requires its exact source storage effects.", slot.node);
      if (effectful(effect)) effects.add(slot.key);
      if ((counts.get(slot.key) ?? 0) > 1 || source.operation.abi.sourceArguments.some(argument => argument.form === "spread-sequence")) force.add(slot.key);
      const inputs = byKey.get(slot.key) ?? [];
      const sequences = inputs.filter(input => input.conversion.kind === "semantic" && input.conversion.conversion.kind === "rest-sequence");
      if (sequences.length > 1) refuse(slot.node, "rust.provider.source-occurrence", "One source occurrence requires one exact native sequence preparation.", "RUST_PROVIDER_SOURCE_OCCURRENCE_NOT_PREPARED");
      const ownership = program.ownership.reads.get(slot.node);
      const guarded = guardedBorrow(slot.node);
      const borrowAcross = new Set<string>();
      const mutableAcross = new Set<string>();
      const hasShared = inputs.some(input => rustProviderInputBorrowMode(input) === "ref" &&
        !existingBorrow(input, slot.node, source.operation.abi.target.form === "index" &&
          source.operation.abi.targetReceiver.kind === "input" && source.operation.abi.targetReceiver.input === input));
      const hasMutable = inputs.some(input => rustProviderInputBorrowMode(input) === "mut-ref");
      for (const later of source.slots.slice(index + 1)) {
        if (hasShared && !guarded && ownership?.borrowedAcross.has(later.node) !== true) borrowAcross.add(later.key);
        if (hasMutable) mutableAcross.add(later.key);
      }
      let ownerCarrier: TargetTypeRef | undefined;
      const contextual = program.records.contextualValueConversion.get(slot.node);
      const contract = contextual === undefined ? undefined : rustContextualRuntimeConversionContract(contextual.conversion, program.typeDefinitions);
      if (contract?.category === "ownership" && contract.sourceMode === "ref" && !contract.fallible && contract.target.kind === "reference" && !contract.target.mutable) {
        const carrier = rustValueCarrierBeforeContextualConversion(program.records, slot.node);
        if (carrier === undefined || !rustTargetTypeRefEquals(carrier, contract.source) || !rustTargetTypeRefEquals(contextual?.sourceCarrier, contract.source) ||
          !rustTargetTypeRefEquals(contextual?.targetCarrier, contract.target))
          refuse(slot.node, "rust.backend.provider-input-owner-carrier", "Borrowed provider input has no exact source owner and contextual target carrier relationship.");
        else ownerCarrier = carrier;
      }
      const snapshot = inputs.length !== 0 && guarded &&
        needsSnapshot(slot.node, [...source.slots.slice(index + 1).map(later => later.node), source.node]);
      const firstInput = inputs[0];
      const sharedInputs = firstInput !== undefined && !snapshot && ownership?.value.kind === "borrow" && !ownership.value.mutable &&
        inputs.every(input => input.mode === "ref" && input.conversion.kind === "identity" &&
          rustTargetTypeRefEquals(input.sourceCarrier, firstInput.sourceCarrier) &&
          input.parameterCarrier.kind === "reference" && !input.parameterCarrier.mutable &&
          rustTargetTypeRefEquals(input.sourceCarrier, input.parameterCarrier.referent) &&
          rustTargetTypeRefEquals(input.sourceCarrier, input.conversion.sourceCarrier) &&
          rustTargetTypeRefEquals(input.sourceCarrier, input.conversion.targetCarrier));
      slots.push(Object.freeze({ slot, inputs: Object.freeze(inputs), sequence: sequences[0], snapshot,
        borrowedEvaluation: slot.evaluationOnly === undefined ? sharedInputs : ownership?.readsStorage === true || ownership?.sharedReference === true,
        borrowAcross, mutableAcross, ownerCarrier }));
    }
    const orderConflicts: (readonly string[])[] = [];
    const ordered = source.slots.filter(slot => effects.has(slot.key)).map(slot => slot.key);
    for (const [index, key] of ordered.entries()) {
      const positions = source.targetOrder.flatMap((candidate, offset) => candidate === key ? [offset] : []);
      if (positions.length !== 1) orderConflicts.push(Object.freeze([key]));
      else for (const later of ordered.slice(index + 1)) {
        const laterIndex = source.targetOrder.indexOf(later);
        if (laterIndex >= 0 && positions[0]! > laterIndex) orderConflicts.push(Object.freeze([key, later]));
      }
    }
    const stabilization = new Set(force);
    if (orderConflicts.length !== 0) for (const key of effects) stabilization.add(key);
    for (const row of slots) {
      if (source.operation.abi.dispatchInputs.length !== 0 && effects.has(row.slot.key) || row.snapshot) stabilization.add(row.slot.key);
      for (const later of row.borrowAcross) if (effects.has(later)) stabilization.add(row.slot.key);
      for (const later of row.mutableAcross) if (effects.has(later)) {
        const input = mutable.find(selected => selected.key === row.slot.key);
        stabilization.add(input?.storage.kind === "owned" ? row.slot.key : later);
      }
    }
    for (const selected of mutable) {
      if (!stabilization.has(selected.key) || selected.storage.kind === "owned" || promoted(selected.node)) continue;
      const later = source.slots.filter(slot => effects.has(slot.key) && slot.key !== selected.key);
      const proof = program.ownership.reads.get(selected.node);
      if (proof?.stablePlace === true && later.every(slot => proof.borrowedAcross.has(slot.node))) continue;
      refuse(selected.node, selected.storage.kind === "project-field" ? "rust.backend.provider-project-field-order" : "rust.backend.provider-direct-mutable-stabilization",
        selected.storage.kind === "project-field" ? "Mutable project-field provider input cannot move across another effectful source input."
          : "Direct mutable provider input cannot move across another effectful source input without changing its exact storage identity.", "RUST_UNSUPPORTED_AST");
    }
    producer.evaluation(source.node, source.operation, { source, slots: Object.freeze(slots), force, orderConflicts: Object.freeze(orderConflicts), effects,
      indexReceiverBorrow: source.operation.abi.targetReceiver.kind === "input" && source.operation.abi.targetReceiver.input.mode === "ref" &&
        source.operation.abi.targetReceiver.input.conversion.kind === "identity" && source.slots.some(slot => slot.source.kind === "receiver" &&
          program.ownership.reads.get(slot.node)?.stablePlace === true),
      dispatch: source.operation.abi.dispatchInputs.length !== 0 });
  }
  return Object.freeze(issues);

  function promoted(node: Node): boolean {
    const seen = new Set<Node>();
    while (!seen.has(node)) {
      seen.add(node);
      const native = program.records.nativeArrayStorage.get(node);
      if (native !== undefined) return native.kind === "element";
      if (ast.is.IsIdentifier(node)) {
        const declaration = program.records.sourceBinding.get(node)?.sourceDeclaration;
        if (declaration === undefined) return false;
        if (program.records.bindingStorage.get(declaration) !== undefined) return true;
        const module = program.records.moduleBinding.get(declaration);
        return module?.storage === "module-cell" || module?.storage === "native-callable" && module.value !== undefined;
      }
      const kind = ast.kindName(node);
      if (kind !== "KindPropertyAccessExpression" && kind !== "KindElementAccessExpression" && kind !== "KindParenthesizedExpression") return false;
      const receiver = Node_Expression(ast, node);
      if (receiver === undefined) return false;
      node = receiver;
    }
    return false;
  }

  function existingBorrow(input: RustFinalizedSourceInput, node: Node, nativeIndex: boolean): boolean {
    if (input.mode === "value" && input.conversion.kind === "identity" && input.sourceCarrier.kind === "reference" && !input.sourceCarrier.mutable &&
      rustTargetTypeRefEquals(program.records.runtimeCarrier.get(node)?.carrier, input.sourceCarrier)) return true;
    if (rustProviderInputBorrowMode(input) === "ref" && program.ownership.reads.get(node)?.stablePlace === true) return true;
    const parameter = program.records.sourceParameterAbi.get(node);
    if (parameter !== undefined && rustProviderInputBorrowMode(input) === "ref" && parameter.entryConversion === undefined &&
      (parameter.mode === "ref" || nativeIndex && parameter.mode === "mut-ref" && rustSliceElementCarrier(parameter.parameterCarrier) !== undefined) &&
      rustTargetTypeRefEquals(parameter.valueCarrier, input.sourceCarrier) &&
      rustParameterModeForCarriers(parameter.valueCarrier, parameter.parameterCarrier) === parameter.mode) return true;
    return parameter?.mode === input.mode && rustTargetTypeRefEquals(parameter.parameterCarrier, input.parameterCarrier);
  }

  function readNode(node: Node): Node {
    while (ast.is.IsParenthesizedExpression(node) || ast.is.IsAsExpression(node) || ast.is.IsTypeAssertion(node) || ast.is.IsSatisfiesExpression(node) || ast.is.IsNonNullExpression(node)) {
      const expression = Node_Expression(ast, node);
      if (expression === undefined) return node;
      node = expression;
    }
    return node;
  }

  function guardedBorrow(node: Node): boolean {
    const operation = program.records.targetOperation.get(readNode(node));
    return operation?.kind === "builtin-error-property" && (operation.property === "stack" || !rustTargetTypeRefEquals(operation.receiverCarrier, rustJsErrorTargetType()));
  }

  function needsSnapshot(node: Node, later: readonly Node[]): boolean {
    const owner = Node_Expression(ast, readNode(node));
    if (owner === undefined) return false;
    return later.some(expression => {
      const pureInvocations = new Set<Node>();
      const pending = [expression];
      while (pending.length !== 0) {
        const selected = pending.pop()!;
        if (rustBorrowPureOperation(selected, program.records) !== undefined) pureInvocations.add(selected);
        forEachSourceImmediateEvaluationChild(ast, selected, child => pending.push(child));
      }
      const invalidation = program.errorStorageDemands.invalidationFor(owner, expression, pureInvocations);
      if (invalidation.kind === "unresolved") refuse(expression, "rust.backend.error-borrow-effect", invalidation.reason);
      return invalidation.kind === "invalidated" || invalidation.kind === "unproven";
    });
  }
}

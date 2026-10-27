import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustProviderInputProducer } from "../program/records/native/provider-inputs.js";
import type { RustFinalizedSourceInput } from "../../target-model/records/operations/finalized-operation.js";
import { rustValueCarrierTransitionTarget } from "../conversions/value-carrier-queries.js";
import { rustCallableTargetForSourceLifetime } from "../../policy/conversions/value-carrier-reconciliation.js";
import { rustFinalizedCarrierTransitionMatches } from "../../policy/operations/members/native-contracts.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isRustStringCarrier } from "../../target-model/types/index.js";
import { isRustCopyCarrier } from "../../policy/constraints/native-traits.js";
import { rustBorrowValueIsUnprojected } from "../storage/borrowed-element-purity.js";
import { isRustFinalizedSliceInput } from "../../target-model/operations/finalized-inputs.js";

export function analyzeRustProviderInputs(program: Omit<RustAnalysisProgram, "reachability">,
  producer: RustProviderInputProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const seen = new WeakMap<Node, Set<object>>();
  for (const occurrence of program.physicalEmissionContexts.sourceOccurrences) {
    const admitted = seen.get(occurrence.node) ?? new Set<object>();
    if (admitted.has(occurrence.operation)) continue;
    admitted.add(occurrence.operation);
    seen.set(occurrence.node, admitted);
    const nodes = new Map(occurrence.inputs.map(({ input, slot }) => [input, slot.node]));
    for (const { input, slot } of occurrence.inputs) {
      if (producer.records.providerReference.get(slot.node, input) === undefined) {
        const parameter = program.records.sourceParameterAbi.get(slot.node);
        const reborrow = program.records.valueRead.get(slot.node)?.referenceReborrow;
        const projection = program.records.valueProjection.get(slot.node);
        const identity = input.conversion.kind === "identity" && projection !== undefined &&
          projection.flow === undefined && projection.upcast === undefined && projection.downcast === undefined &&
          projection.object === undefined && projection.option === undefined &&
          (rustBorrowValueIsUnprojected(slot.node, program.records) || reborrow !== undefined &&
            projection.contextual?.conversion === reborrow && program.records.conversion.get(slot.node) === undefined &&
            program.records.callScopedLifetimeReconciliation.get(slot.node) === undefined);
        producer.reference(slot.node, input, identity && (parameter?.mode === input.mode && rustTargetTypeRefEquals(parameter.parameterCarrier, input.parameterCarrier) ||
          reborrow !== undefined && rustTargetTypeRefEquals(reborrow.target, input.sourceCarrier) &&
            (input.mode === "ref" || input.mode === "mut-ref" && reborrow.source.mutable)));
      }
      const contexts = program.physicalEmissionContexts.operands.filter(operand => operand.origin.kind === "call-input" &&
        operand.origin.operationNode === occurrence.node && operand.origin.input === input);
      const raw = program.records.runtimeCarrier.get(slot.node)?.carrier;
      if (raw === undefined) failTargetAnalysisInvariant("tsonic-rust", "A finalized provider source input requires its independent checked carrier.", slot.node);
      // The guard of an optional chain reaches the chained operation as its present value (the planner binds it as
      // `Some(optional_receiver)`), so its input carrier is the chain's selected guard carrier, not the Option its operand context carries.
      const chain = program.records.optionalChainEmission.get(occurrence.node);
      const present = chain?.fact.guard === slot.node ? chain.structuralGuard?.selectedStorageCarrier ?? chain.fact.selectedGuardCarrier : undefined;
      const carriers = present !== undefined ? [present] : contexts.length !== 0 ? contexts.map(operand => operand.carrier) : [raw];
      // A physical operand context carrier (a closure's physical callable, for example) need not equal the logical
      // input carrier; the input is then checked through the operand's own logical carrier, as the planner reads it. A
      // placeholder callable lifetime takes the value's lifetime.
      const logicalMatches = present === undefined &&
        rustFinalizedCarrierTransitionMatches(raw, rustValueCarrierTransitionTarget(program.records, slot.node, raw),
          rustCallableTargetForSourceLifetime(raw, input.sourceCarrier));
      for (const carrier of carriers) {
        const converted = rustValueCarrierTransitionTarget(program.records, slot.node, carrier);
        if (!rustFinalizedCarrierTransitionMatches(carrier, converted, input.sourceCarrier) && !logicalMatches) issues.push({
        code: converted === undefined ? "RUST_MISSING_TARGET_FACT" : "RUST_UNSUPPORTED_AST", category: "error", source: "tsonic-rust", sourceNode: slot.node,
        message: `${converted === undefined ? "Finalized Rust operation input requires a missing exact source-value transition."
          : "Finalized Rust operation input conflicts with its independent source or selected call-argument carrier fact."} Node kind: ${program.source.ast.kindName(slot.node)}.`,
        evidence: [`target.capability=${converted === undefined ? "rust.backend.provider-operation-flow-read" : "rust.backend.provider-operation-input-carrier"}`],
        });
      }
    }
    for (const input of occurrence.operation.abi.targetArguments) {
      if (!isRustFinalizedSliceInput(input)) continue;
      const literals = new Map<RustFinalizedSourceInput, string>();
      for (const element of input.elements) {
        const node = nodes.get(element);
        if (node === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native slice element requires its exact source occurrence.", occurrence.node);
        const literal = program.records.literalValue.get(node);
        if (element.elementView === "str" && element.conversion.kind === "identity" && rustBorrowValueIsUnprojected(node, program.records) &&
          (literal?.form === "string" || literal?.form === "template")) literals.set(element, literal.text);
      }
      const element = input.elements[0];
      const node = element === undefined ? undefined : nodes.get(element);
      const slot = node === undefined ? -1 : occurrence.slots.findIndex(slot => slot.node === node);
      const later = slot < 0 ? [] : occurrence.slots.slice(slot + 1).map(slot => slot.node);
      const read = node === undefined ? undefined : program.ownership.reads.get(node);
      const declaration = node === undefined ? undefined : program.records.sourceBinding.get(node)?.sourceDeclaration;
      const parameter = node === undefined ? undefined : program.records.sourceParameterAbi.get(node) ?? program.records.sourceParameterAbi.get(declaration);
      let borrowedString = false;
      for (let owner = node === undefined ? undefined : program.source.ast.parent(node); owner !== undefined; owner = program.source.ast.parent(owner)) {
        const capture = program.records.lexicalFunction.get(owner)?.captures.find(capture => capture.declaration === declaration);
        if (capture !== undefined) { borrowedString = capture.borrowedCarrier?.kind === "reference" &&
          !capture.borrowedCarrier.mutable && isRustStringCarrier(capture.borrowedCarrier.referent); break; }
      }
      const singleton = input.elements.length === 1 && element?.mode === "value" && element.conversion.kind === "identity" &&
        rustTargetTypeRefEquals(element.sourceCarrier, input.elementCarrier) &&
        !isRustCopyCarrier(input.elementCarrier, carrier => program.callableValues.generic.definitionFor(carrier)?.copy === true) &&
        read?.readsStorage === true && (read.stablePlace || later.every(later => read.borrowedAcross.has(later))) &&
        !(parameter?.mode === "ref" && isRustStringCarrier(parameter.valueCarrier)) && !borrowedString ? node : undefined;
      producer.slice(occurrence.node, input, { singleton, literals });
    }
  }
  return Object.freeze(issues);
}

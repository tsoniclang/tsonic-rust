import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import type { RustFrameCallableDefinition, RustFrameCallablePlan, RustFrameCallableRecordInput } from "../../../../target-model/records/callables/frame-callables.js";

export function createRustFrameCallableRecords(input: RustFrameCallableRecordInput) {
  let counters: ReadonlyMap<RustFrameCallableDefinition, string | undefined> | undefined;
  const records: RustFrameCallablePlan = Object.freeze({
    definitions: input.definitions,
    issues: input.issues,
    activationInputs: input.activationInputs,
    receiverOwners: input.receiverOwners,
    entryErrors: input.entryErrors,
    errorFor: input.errorFor,
    independentCarrierFor: input.independentCarrierFor,
    definitionFor: (carrier: TargetTypeRef) => input.selectedDefinitions.get(closedMetadataKey(carrier)),
    definitionForOwner: (declaration: Node) => input.byDeclaration.get(declaration),
    entryFor: input.entryFor,
    implementationFor: (declaration: Node) => input.implementations.get(declaration),
    bindingFor: (declaration: Node) => input.bindings.get(declaration),
    isSameActivationInput(expression: Node, definition: RustFrameCallableDefinition, receiver?: Node): boolean {
      const selected = input.activationInputs.get(expression)?.get(definition);
      return selected !== undefined && (selected.independent || selected.receiverOwner === undefined || receiver === undefined ||
        input.receiverOwners.get(receiver) === selected.receiverOwner);
    },
    counterNameFor(definition: RustFrameCallableDefinition): string | undefined {
      if (counters === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "Native frame counter decisions require finalized construction plans before publication.", definition.activation.ownerDeclaration);
      if (!counters.has(definition)) failTargetAnalysisInvariant("tsonic-rust",
        "A native frame counter lookup requires its exact original sealed frame definition.", definition.activation.ownerDeclaration);
      return counters.get(definition);
    },
  });
  return Object.freeze({ records,
    finalizeCounters(prepare: () => ReadonlyMap<RustFrameCallableDefinition, string | undefined>): RustFrameCallablePlan {
      if (counters !== undefined) return records;
      counters = new Map(prepare());
      return records;
    },
  });
}

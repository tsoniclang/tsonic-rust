import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { analyzeRustCaptures } from "./captures.js";
import { buildRustSourceFlowGraph } from "./control-flow.js";
import type { RustOwnershipAnalysisInput } from "./context.js";
import { createRustOwnershipEnvironment } from "./context.js";
import { rustOwnershipDiagnostic } from "./diagnostics.js";
import { collectRustOwnershipNodeInventory } from "./inventory.js";
import { collectRustLexicalRegions } from "./lexical-regions.js";
import { analyzeRustLoans } from "./loans.js";
import type { RustOwnershipAnalysis } from "./model.js";
import { analyzeRustMovesAndDrops } from "./moves.js";
import { collectRustOwnershipOperations } from "./operations.js";
import { analyzeRustPinning } from "./pinning.js";
import { validateRustProviderTypeRequirements } from "./provider-requirements.js";
import { classifyRustOwnershipReads } from "./reads.js";
import { collectRustSourceValueInventory } from "./source-values.js";
import { createRustOwnershipTraitIndex } from "./traits.js";

export type AnalyzeRustOwnershipResult =
  | { readonly kind: "resolved"; readonly analysis: RustOwnershipAnalysis }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] };

export function analyzeRustOwnership(
  input: RustOwnershipAnalysisInput,
): AnalyzeRustOwnershipResult {
  const diagnostics: TargetDiagnostic[] = [];
  const lexicalRegions = collectRustLexicalRegions(input.ast, input.sourceFiles);
  const flowResult = buildRustSourceFlowGraph(input.ast, input.sourceFiles, lexicalRegions);
  if (flowResult.kind === "rejected") {
    return {
      kind: "rejected",
      diagnostics: Object.freeze([rustOwnershipDiagnostic(
        flowResult.code,
        flowResult.message,
      )]),
    };
  }
  const flow = flowResult.graph;
  const inventory = collectRustOwnershipNodeInventory(input, lexicalRegions);
  const sourceValues = collectRustSourceValueInventory(
    inventory.nodes,
    input,
    diagnostics,
  );
  const environment = createRustOwnershipEnvironment(input, inventory, sourceValues);
  const operations = collectRustOwnershipOperations(
    inventory.nodes,
    inventory.places,
    input,
    environment,
    diagnostics,
  );
  const reads = classifyRustOwnershipReads(
    inventory.nodes,
    inventory.places,
    sourceValues.contracts,
    operations,
    input,
    environment,
  );
  const moves = analyzeRustMovesAndDrops(
    flow,
    inventory,
    operations,
    reads,
    input,
    environment,
    diagnostics,
  );
  const loans = analyzeRustLoans(
    flow,
    inventory,
    operations,
    reads,
    input,
    diagnostics,
  );
  const captures = analyzeRustCaptures(
    flow,
    inventory,
    sourceValues,
    operations,
    input,
    environment,
    diagnostics,
  );
  if (diagnostics.length === 0) {
    validateRustProviderTypeRequirements(
      inventory,
      captures,
      input,
      environment,
      diagnostics,
    );
  }
  const pinning = analyzeRustPinning(
    flow,
    inventory,
    operations,
    input,
    environment,
    diagnostics,
  );
  const traits = createRustOwnershipTraitIndex(inventory, operations, input, environment);
  if (diagnostics.length > 0) {
    return { kind: "rejected", diagnostics: Object.freeze(diagnostics) };
  }
  const analysis: RustOwnershipAnalysis = Object.freeze<RustOwnershipAnalysis>({
    flow,
    regions: inventory.regions,
    operations: operations.operations,
    loans: loans.loans,
    drops: moves.drops,
    dropObligations: moves.dropObligations,
    pins: pinning.pins,
    sourceContractFor(node: Node) {
      return sourceValues.contracts.get(node);
    },
    placeFor(node: Node) {
      return inventory.places.get(node);
    },
    operationFor(node: Node) {
      return operations.byNode.get(node);
    },
    readDispositionFor(node: Node) {
      return reads.get(node);
    },
    captureFor(node: Node) {
      return captures.captureByNode.get(node);
    },
    capturesFor(callable: Node) {
      return captures.capturesByCallable.get(callable) ?? Object.freeze([]);
    },
    executionContractFor(callable: Node) {
      return captures.executionContractByCallable.get(callable);
    },
    executionCarrierFor(node: Node) {
      return captures.executionCarrierByNode.get(node);
    },
    executionDomainFor(callable: Node) {
      return captures.executionDomainByCallable.get(callable) ?? "local";
    },
    executionStorageFor(callable: Node) {
      return captures.executionStorageByCallable.get(callable) ?? "borrowed";
    },
    loansAt(node: Node) {
      return loans.loansByNode.get(node) ?? Object.freeze([]);
    },
    dropStateFor(node: Node) {
      return moves.dropByNode.get(node);
    },
    dropObligationsForRegion(region) {
      const id = typeof region === "string" ? region : region.id;
      return moves.dropObligationsByRegion.get(id) ?? Object.freeze([]);
    },
    pinStateFor(node: Node) {
      return pinning.pinByNode.get(node);
    },
    traitProofFor(type, trait) {
      return traits.traitProofFor(type, trait);
    },
    ownedReadForCarrier(type) {
      return traits.ownedReadForCarrier(type);
    },
    bindingRequiresMutable(node: Node) {
      const root = inventory.places.get(node);
      if (root === undefined || root.projections.length !== 0) return false;
      return operations.operations.some((operation) =>
        operation.place.rootId === root.rootId &&
        (operation.kind === "mutable-borrow" ||
          operation.kind === "reborrow" && operation.mutable ||
          operation.kind === "store" ||
          operation.kind === "replace" ||
          operation.kind === "take"));
    },
  });
  return { kind: "resolved", analysis };
}

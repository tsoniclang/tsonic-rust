import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { analyzeRustCaptures } from "./captures.js";
import {
  buildRustSourceFlowGraph,
  RustSourceFlowQueryLimitError,
} from "./control-flow.js";
import type { RustOwnershipAnalysisInput } from "./context.js";
import { createRustOwnershipEnvironment } from "./context.js";
import {
  rustOwnershipInventoryCountComplexityDiagnostic,
  rustFlowQueryComplexityDiagnostic,
  RustOwnershipComplexityError,
} from "./complexity.js";
import { rustOwnershipDiagnostic } from "./diagnostics.js";
import { collectRustOwnershipNodeInventory } from "./inventory.js";
import {
  collectRustLexicalRegions,
  RustLexicalRegionLimitError,
} from "./lexical-regions.js";
import { analyzeRustLoans } from "./loans.js";
import type { RustOwnershipAnalysis } from "./model.js";
import { analyzeRustMovesAndDrops } from "./moves.js";
import { collectRustOwnershipOperations } from "./operations.js";
import { analyzeRustPinning } from "./pinning.js";
import { validateRustProviderTypeRequirements } from "./provider-requirements.js";
import { classifyRustOwnershipReads } from "./reads.js";
import { collectRustSourceValueInventory } from "./source-values.js";
import { createRustOwnershipTraitIndex } from "./traits.js";
import { RustOwnershipSourceIdentityError } from "./identity.js";
import { RustOwnershipSourceShapeError } from "./source-shape.js";
import {
  rustOwnershipNodeMayThrow,
  rustOwnershipNodeSuspensionKind,
  rustOwnershipResourceCleanupEffect,
} from "./execution-effects.js";
import { analyzeRustFixedMutableLoanGroups } from "./fixed-index-loans.js";
import {
  rustLocationStorageFactKey,
  rustMutatedBindingFactKey,
  rustMutatedReferentFactKey,
  rustResourceManagementFactKey,
} from "../facts/keys.js";
import { rustCarrierReferentMutationRequiresMutableBinding } from "../../target-model/types/index.js";
import { rustResourceDisposalReceiverMode } from "../resources/management.js";

export type AnalyzeRustOwnershipResult =
  | { readonly kind: "resolved"; readonly analysis: RustOwnershipAnalysis }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] };

export function analyzeRustOwnership(
  input: RustOwnershipAnalysisInput,
): AnalyzeRustOwnershipResult {
  try {
    return analyzeRustOwnershipWithinLimits(input);
  } catch (error) {
    let diagnostic: TargetDiagnostic | undefined;
    if (error instanceof RustOwnershipComplexityError) {
      diagnostic = error.diagnostic;
    } else if (error instanceof RustOwnershipSourceIdentityError) {
      diagnostic = rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_SOURCE_IDENTITY_MISSING",
        error.message,
        error.node,
      );
    } else if (error instanceof RustOwnershipSourceShapeError) {
      diagnostic = rustOwnershipDiagnostic(
        "RUST_SOURCE_AST_INCOMPLETE",
        error.message,
        error.node,
      );
    } else if (error instanceof RustSourceFlowQueryLimitError) {
      diagnostic = rustFlowQueryComplexityDiagnostic(error.stepCount);
    } else if (error instanceof RustLexicalRegionLimitError) {
      diagnostic = rustOwnershipInventoryCountComplexityDiagnostic(0, 0, error.regionCount);
    }
    if (diagnostic === undefined) throw error;
    return { kind: "rejected", diagnostics: Object.freeze([diagnostic]) };
  }
}

function analyzeRustOwnershipWithinLimits(
  input: RustOwnershipAnalysisInput,
): AnalyzeRustOwnershipResult {
  const sourceUnitComplexity = rustOwnershipInventoryCountComplexityDiagnostic(
    input.sourceFiles.length,
    0,
    0,
  );
  if (sourceUnitComplexity !== undefined) {
    return { kind: "rejected", diagnostics: Object.freeze([sourceUnitComplexity]) };
  }
  const diagnostics: TargetDiagnostic[] = [];
  const lexicalRegions = collectRustLexicalRegions(input.ast, input.sourceFiles);
  const executionEffectInput = Object.freeze({
    ast: input.ast,
    facts: input.facts,
    structuralStorage: input.structuralShapes,
    projectFieldDispatch: input.projectFieldDispatch,
  });
  const flowResult = buildRustSourceFlowGraph(
    input.ast,
    input.sourceFiles,
    lexicalRegions,
    {
      nodeMayThrow: (node) => rustOwnershipNodeMayThrow(node, executionEffectInput),
      nodeSuspensionKind: (node) => rustOwnershipNodeSuspensionKind(node, executionEffectInput),
      resourceCleanupFor: (declaration) =>
        rustOwnershipResourceCleanupEffect(declaration, executionEffectInput),
    },
  );
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
    flow,
    inventory.nodes,
    inventory.places,
    sourceValues,
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
  const moveResult = analyzeRustMovesAndDrops(
    flow,
    inventory,
    operations,
    reads,
    input,
    environment,
    diagnostics,
  );
  if (moveResult.kind === "rejected") {
    return {
      kind: "rejected",
      diagnostics: Object.freeze([...diagnostics, moveResult.diagnostic]),
    };
  }
  const moves = moveResult.analysis;
  const loanResult = analyzeRustLoans(
    flow,
    inventory,
    operations,
    reads,
    input,
    diagnostics,
  );
  if (loanResult.kind === "rejected") {
    return {
      kind: "rejected",
      diagnostics: Object.freeze([...diagnostics, loanResult.diagnostic]),
    };
  }
  const loans = loanResult.analysis;
  const fixedMutableLoanGroups = analyzeRustFixedMutableLoanGroups(
    inventory,
    operations,
    input,
  );
  const captures = analyzeRustCaptures(
    flow,
    inventory,
    sourceValues,
    operations,
    moves,
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
  const mutableBindingRoots = new Set<string>();
  for (const operation of operations.operations) {
    if (operation.kind === "mutable-borrow" ||
      operation.kind === "reborrow" && operation.mutable ||
      operation.kind === "store" || operation.kind === "replace" ||
      operation.kind === "take") {
      mutableBindingRoots.add(operation.place.rootId);
    }
  }
  const mutableBindings = new WeakSet<Node>();
  for (const declaration of inventory.declarationByRoot.values()) {
    if (input.facts.getFact(declaration, rustLocationStorageFactKey) !== undefined) {
      continue;
    }
    const carrier = input.facts.getRuntimeCarrierFact(declaration)?.carrier;
    if (carrier === undefined) continue;
    const place = inventory.places.get(declaration);
    const summary = input.navigation.declarationUseSummary(declaration);
    const representation = input.objectRepresentations.representationFor(
      input.projectTypes.definitionForCarrier(carrier),
    );
    const ownedBinding = carrier.kind !== "raw-pointer" && carrier.kind !== "reference";
    const resource = input.facts.getFact(declaration, rustResourceManagementFactKey);
    if (summary.bindingWritten ||
      input.facts.getFact(declaration, rustMutatedBindingFactKey) !== undefined ||
      place !== undefined && place.projections.length === 0 &&
        mutableBindingRoots.has(place.rootId) ||
      representation?.kind === "value" && summary.memberWritten ||
      ownedBinding && rustCarrierReferentMutationRequiresMutableBinding(carrier) &&
        (representation === undefined || representation.kind === "value") &&
        input.facts.getFact(declaration, rustMutatedReferentFactKey) !== undefined ||
      resource !== undefined && rustResourceDisposalReceiverMode(resource) === "mut-ref") {
      mutableBindings.add(declaration);
    }
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
    captureFor(callable: Node, node: Node) {
      return captures.captureFor(callable, node);
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
    dropStatesFor(node: Node) {
      return moves.dropsByNode.get(node) ?? Object.freeze([]);
    },
    dropObligationsForRegion(region) {
      const id = typeof region === "string" ? region : region.id;
      return moves.dropObligationsByRegion.get(id) ?? Object.freeze([]);
    },
    pinStatesFor(node: Node) {
      return pinning.pinsByNode.get(node) ?? Object.freeze([]);
    },
    traitProofFor(type, trait) {
      return traits.traitProofFor(type, trait);
    },
    ownedReadForCarrier(type) {
      return traits.ownedReadForCarrier(type);
    },
    bindingRequiresMutable(node: Node) {
      return mutableBindings.has(node);
    },
    fixedMutableLoanGroupFor(statement: Node) {
      return fixedMutableLoanGroups.get(statement);
    },
  });
  return { kind: "resolved", analysis };
}

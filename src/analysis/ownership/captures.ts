import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  rustGeneratorFactKey,
  rustClosureCaptureFactKey,
  rustTargetOperationFactKey,
} from "../facts/keys.js";
import { rustSourceOwnershipOperationFactKey } from "../../source/semantics/facts.js";
import {
  isRustFinalizedArrayInput,
  isRustFinalizedSliceInput,
  isRustFinalizedSourceInput,
  isRustFinalizedTaggedArrayInput,
} from "../facts/finalized-operation/conversions.js";
import type {
  RustCapture,
  RustBound,
  RustExecutionContract,
  RustExecutionDomain,
  RustExecutionStorage,
  RustLifetimeRef,
  RustTraitRef,
  RustTypeRef,
} from "../../target-model/semantics/index.js";
import type { RustResolvedProviderTypeParameterRequirement } from "../../target-model/operations/model.js";
import {
  getRustGeneratorProtocol,
  isRustCallableCarrier,
  rustCallableProtocol,
  rustCloneTrait,
  rustCopyTrait,
  rustFnMutTrait,
  rustFnOnceTrait,
  rustFnTrait,
  rustFutureOutputCarrier,
  rustLocationTargetType,
  rustReferenceTargetType,
  rustSendTrait,
  rustSyncTrait,
  rustUnpinTrait,
} from "../../target-model/types/index.js";
import {
  rustLifetimeSemanticKey,
  rustSemanticIdentitiesEqual,
} from "../../target-model/semantics/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustResolvedProviderRequirementKey } from "../../policy/types/provider-generic-requirements.js";
import type { RustClosureCaptureFact } from "../facts/keys.js";
import type { RustSourceFlowGraph } from "./control-flow.js";
import type {
  RustOwnershipAnalysisInput,
  RustOwnershipEnvironment,
} from "./context.js";
import { rustOwnershipDiagnostic } from "./diagnostics.js";
import type { RustOwnershipNodeInventory } from "./inventory.js";
import type { RustOwnershipOperationInventory } from "./operations.js";
import type { RustMoveAndDropAnalysis } from "./moves.js";
import { rustOwnershipTraitProof } from "./operations.js";
import {
  rustPlacesOverlap,
} from "./places.js";
import type { RustSourceValueInventory } from "./source-values.js";

import {
  captureCrossesSuspension,
  collectSuspensionPoints,
  enclosingCallInput,
  executionRequirementsForBound,
  executionRequirementsForCarrier,
  exactCallableExpression,
  isCallable,
} from "./capture-execution.js";
import type { RustExecutionRequirement } from "./capture-execution.js";
import {
  createRustCallableEvidenceIndex,
  createRustCaptureWorkBudget,
  type RustCallableEvidenceIndex,
  type RustCaptureWorkBudget,
} from "./capture-evidence.js";
import {
  collectSuspendedValues,
  indexFlowPointsById,
  indexMovedPlacesByCallable,
  indexMutablyUsedPlacesByCallable,
} from "./capture-retention.js";
import { requireRustOwnershipSourceIdentity } from "./identity.js";

interface RustExecutionRequirements extends RustExecutionRequirement {
  readonly lifetime: RustLifetimeRef;
}

interface RustExpectedCallableBound {
  readonly operation: Node;
  readonly requirement: RustResolvedProviderTypeParameterRequirement;
  readonly bound: RustBound;
}

export interface RustCaptureAnalysis {
  readonly capturesByCallable: WeakMap<Node, readonly RustCapture[]>;
  captureFor(callable: Node, node: Node): RustCapture | undefined;
  readonly executionCarrierByNode: WeakMap<Node, RustTypeRef>;
  readonly executionDomainByCallable: WeakMap<Node, RustExecutionDomain>;
  readonly executionStorageByCallable: WeakMap<Node, RustExecutionStorage>;
  readonly executionContractByCallable: WeakMap<Node, RustExecutionContract>;
  callableForSourceIdentity(identity: string): Node | undefined;
  providerRequirementIsProven(operation: Node, requirementKey: string): boolean;
}

export function analyzeRustCaptures(
  flow: RustSourceFlowGraph,
  inventory: RustOwnershipNodeInventory,
  sourceValues: RustSourceValueInventory,
  operations: RustOwnershipOperationInventory,
  moves: RustMoveAndDropAnalysis,
  input: RustOwnershipAnalysisInput,
  environment: RustOwnershipEnvironment,
  diagnostics: TargetDiagnostic[],
): RustCaptureAnalysis {
  const capturesByCallable = new WeakMap<Node, readonly RustCapture[]>();
  const capturesByCallableAndNode = new WeakMap<Node, WeakMap<Node, RustCapture>>();
  const executionCarrierByNode = new WeakMap<Node, RustTypeRef>();
  const executionDomainByCallable = new WeakMap<Node, RustExecutionDomain>();
  const executionStorageByCallable = new WeakMap<Node, RustExecutionStorage>();
  const executionContractByCallable = new WeakMap<Node, RustExecutionContract>();
  const callableBySourceIdentity = new Map<string, Node>();
  const providerRequirementProofs = new WeakMap<Node, Set<string>>();
  const captureMoveValues = new WeakSet<Node>();
  const budget = createRustCaptureWorkBudget();
  const evidence = createRustCallableEvidenceIndex(input, budget);
  const flowPointById = indexFlowPointsById(flow);
  const movedPlacesByCallable = indexMovedPlacesByCallable(operations, inventory);
  const mutablyUsedPlacesByCallable = indexMutablyUsedPlacesByCallable(operations, inventory);
  for (const node of inventory.nodes) {
    const operation = input.facts.get(node, rustSourceOwnershipOperationFactKey);
    if (operation?.kind !== "capture-move") continue;
    const callable = exactCallableExpression(operation.valueExpression, input.ast);
    if (callable !== undefined) captureMoveValues.add(callable);
  }
  const callables = inventory.nodes.filter((node) => isCallable(node, input.ast)).reverse();
  for (const callable of callables) {
    const callableIdentity = requireRustOwnershipSourceIdentity(input.ast, callable);
    const existingCallable = callableBySourceIdentity.get(callableIdentity);
    if (existingCallable !== undefined && existingCallable !== callable) {
      diagnostics.push(rustOwnershipDiagnostic(
        "RUST_CALLABLE_SOURCE_IDENTITY_CONFLICT",
        "Distinct Rust callables share one compiler-owned source identity.",
        callable,
      ));
      continue;
    }
    callableBySourceIdentity.set(callableIdentity, callable);
    const fact = input.facts.getFact(callable, rustClosureCaptureFactKey) ??
      Object.freeze({ captures: Object.freeze([]) });
    const expectedBounds = expectedCallableBounds(callable, input, evidence, budget);
    const diagnosticCount = diagnostics.length;
    const execution = executionRequirementsForCallable(
      callable,
      inventory,
      input,
      diagnostics,
      expectedBounds,
      evidence,
    );
    if (execution === undefined) continue;
    const suspensionPoints = collectSuspensionPoints(callable, flow);
    const suspendedValues = collectSuspendedValues(
      callable,
      suspensionPoints,
      flow,
      flowPointById,
      inventory,
      moves,
      input,
      evidence,
      budget,
    );
    const forceMove = captureMoveValues.has(callable);
    const captures: RustCapture[] = [];
    const capturesByNode = new WeakMap<Node, RustCapture>();
    let movesFromCapture = false;
    let mutatesCapture = false;
    for (const capture of fact.captures) {
      budget.chargeCapture(capture.reference);
      const place = inventory.places.get(capture.reference) ??
        inventory.places.get(capture.declaration);
      if (place === undefined) {
        diagnostics.push(rustOwnershipDiagnostic(
          "RUST_CAPTURE_PLACE_NOT_PROVEN",
          "A closure capture has no exact source place.",
          capture.reference,
        ));
        continue;
      }
      const sourceContract = sourceValues.contracts.get(capture.declaration);
      const references = evidence.referencesWithin(callable, capture.declaration);
      const nestedCaptures: RustCapture[] = [];
      let nestedCaptureMissing = false;
      for (const reference of references) {
        const owner = inventory.callableOwnerByNode.get(reference);
        if (owner === undefined || owner === callable) continue;
        const selected = capturesByCallableAndNode.get(owner)?.get(reference);
        if (selected === undefined) {
          diagnostics.push(rustOwnershipDiagnostic(
            "RUST_NESTED_CAPTURE_NOT_PROVEN",
            "A nested callable capture has no exact sealed ownership classification.",
            reference,
          ));
          nestedCaptureMissing = true;
          continue;
        }
        if (!nestedCaptures.includes(selected)) nestedCaptures.push(selected);
      }
      if (nestedCaptureMissing) continue;
      const movedByBody = movedPlacesByCallable.get(callable)?.get(place.rootId)?.some(
        (movedPlace) => rustPlacesOverlap(movedPlace, place),
      ) === true || nestedCaptures.some((nested) => nested.bodyEffect === "move");
      const mutatedByBody = moves.placeIsWrittenWithin(callable, place) ||
        mutablyUsedPlacesByCallable.get(callable)?.get(place.rootId)?.some(
          (mutatedPlace) => rustPlacesOverlap(mutatedPlace, place),
        ) === true || nestedCaptures.some((nested) => nested.bodyEffect === "mutate");
      const bodyEffect = captureBodyEffect(movedByBody, mutatedByBody, capture.storage);
      const storageCarrier = capture.storage === "location"
        ? rustLocationTargetType(capture.carrier)
        : capture.carrier;
      const mode = captureMode(
        forceMove,
        movedByBody,
        mutatedByBody,
        capture.storage,
        storageCarrier,
        sourceContract,
        execution,
        environment,
      );
      if (mode === undefined) {
        const requiresExplicitMove = sourceContract?.kind === "owned" ||
          sourceContract?.kind === "mutable-reference";
        diagnostics.push(rustOwnershipDiagnostic(
          requiresExplicitMove
            ? "RUST_NATIVE_CAPTURE_REQUIRES_EXPLICIT_MOVE"
            : "RUST_CAPTURE_CLONE_NOT_PROVEN",
          requiresExplicitMove
            ? "A native capture requiring ownership transfer must use captureMove(...)."
            : "A source-preserving closure capture requires exact Copy or Clone evidence.",
          capture.reference,
        ));
        continue;
      }
      movesFromCapture ||= bodyEffect === "move";
      mutatesCapture ||= bodyEffect === "mutate";
      if (!captureLifetimeIsValid(
        sourceContract,
        storageCarrier,
        mode,
        execution,
        environment,
      )) {
        diagnostics.push(rustOwnershipDiagnostic(
          "RUST_CAPTURE_LIFETIME_DOES_NOT_OUTLIVE_EXECUTION",
          "A borrowed closure capture does not outlive the exact selected execution contract.",
          capture.reference,
        ));
        continue;
      }
      const evidenceId = requireRustOwnershipSourceIdentity(input.ast, capture.reference);
      const representationCarrier = captureRepresentationCarrier(
        storageCarrier,
        mode,
        execution.lifetime,
      );
      const proof = mode === "copy"
        ? rustOwnershipTraitProof(rustCopyTrait, storageCarrier, evidenceId)
        : mode === "clone"
          ? rustOwnershipTraitProof(rustCloneTrait, storageCarrier, evidenceId)
          : undefined;
      if (execution.requiresSend && !environment.supportsTrait(representationCarrier, rustSendTrait)) {
        diagnostics.push(rustOwnershipDiagnostic(
          "RUST_CAPTURE_SEND_NOT_PROVEN",
          `A threaded callable capture requires exact ${mode === "shared" ? "Sync" : "Send"} evidence.`,
          capture.reference,
        ));
        continue;
      }
      if (execution.requiresSync && !environment.supportsTrait(representationCarrier, rustSyncTrait)) {
        diagnostics.push(rustOwnershipDiagnostic(
          "RUST_CAPTURE_SYNC_NOT_PROVEN",
          "A shared threaded callable capture requires exact Sync evidence.",
          capture.reference,
        ));
        continue;
      }
      const selected = Object.freeze({
        place,
        carrier: capture.carrier,
        storageCarrier,
        representationCarrier,
        mode,
        bodyEffect,
        crossesSuspension: captureCrossesSuspension(
          evidence.referencesWithin(callable, capture.declaration),
          suspensionPoints,
          flowPointById,
          flow,
        ),
        executionDomain: execution.kind,
        requiresStatic: execution.storage === "owned",
        ...(proof === undefined ? {} : { proof }),
        ...(execution.requiresSend
          ? {
              sendProof: rustOwnershipTraitProof(
                rustSendTrait,
                representationCarrier,
                evidenceId,
              ),
            }
          : {}),
        ...(execution.requiresSync
          ? {
              syncProof: rustOwnershipTraitProof(
                rustSyncTrait,
                representationCarrier,
                evidenceId,
              ),
            }
          : {}),
      });
      captures.push(selected);
      for (const reference of references) capturesByNode.set(reference, selected);
    }
    const actualCallTrait = movesFromCapture
      ? "fn-once" as const
      : mutatesCapture
        ? "fn-mut" as const
        : "fn" as const;
    if (!callableCallTraitRequirementsAreSatisfied(
      callable,
      actualCallTrait,
      expectedBounds,
      input,
      evidence,
    )) {
      diagnostics.push(rustOwnershipDiagnostic(
        "RUST_CLOSURE_CALL_TRAIT_NOT_SATISFIED",
        `The closure body requires ${actualCallTrait === "fn-once" ? "FnOnce" : actualCallTrait === "fn-mut" ? "FnMut" : "Fn"}, which conflicts with an exact selected callable boundary.`,
        callable,
      ));
    }
    const executionCarrier = finalizedCallableExecutionCarrier(
      callable,
      input,
      diagnostics,
      evidence,
    );
    if (executionCarrier !== undefined) {
      for (const candidate of evidence.valueCandidatesFor(callable)) {
        const existing = executionCarrierByNode.get(candidate);
        if (existing !== undefined && !rustTargetTypeRefEquals(existing, executionCarrier)) {
          diagnostics.push(rustOwnershipDiagnostic(
            "RUST_CALLABLE_EXECUTION_CARRIER_CONFLICT",
            "One callable value reaches incompatible exact execution-carrier boundaries.",
            candidate,
          ));
          continue;
        }
        executionCarrierByNode.set(candidate, executionCarrier);
      }
    }
    const frozenCaptures = Object.freeze(captures);
    capturesByCallable.set(callable, frozenCaptures);
    capturesByCallableAndNode.set(callable, capturesByNode);
    executionDomainByCallable.set(callable, execution.kind);
    executionStorageByCallable.set(callable, execution.storage);
    executionContractByCallable.set(callable, Object.freeze({
      kind: execution.kind,
      storage: execution.storage,
      captureStyle: forceMove ? "move" : "lexical",
      lifetime: execution.lifetime,
      requiresSend: execution.requiresSend,
      requiresSync: execution.requiresSync,
      captures: frozenCaptures,
      suspendedValues,
      suspensionPoints,
    }));
    if (diagnostics.length === diagnosticCount) {
      for (const expected of expectedBounds) {
        if (!callableCaptureRequirementIsProven(
          expected,
          fact.captures,
          frozenCaptures,
          sourceValues,
          environment,
        )) {
          continue;
        }
        let proofs = providerRequirementProofs.get(expected.operation);
        if (proofs === undefined) {
          proofs = new Set<string>();
          providerRequirementProofs.set(expected.operation, proofs);
        }
        proofs.add(rustResolvedProviderRequirementKey(expected.requirement, expected.bound));
      }
    }
  }
  return Object.freeze<RustCaptureAnalysis>({
    capturesByCallable,
    captureFor(callable, node) {
      return capturesByCallableAndNode.get(callable)?.get(node);
    },
    executionCarrierByNode,
    executionDomainByCallable,
    executionStorageByCallable,
    executionContractByCallable,
    callableForSourceIdentity(identity) {
      return callableBySourceIdentity.get(identity);
    },
    providerRequirementIsProven(operation, requirementKey) {
      return providerRequirementProofs.get(operation)?.has(requirementKey) === true;
    },
  });
}

function finalizedCallableExecutionCarrier(
  callable: Node,
  input: RustOwnershipAnalysisInput,
  diagnostics: TargetDiagnostic[],
  evidence: RustCallableEvidenceIndex,
): RustTypeRef | undefined {
  const carriers = expectedCallableCarriers(callable, input, evidence).filter((carrier) =>
    isRustCallableCarrier(carrier) || getRustGeneratorProtocol(carrier) !== undefined);
  const selected = carriers[0];
  if (selected === undefined) return undefined;
  if (carriers.some((carrier) => !rustTargetTypeRefEquals(carrier, selected))) {
    diagnostics.push(rustOwnershipDiagnostic(
      "RUST_CALLABLE_EXECUTION_CARRIER_CONFLICT",
      "One callable value reaches incompatible exact execution-carrier boundaries.",
      callable,
    ));
    return undefined;
  }
  return selected;
}

function callableCallTraitRequirementsAreSatisfied(
  callable: Node,
  actual: "fn" | "fn-mut" | "fn-once",
  expectedBounds: readonly RustExpectedCallableBound[],
  input: RustOwnershipAnalysisInput,
  evidence: RustCallableEvidenceIndex,
): boolean {
  const required: ("fn" | "fn-mut" | "fn-once")[] = [];
  for (const carrier of expectedCallableCarriers(callable, input, evidence)) {
    if (carrier.kind === "closure") required.push(carrier.callTrait);
    else if (carrier.kind === "function-pointer" || rustCallableProtocol(carrier) !== undefined) {
      required.push("fn");
    }
  }
  for (const entry of expectedBounds) {
    if (entry.bound.kind !== "trait" || entry.bound.polarity !== "required") continue;
    const identity = entry.bound.trait.identity;
    if (rustSemanticIdentitiesEqual(identity, rustFnTrait.identity)) required.push("fn");
    else if (rustSemanticIdentitiesEqual(identity, rustFnMutTrait.identity)) required.push("fn-mut");
    else if (rustSemanticIdentitiesEqual(identity, rustFnOnceTrait.identity)) required.push("fn-once");
  }
  return required.every((boundary) => boundary === "fn-once" ||
    boundary === "fn-mut" && actual !== "fn-once" ||
    boundary === "fn" && actual === "fn");
}

function captureMode(
  forceMove: boolean,
  movedByBody: boolean,
  mutatedByBody: boolean,
  storage: "value" | "location",
  storageCarrier: RustTypeRef,
  sourceContract: import("../../target-model/semantics/index.js").RustSourceValueContract | undefined,
  execution: RustExecutionRequirements,
  environment: RustOwnershipEnvironment,
): RustCapture["mode"] | undefined {
  if (storage === "location") {
    return forceMove || execution.storage === "owned"
      ? environment.supportsTrait(storageCarrier, rustCloneTrait) ? "clone" : undefined
      : "shared";
  }
  if (sourceContract?.kind === "owned") {
    if (forceMove) return "move";
    if (movedByBody || execution.storage === "owned") return undefined;
    return mutatedByBody ? "mutable" : "shared";
  }
  if (sourceContract?.kind === "shared-reference") return "copy";
  if (sourceContract?.kind === "mutable-reference") {
    if (forceMove) return "move";
    if (movedByBody || execution.storage === "owned") return undefined;
    return mutatedByBody ? "mutable" : "shared";
  }
  if (!forceMove && execution.storage === "borrowed" && !movedByBody) {
    return mutatedByBody ? "mutable" : "shared";
  }
  if (environment.supportsTrait(storageCarrier, rustCopyTrait)) return "copy";
  return environment.supportsTrait(storageCarrier, rustCloneTrait) ? "clone" : undefined;
}

function captureBodyEffect(
  movedByBody: boolean,
  mutatedByBody: boolean,
  storage: "value" | "location",
): RustCapture["bodyEffect"] {
  if (movedByBody) return "move";
  return mutatedByBody && storage === "value" ? "mutate" : "read";
}

function captureRepresentationCarrier(
  storageCarrier: RustTypeRef,
  mode: RustCapture["mode"],
  lifetime: RustLifetimeRef,
): RustTypeRef {
  if (mode !== "shared" && mode !== "mutable") return storageCarrier;
  if (storageCarrier.kind === "reference") {
    return rustReferenceTargetType(
      storageCarrier.target,
      mode === "mutable",
      lifetime,
    );
  }
  return rustReferenceTargetType(storageCarrier, mode === "mutable", lifetime);
}

function captureLifetimeIsValid(
  contract: import("../../target-model/semantics/index.js").RustSourceValueContract | undefined,
  carrier: RustTypeRef,
  mode: RustCapture["mode"],
  execution: RustExecutionRequirements,
  environment: RustOwnershipEnvironment,
): boolean {
  const lifetime = contract?.kind === "shared-reference" ||
      contract?.kind === "mutable-reference"
    ? contract.lifetime
    : carrier.kind === "reference" || carrier.kind === "trait-object"
      ? carrier.lifetime
      : undefined;
  if (lifetime !== undefined &&
    !environment.lifetimeOutlives(lifetime, execution.lifetime)) {
    return false;
  }
  if (mode === "shared" || mode === "mutable") {
    return true;
  }
  return environment.typeOutlives(carrier, execution.lifetime);
}

function executionRequirementsForCallable(
  callable: Node,
  inventory: RustOwnershipNodeInventory,
  input: RustOwnershipAnalysisInput,
  diagnostics: TargetDiagnostic[],
  expectedBounds: readonly RustExpectedCallableBound[],
  evidence: RustCallableEvidenceIndex,
): RustExecutionRequirements | undefined {
  const requirements = [
    ...expectedCallableCarriers(callable, input, evidence).map(executionRequirementsForCarrier),
    ...expectedBounds.flatMap((entry) => executionRequirementsForBound(entry.bound)),
  ];
  const requiresSend = requirements.some((entry) => entry.requiresSend);
  const requiresSync = requirements.some((entry) => entry.requiresSync);
  const requiresStatic = requirements.some((entry) => entry.requiresStatic);
  const occurrence = requireRustOwnershipSourceIdentity(input.ast, callable);
  const lexicalRegionId = inventory.regionByNode.get(callable)?.id ??
    inventory.lexicalRegions.ownedRegionFor(callable)?.id ??
    `${occurrence}\0execution`;
  const generator = input.facts.getFact(callable, rustGeneratorFactKey);
  const instanceGenerator = generator !== undefined &&
    input.ast.kindName(callable) === "KindMethodDeclaration" &&
    !input.ast.hasModifierKind(callable, "static");
  const storage: RustExecutionStorage = instanceGenerator || !requiresStatic
    ? "borrowed"
    : "owned";
  const nonStatic = requirements.map((entry) => entry.lifetime)
    .filter((lifetime): lifetime is RustLifetimeRef =>
      lifetime !== undefined && lifetime.kind !== "static");
  const firstNonStatic = nonStatic[0];
  const lifetime = storage === "owned"
    ? Object.freeze({ kind: "static" as const })
    : firstNonStatic !== undefined && nonStatic.every((candidate) =>
        rustLifetimeSemanticKey(candidate) === rustLifetimeSemanticKey(firstNonStatic))
      ? firstNonStatic
      : Object.freeze({
          kind: "inferred-region" as const,
          regionId: lexicalRegionId,
        });
  if (generator !== undefined && (requiresSend || requiresSync)) {
    diagnostics.push(rustOwnershipDiagnostic(
      "RUST_GENERATOR_THREADED_EXECUTION_NOT_REPRESENTABLE",
      "The selected generator carrier is local, but its exact execution boundary requires threaded Send or Sync semantics.",
      callable,
    ));
    return undefined;
  }
  if (instanceGenerator && requiresStatic) {
    diagnostics.push(rustOwnershipDiagnostic(
      "RUST_GENERATOR_OWNED_EXECUTION_NOT_REPRESENTABLE",
      "An instance generator borrows its exact receiver and cannot satisfy an owned or 'static' execution boundary.",
      callable,
    ));
    return undefined;
  }
  return Object.freeze({
    kind: requiresSend || requiresSync ? "threaded" : "local",
    storage,
    lifetime,
    requiresSend,
    requiresSync,
    requiresStatic,
  });
}

function expectedCallableBounds(
  callable: Node,
  input: RustOwnershipAnalysisInput,
  evidence: RustCallableEvidenceIndex,
  budget: RustCaptureWorkBudget,
): readonly RustExpectedCallableBound[] {
  const bounds: RustExpectedCallableBound[] = [];
  const seen = new Set<string>();
  for (const candidate of evidence.candidatesFor(callable)) {
    const selected = enclosingCallInput(candidate, input);
    if (selected === undefined) continue;
    const operation = input.facts.getFact(selected.call, rustTargetOperationFactKey);
    if (operation?.kind !== "provider-operation" && operation?.kind !== "runtime-set") {
      continue;
    }
    const selectedInput = selected.input;
    const sourceCarrier = selectedInput.kind === "receiver"
      ? operation.abi.sourceReceiver.kind === "receiver"
        ? operation.abi.sourceReceiver.carrier
        : undefined
      : operation.abi.sourceArguments.find((argument) =>
          argument.sourceIndex === selectedInput.index)?.carrier;
    if (sourceCarrier === undefined) continue;
    for (const requirement of operation.abi.typeRequirements) {
      if (!requirement.sourceInputs.some((source) => selectedInput.kind === "receiver"
        ? source.kind === "receiver"
        : source.kind === "argument" && source.sourceIndex === selectedInput.index)) {
        continue;
      }
      if (!rustTargetTypeRefEquals(requirement.carrier, sourceCarrier)) continue;
      for (const bound of requirement.requirements) {
        if (bound.kind !== "type-outlives" ||
          rustTargetTypeRefEquals(bound.type, requirement.carrier)) {
          const key = rustResolvedProviderRequirementKey(requirement, bound);
          const operationIdentity = requireRustOwnershipSourceIdentity(input.ast, selected.call);
          const boundIdentity = `${operationIdentity}\0${key}`;
          if (seen.has(boundIdentity)) continue;
          budget.chargeCallableBound(selected.call);
          seen.add(boundIdentity);
          bounds.push(Object.freeze({
            operation: selected.call,
            requirement,
            bound,
          }));
        }
      }
    }
  }
  return Object.freeze(bounds);
}

function callableCaptureRequirementIsProven(
  expected: RustExpectedCallableBound,
  sourceCaptures: RustClosureCaptureFact["captures"],
  captures: readonly RustCapture[],
  sourceValues: RustSourceValueInventory,
  environment: RustOwnershipEnvironment,
): boolean {
  const requirementCarrier = expected.requirement.carrier;
  if (rustFutureOutputCarrier(requirementCarrier) !== undefined ||
    (requirementCarrier.kind !== "closure" &&
      requirementCarrier.kind !== "function-pointer" &&
      rustCallableProtocol(requirementCarrier) === undefined)) {
    return false;
  }
  if (sourceCaptures.length !== captures.length) return false;
  const bound = expected.bound;
  if (bound.kind === "trait" && bound.polarity === "required") {
    if (!captureDependentTrait(bound.trait)) return false;
    return captures.every((capture) =>
      captureRepresentationSupportsTrait(capture, bound.trait, environment));
  }
  if (bound.kind !== "type-outlives" ||
    !rustTargetTypeRefEquals(bound.type, expected.requirement.carrier)) {
    return false;
  }
  const execution: RustExecutionRequirements = Object.freeze({
    kind: "local",
    storage: bound.lifetime.kind === "static" ? "owned" : "borrowed",
    lifetime: bound.lifetime,
    requiresSend: false,
    requiresSync: false,
    requiresStatic: bound.lifetime.kind === "static",
  });
  return sourceCaptures.every((sourceCapture, index) => {
    const capture = captures[index];
    return capture !== undefined && captureLifetimeIsValid(
      sourceValues.contracts.get(sourceCapture.declaration),
      sourceCapture.carrier,
      capture.mode,
      execution,
      environment,
    );
  });
}

function captureDependentTrait(trait: RustTraitRef): boolean {
  return [rustCopyTrait, rustCloneTrait, rustSendTrait, rustSyncTrait, rustUnpinTrait]
    .some((candidate) => rustSemanticIdentitiesEqual(trait.identity, candidate.identity));
}

function captureRepresentationSupportsTrait(
  capture: RustCapture,
  trait: RustTraitRef,
  environment: RustOwnershipEnvironment,
): boolean {
  if (rustSemanticIdentitiesEqual(trait.identity, rustCopyTrait.identity)) {
    return environment.supportsTrait(capture.representationCarrier, rustCopyTrait);
  }
  if (rustSemanticIdentitiesEqual(trait.identity, rustCloneTrait.identity)) {
    return environment.supportsTrait(capture.representationCarrier, rustCloneTrait);
  }
  if (rustSemanticIdentitiesEqual(trait.identity, rustSendTrait.identity)) {
    return environment.supportsTrait(capture.representationCarrier, rustSendTrait);
  }
  if (rustSemanticIdentitiesEqual(trait.identity, rustSyncTrait.identity)) {
    return environment.supportsTrait(capture.representationCarrier, rustSyncTrait);
  }
  if (rustSemanticIdentitiesEqual(trait.identity, rustUnpinTrait.identity)) {
    return environment.supportsTrait(capture.representationCarrier, rustUnpinTrait);
  }
  return false;
}

function expectedCallableCarriers(
  callable: Node,
  input: RustOwnershipAnalysisInput,
  evidence: RustCallableEvidenceIndex,
): readonly RustTypeRef[] {
  const contextual = contextualCallableBoundaryCarriers(callable, input, evidence);
  if (contextual.length !== 0) return contextual;
  const carriers: RustTypeRef[] = [];
  const directCarrier = input.facts.getRuntimeCarrierFact(callable)?.carrier;
  if (directCarrier !== undefined) carriers.push(directCarrier);
  const operationCarrier = input.facts.getFact(callable, rustTargetOperationFactKey);
  if (operationCarrier?.kind === "closure") carriers.push(operationCarrier.resultCarrier);
  const generatorCarrier = input.facts.getFact(callable, rustGeneratorFactKey)?.carrier;
  if (generatorCarrier !== undefined) carriers.push(generatorCarrier);
  return Object.freeze(carriers);
}

function contextualCallableBoundaryCarriers(
  callable: Node,
  input: RustOwnershipAnalysisInput,
  evidence: RustCallableEvidenceIndex,
): readonly RustTypeRef[] {
  const carriers: RustTypeRef[] = [];
  for (const candidate of evidence.candidatesFor(callable)) {
    const selected = enclosingCallInput(candidate, input);
    if (selected === undefined) continue;
    const operation = input.facts.getFact(selected.call, rustTargetOperationFactKey);
    const selectedInput = selected.input;
    if (operation?.kind === "source-call" && selectedInput.kind === "argument") {
      for (const parameter of operation.parameters) {
        if (parameter.inputs.some((entry) =>
          entry.sourceArgumentIndex === selectedInput.index)) {
          carriers.push(parameter.parameterCarrier);
        }
      }
    } else if (operation?.kind === "provider-operation" || operation?.kind === "runtime-set") {
      if (operation.abi.targetReceiver.kind === "input") {
        collectFinalizedInputCarriers(
          operation.abi.targetReceiver.input,
          selectedInput,
          carriers,
        );
      }
      for (const targetArgument of operation.abi.targetArguments) {
        collectFinalizedInputCarriers(targetArgument, selectedInput, carriers);
      }
    }
  }
  return Object.freeze(carriers);
}

function collectFinalizedInputCarriers(
  input: import("../facts/finalized-operation-abi.js").RustFinalizedOperationAbi["targetArguments"][number],
  source: { readonly kind: "receiver" } | { readonly kind: "argument"; readonly index: number },
  carriers: RustTypeRef[],
): void {
  const matches = (
    candidate: { readonly kind: "receiver" } | { readonly kind: "argument"; readonly sourceIndex: number },
  ): boolean => candidate.kind === source.kind && (candidate.kind === "receiver" ||
    source.kind === "argument" && candidate.sourceIndex === source.index);
  if (isRustFinalizedSourceInput(input) && matches(input.source)) {
    carriers.push(input.parameterCarrier);
  } else if (isRustFinalizedSliceInput(input) || isRustFinalizedArrayInput(input)) {
    for (const element of input.elements) {
      if ((element.source.kind === "receiver" || element.source.kind === "argument") &&
        matches(element.source)) {
        carriers.push(element.parameterCarrier);
      }
    }
  } else if (isRustFinalizedTaggedArrayInput(input)) {
    for (const element of input.elements) {
      if ((element.input.source.kind === "receiver" ||
        element.input.source.kind === "argument") && matches(element.input.source)) {
        carriers.push(element.input.parameterCarrier);
      }
    }
  }
}

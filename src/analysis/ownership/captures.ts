import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  Node_Expression,
  Node_Initializer,
  sourceNodeIdentity,
} from "@tsonic/target-api/source";
import {
  rustGeneratorFactKey,
  rustClosureCaptureFactKey,
  rustSourceCallableReturnFactKey,
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
  RustGenericArgument,
  RustLifetimeRef,
  RustSuspensionPoint,
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
  rustReferenceTargetType,
  rustSendTrait,
  rustSyncTrait,
  rustUnpinTrait,
} from "../../target-model/types/index.js";
import {
  rustLifetimeSemanticKey,
  rustSemanticIdentitiesEqual,
  rustTypeSemanticKey,
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
import { rustOwnershipTraitProof } from "./operations.js";
import { rustPlaceKey, rustPlacesOverlap } from "./places.js";
import {
  isRustSourceValueDeclarationKind,
  type RustSourceValueInventory,
} from "./source-values.js";

interface RustExecutionRequirement {
  readonly kind: RustExecutionDomain;
  readonly storage: RustExecutionStorage;
  readonly lifetime?: RustLifetimeRef;
  readonly requiresSend: boolean;
  readonly requiresSync: boolean;
  readonly requiresStatic: boolean;
}

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
  readonly captureByNode: WeakMap<Node, RustCapture>;
  readonly executionCarrierByNode: WeakMap<Node, RustTypeRef>;
  readonly executionDomainByCallable: WeakMap<Node, RustExecutionDomain>;
  readonly executionStorageByCallable: WeakMap<Node, RustExecutionStorage>;
  readonly executionContractByCallable: WeakMap<Node, RustExecutionContract>;
  providerRequirementIsProven(operation: Node, requirementKey: string): boolean;
}

export function analyzeRustCaptures(
  flow: RustSourceFlowGraph,
  inventory: RustOwnershipNodeInventory,
  sourceValues: RustSourceValueInventory,
  operations: RustOwnershipOperationInventory,
  input: RustOwnershipAnalysisInput,
  environment: RustOwnershipEnvironment,
  diagnostics: TargetDiagnostic[],
): RustCaptureAnalysis {
  const capturesByCallable = new WeakMap<Node, readonly RustCapture[]>();
  const captureByNode = new WeakMap<Node, RustCapture>();
  const executionCarrierByNode = new WeakMap<Node, RustTypeRef>();
  const executionDomainByCallable = new WeakMap<Node, RustExecutionDomain>();
  const executionStorageByCallable = new WeakMap<Node, RustExecutionStorage>();
  const executionContractByCallable = new WeakMap<Node, RustExecutionContract>();
  const providerRequirementProofs = new WeakMap<Node, Set<string>>();
  const captureMoveValues = new WeakSet<Node>();
  for (const node of inventory.nodes) {
    const operation = input.facts.get(node, rustSourceOwnershipOperationFactKey);
    if (operation?.kind === "capture-move") captureMoveValues.add(operation.valueExpression);
  }
  for (const callable of inventory.nodes) {
    if (!isCallable(callable, input.ast)) continue;
    const fact = input.facts.getFact(callable, rustClosureCaptureFactKey) ??
      Object.freeze({ captures: Object.freeze([]) });
    const expectedBounds = expectedCallableBounds(callable, input);
    const diagnosticCount = diagnostics.length;
    const execution = executionRequirementsForCallable(
      callable,
      inventory,
      input,
      diagnostics,
      expectedBounds,
    );
    if (execution === undefined) continue;
    const suspensionPoints = collectSuspensionPoints(callable, flow, input.ast);
    const suspendedValues = collectSuspendedValues(
      callable,
      suspensionPoints,
      flow,
      inventory,
      input,
    );
    const forceMove = captureMoveValues.has(callable);
    const captures: RustCapture[] = [];
    let movesFromCapture = false;
    let mutatesCapture = false;
    for (const capture of fact.captures) {
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
      const movedByBody = operations.records.some((record) =>
        record.operation.kind === "move" &&
        rustPlacesOverlap(record.operation.place, place) &&
        enclosingCallable(record.node, input.ast) === callable);
      const mode = captureMode(
        forceMove,
        movedByBody,
        capture.storage,
        capture.carrier,
        sourceContract,
        execution,
        environment,
      );
      if (mode === undefined) {
        diagnostics.push(rustOwnershipDiagnostic(
          sourceContract?.kind === "owned"
            ? "RUST_NATIVE_CAPTURE_REQUIRES_EXPLICIT_MOVE"
            : "RUST_CAPTURE_CLONE_NOT_PROVEN",
          sourceContract?.kind === "owned"
            ? "A native owned capture crossing its lexical execution region requires captureMove(...)."
            : "A source-preserving closure capture requires exact Copy or Clone evidence.",
          capture.reference,
        ));
        continue;
      }
      movesFromCapture ||= movedByBody;
      mutatesCapture ||= mode === "mutable";
      if (!captureLifetimeIsValid(
        sourceContract,
        capture.carrier,
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
      const evidenceId = sourceNodeIdentity(input.ast, capture.reference) ??
        `capture\0${rustTypeSemanticKey(capture.carrier)}`;
      const representationCarrier = captureRepresentationCarrier(
        capture.carrier,
        mode,
        execution.lifetime,
      );
      const proof = mode === "copy"
        ? rustOwnershipTraitProof(rustCopyTrait, capture.carrier, evidenceId)
        : mode === "clone"
          ? rustOwnershipTraitProof(rustCloneTrait, capture.carrier, evidenceId)
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
        representationCarrier,
        mode,
        crossesSuspension: captureCrossesSuspension(
          capture.declaration,
          callable,
          suspensionPoints,
          flow,
          input,
        ),
        executionDomain: execution.kind,
        requiresStatic: execution.storage === "owned",
        ...(proof === undefined ? {} : { proof }),
        ...(execution.requiresSend
          ? { sendProof: rustOwnershipTraitProof(rustSendTrait, representationCarrier, evidenceId) }
          : {}),
        ...(execution.requiresSync
          ? { syncProof: rustOwnershipTraitProof(rustSyncTrait, representationCarrier, evidenceId) }
          : {}),
      });
      captures.push(selected);
      captureByNode.set(capture.reference, selected);
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
    );
    if (executionCarrier !== undefined) {
      for (const candidate of callableValueEvidenceCandidates(callable, input)) {
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
    executionDomainByCallable.set(callable, execution.kind);
    executionStorageByCallable.set(callable, execution.storage);
    executionContractByCallable.set(callable, Object.freeze({
      kind: execution.kind,
      storage: execution.storage,
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
    captureByNode,
    executionCarrierByNode,
    executionDomainByCallable,
    executionStorageByCallable,
    executionContractByCallable,
    providerRequirementIsProven(operation, requirementKey) {
      return providerRequirementProofs.get(operation)?.has(requirementKey) === true;
    },
  });
}

function finalizedCallableExecutionCarrier(
  callable: Node,
  input: RustOwnershipAnalysisInput,
  diagnostics: TargetDiagnostic[],
): RustTypeRef | undefined {
  const carriers = expectedCallableCarriers(callable, input).filter((carrier) =>
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
): boolean {
  const required: ("fn" | "fn-mut" | "fn-once")[] = [];
  for (const carrier of expectedCallableCarriers(callable, input)) {
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
  storage: "value" | "location",
  carrier: RustTypeRef,
  sourceContract: import("../../target-model/semantics/index.js").RustSourceValueContract | undefined,
  execution: RustExecutionRequirements,
  environment: RustOwnershipEnvironment,
): RustCapture["mode"] | undefined {
  if (forceMove) return "move";
  if (movedByBody) return undefined;
  if (sourceContract?.kind === "owned") {
    return execution.storage === "owned"
      ? undefined
      : "shared";
  }
  if (sourceContract?.kind === "shared-reference") return "copy";
  if (sourceContract?.kind === "mutable-reference") return "mutable";
  if (storage === "location") {
    return environment.supportsTrait(carrier, rustCloneTrait) ? "clone" : undefined;
  }
  if (environment.supportsTrait(carrier, rustCopyTrait)) return "copy";
  return environment.supportsTrait(carrier, rustCloneTrait) ? "clone" : undefined;
}

function captureRepresentationCarrier(
  carrier: RustTypeRef,
  mode: RustCapture["mode"],
  lifetime: RustLifetimeRef,
): RustTypeRef {
  if (mode !== "shared" && mode !== "mutable") return carrier;
  if (carrier.kind === "reference") return carrier;
  return rustReferenceTargetType(carrier, mode === "mutable", lifetime);
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
): RustExecutionRequirements | undefined {
  const requirements = [
    ...expectedCallableCarriers(callable, input).map(executionRequirementsForCarrier),
    ...expectedBounds.flatMap((entry) => executionRequirementsForBound(entry.bound)),
  ];
  const requiresSend = requirements.some((entry) => entry.requiresSend);
  const requiresSync = requirements.some((entry) => entry.requiresSync);
  const requiresStatic = requirements.some((entry) => entry.requiresStatic);
  const occurrence = sourceNodeIdentity(input.ast, callable) ?? "anonymous-callable";
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
): readonly RustExpectedCallableBound[] {
  const bounds: RustExpectedCallableBound[] = [];
  for (const candidate of callableEvidenceCandidates(callable, input)) {
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
          if (!bounds.some((entry) => entry.operation === selected.call &&
            rustResolvedProviderRequirementKey(entry.requirement, entry.bound) === key)) {
            bounds.push(Object.freeze({
              operation: selected.call,
              requirement,
              bound,
            }));
          }
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

function collectSuspendedValues(
  callable: Node,
  suspensionPoints: readonly RustSuspensionPoint[],
  flow: RustSourceFlowGraph,
  inventory: RustOwnershipNodeInventory,
  input: RustOwnershipAnalysisInput,
): readonly import("../../target-model/semantics/index.js").RustSuspendedValue[] {
  if (suspensionPoints.length === 0) return Object.freeze([]);
  const retained: import("../../target-model/semantics/index.js").RustSuspendedValue[] = [];
  const seen = new Set<string>();
  for (const declaration of inventory.nodes) {
    if (!isRustSourceValueDeclarationKind(input.ast.kindName(declaration)) ||
      enclosingCallable(declaration, input.ast) !== callable) {
      continue;
    }
    const place = inventory.places.get(declaration);
    const carrier = input.facts.getRuntimeCarrierFact(declaration)?.carrier;
    const declarationPoint = flow.pointFor(declaration);
    if (place === undefined || carrier === undefined || declarationPoint === undefined) continue;
    const references = input.navigation.referencesToDeclaration(declaration).filter((reference) =>
      nodeContains(callable, reference, input));
    const crosses = suspensionPoints.some((suspension) => {
      const suspensionPoint = flow.points.find((point) => point.node !== undefined &&
        sourceNodeIdentity(input.ast, point.node) === suspension.occurrenceId);
      return suspensionPoint !== undefined && flow.reaches(declarationPoint, suspensionPoint) &&
        references.some((reference) => flow.reaches(suspensionPoint, reference));
    });
    const key = `${rustTypeSemanticKey(carrier)}\0${rustPlaceKey(place)}`;
    if (!crosses || seen.has(key)) continue;
    seen.add(key);
    retained.push(Object.freeze({ place, carrier }));
  }
  return Object.freeze(retained);
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
): readonly RustTypeRef[] {
  const contextual = contextualCallableBoundaryCarriers(callable, input);
  if (contextual.length !== 0) return contextual;
  const carriers: RustTypeRef[] = [];
  const directCarrier = input.facts.getRuntimeCarrierFact(callable)?.carrier;
  if (directCarrier !== undefined) carriers.push(directCarrier);
  const operationCarrier = input.facts.getFact(callable, rustTargetOperationFactKey);
  if (operationCarrier?.kind === "closure") carriers.push(operationCarrier.resultCarrier);
  const generatorCarrier = input.facts.getFact(callable, rustGeneratorFactKey)?.carrier;
  if (generatorCarrier !== undefined) carriers.push(generatorCarrier);
  const returnCarrier = input.facts.getFact(callable, rustSourceCallableReturnFactKey)?.returnCarrier;
  if (returnCarrier !== undefined) carriers.push(returnCarrier);
  return Object.freeze(carriers);
}

function contextualCallableBoundaryCarriers(
  callable: Node,
  input: RustOwnershipAnalysisInput,
): readonly RustTypeRef[] {
  const carriers: RustTypeRef[] = [];
  for (const candidate of callableEvidenceCandidates(callable, input)) {
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

function callableEvidenceCandidates(
  callable: Node,
  input: RustOwnershipAnalysisInput,
): readonly Node[] {
  const candidates: Node[] = [];
  const pending: Node[] = [callable];
  const seen = new Set<Node>();
  while (pending.length > 0) {
    const candidate = pending.shift()!;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
    const invocation = directInvocationOf(candidate, input);
    if (invocation !== undefined) pending.push(invocation);
    const ownershipResult = exactCallableOwnershipResultOf(candidate, input);
    if (ownershipResult !== undefined) pending.push(ownershipResult);
    const initializedDeclaration = declarationInitializedExactlyBy(candidate, input);
    if (initializedDeclaration !== undefined) {
      for (const use of input.navigation.declarationUses(initializedDeclaration)) {
        if (use.kind !== "source-linkage" && use.kind !== "type-only") pending.push(use.reference);
      }
    }
  }
  return Object.freeze(candidates);
}

function callableValueEvidenceCandidates(
  callable: Node,
  input: RustOwnershipAnalysisInput,
): readonly Node[] {
  const candidates: Node[] = [];
  const pending: Node[] = [callable];
  const seen = new Set<Node>();
  while (pending.length > 0) {
    const candidate = pending.shift()!;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
    const transparentWrapper = transparentCallableValueWrapperOf(candidate, input);
    if (transparentWrapper !== undefined) pending.push(transparentWrapper);
    const ownershipResult = exactCallableOwnershipResultOf(candidate, input);
    if (ownershipResult !== undefined) pending.push(ownershipResult);
    const initializedDeclaration = declarationInitializedExactlyBy(candidate, input);
    if (initializedDeclaration !== undefined) {
      pending.push(initializedDeclaration);
      for (const use of input.navigation.declarationUses(initializedDeclaration)) {
        if (use.kind !== "source-linkage" && use.kind !== "type-only") pending.push(use.reference);
      }
    }
  }
  return Object.freeze(candidates);
}

function transparentCallableValueWrapperOf(
  node: Node,
  input: RustOwnershipAnalysisInput,
): Node | undefined {
  const parent = input.ast.parent(node);
  if (parent === undefined) return undefined;
  const kind = input.ast.kindName(parent);
  return kind === "KindParenthesizedExpression" || kind === "KindAsExpression" ||
      kind === "KindSatisfiesExpression" || kind === "KindNonNullExpression" ||
      kind === "KindTypeAssertionExpression"
    ? parent
    : undefined;
}

function exactCallableOwnershipResultOf(
  node: Node,
  input: RustOwnershipAnalysisInput,
): Node | undefined {
  let current = node;
  for (;;) {
    const parent = input.ast.parent(current);
    if (parent === undefined) return undefined;
    const kind = input.ast.kindName(parent);
    if (kind === "KindParenthesizedExpression" || kind === "KindAsExpression" ||
      kind === "KindSatisfiesExpression" || kind === "KindNonNullExpression" ||
      kind === "KindTypeAssertionExpression") {
      current = parent;
      continue;
    }
    if (kind !== "KindCallExpression") return undefined;
    const source = input.facts.getFact(parent, rustSourceOwnershipOperationFactKey);
    const target = input.facts.getFact(parent, rustTargetOperationFactKey);
    return source?.valueExpression === current &&
        target?.kind === "ownership-marker" &&
        isRustCallableCarrier(target.resultCarrier)
      ? parent
      : undefined;
  }
}

function directInvocationOf(node: Node, input: RustOwnershipAnalysisInput): Node | undefined {
  let current = node;
  for (;;) {
    const parent = input.ast.parent(current);
    if (parent === undefined) return undefined;
    const kind = input.ast.kindName(parent);
    if (kind === "KindParenthesizedExpression" || kind === "KindAsExpression" ||
      kind === "KindSatisfiesExpression" || kind === "KindNonNullExpression" ||
      kind === "KindTypeAssertionExpression") {
      current = parent;
      continue;
    }
    if (kind !== "KindCallExpression") return undefined;
    return Node_Expression(input.ast, parent) === current ? parent : undefined;
  }
}

function declarationInitializedExactlyBy(
  node: Node,
  input: RustOwnershipAnalysisInput,
): Node | undefined {
  let current = node;
  for (;;) {
    const parent = input.ast.parent(current);
    if (parent === undefined) return undefined;
    const kind = input.ast.kindName(parent);
    if (kind === "KindParenthesizedExpression" || kind === "KindAsExpression" ||
      kind === "KindSatisfiesExpression" || kind === "KindNonNullExpression" ||
      kind === "KindTypeAssertionExpression") {
      current = parent;
      continue;
    }
    return kind === "KindVariableDeclaration" && Node_Initializer(input.ast, parent) === current
      ? parent
      : undefined;
  }
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

function executionRequirementsForCarrier(carrier: RustTypeRef): RustExecutionRequirement {
  const callable = rustCallableProtocol(carrier);
  if (callable !== undefined) {
    const threaded = callable.storage === "threaded";
    return Object.freeze({
      kind: threaded ? "threaded" : "local",
      storage: callable.storage === "borrowed-local" ? "borrowed" : "owned",
      lifetime: callable.lifetime ?? Object.freeze({ kind: "static" as const }),
      requiresSend: threaded,
      requiresSync: threaded,
      requiresStatic: callable.storage !== "borrowed-local",
    });
  }
  const generator = getRustGeneratorProtocol(carrier);
  if (generator !== undefined) {
    const retainedLifetime = generator.lifetime ?? generatorExecutionLifetime(generator);
    return Object.freeze({
      kind: "local",
      storage: generator.storage === "borrowed" || retainedLifetime !== undefined
        ? "borrowed"
        : "owned",
      lifetime: retainedLifetime ?? Object.freeze({ kind: "static" as const }),
      requiresSend: false,
      requiresSync: false,
      requiresStatic: generator.storage === "owned" && retainedLifetime === undefined,
    });
  }
  const traits = executionTraits(carrier);
  const requiresSend = traits.some((trait) =>
    rustSemanticIdentitiesEqual(trait.identity, rustSendTrait.identity));
  const requiresSync = traits.some((trait) =>
    rustSemanticIdentitiesEqual(trait.identity, rustSyncTrait.identity));
  return Object.freeze({
    kind: requiresSend || requiresSync ? "threaded" : "local",
    storage: carrier.kind === "function-pointer" ? "owned" : "borrowed",
    lifetime: carrier.kind === "function-pointer"
      ? Object.freeze({ kind: "static" as const })
      : executionLifetime(carrier) ?? Object.freeze({
          kind: "inferred-region" as const,
          regionId: `carrier\0${rustTypeSemanticKey(carrier)}`,
        }),
    requiresSend,
    requiresSync,
    requiresStatic: carrier.kind === "function-pointer",
  });
}

function executionRequirementsForBound(bound: RustBound): readonly RustExecutionRequirement[] {
  if (bound.kind === "trait" && bound.polarity === "required") {
    const requiresSend = rustSemanticIdentitiesEqual(bound.trait.identity, rustSendTrait.identity);
    const requiresSync = rustSemanticIdentitiesEqual(bound.trait.identity, rustSyncTrait.identity);
    return requiresSend || requiresSync
      ? [Object.freeze({
          kind: "threaded" as const,
          storage: "borrowed" as const,
          requiresSend,
          requiresSync,
          requiresStatic: false,
        })]
      : [];
  }
  if (bound.kind === "type-outlives") {
    return [Object.freeze({
      kind: "local" as const,
      storage: bound.lifetime.kind === "static" ? "owned" as const : "borrowed" as const,
      lifetime: bound.lifetime,
      requiresSend: false,
      requiresSync: false,
      requiresStatic: bound.lifetime.kind === "static",
    })];
  }
  return [];
}

function generatorExecutionLifetime(
  protocol: import("../../target-model/types/index.js").RustGeneratorProtocol,
): RustLifetimeRef | undefined {
  return executionLifetime(protocol.yieldType) ??
    executionLifetime(protocol.returnType) ??
    executionLifetime(protocol.nextType);
}

function executionTraits(carrier: RustTypeRef): readonly RustTraitRef[] {
  switch (carrier.kind) {
    case "trait-object":
      return Object.freeze([carrier.principal, ...carrier.autoTraits]);
    case "path":
      return Object.freeze([
        ...carrier.traitImplementations.map((entry) => entry.trait),
        ...carrier.arguments.flatMap(genericArgumentExecutionTraits),
      ]);
    case "tuple":
      return Object.freeze(carrier.elements.flatMap(executionTraits));
    case "array":
    case "sequence":
    case "slice":
      return executionTraits(carrier.element);
    case "reference":
    case "raw-pointer":
      return executionTraits(carrier.target);
    default:
      return Object.freeze([]);
  }
}

function genericArgumentExecutionTraits(argument: RustGenericArgument): readonly RustTraitRef[] {
  return argument.kind === "type" ? executionTraits(argument.value) : Object.freeze([]);
}

function executionLifetime(carrier: RustTypeRef): RustLifetimeRef | undefined {
  switch (carrier.kind) {
    case "trait-object":
    case "reference":
      return carrier.lifetime;
    case "path":
      return carrier.arguments.flatMap((argument) => argument.kind === "lifetime"
        ? [argument.value]
        : argument.kind === "type"
          ? [executionLifetime(argument.value)].filter((value): value is RustLifetimeRef =>
            value !== undefined)
          : [])[0];
    case "closure":
      return carrier.captures.find((capture) => capture.kind === "lifetime")?.value;
    case "opaque":
      return carrier.captures.find((capture) => capture.kind === "lifetime")?.value;
    default:
      return undefined;
  }
}

function collectSuspensionPoints(
  callable: Node,
  flow: RustSourceFlowGraph,
  ast: AstReader,
): readonly RustSuspensionPoint[] {
  const points: RustSuspensionPoint[] = [];
  const visit = (node: Node): void => {
    if (node !== callable && isCallable(node, ast)) return;
    const kind = ast.kindName(node);
    if (kind === "KindAwaitExpression" || kind === "KindYieldExpression") {
      const occurrenceId = sourceNodeIdentity(ast, node);
      const point = flow.pointFor(node);
      if (occurrenceId !== undefined && point !== undefined) {
        points.push(Object.freeze({
          occurrenceId,
          kind: kind === "KindAwaitExpression" ? "await" : "yield",
          region: Object.freeze({
            id: `${occurrenceId}\0suspension`,
            kind: "suspension",
            parentId: point.regionId,
          }),
        }));
      }
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) visit(child);
    });
  };
  visit(callable);
  return Object.freeze(points);
}

function captureCrossesSuspension(
  declaration: Node,
  callable: Node,
  suspensionPoints: readonly RustSuspensionPoint[],
  flow: RustSourceFlowGraph,
  input: RustOwnershipAnalysisInput,
): boolean {
  if (suspensionPoints.length === 0) return false;
  const references = input.navigation.referencesToDeclaration(declaration).filter((reference) =>
    nodeContains(callable, reference, input));
  return suspensionPoints.some((suspension) => {
    const suspensionPoint = flow.points.find((point) => point.node !== undefined &&
      sourceNodeIdentity(input.ast, point.node) === suspension.occurrenceId);
    return suspensionPoint !== undefined && references.some((reference) =>
      flow.reaches(suspensionPoint, reference));
  });
}

function enclosingCallInput(
  node: Node,
  input: RustOwnershipAnalysisInput,
): {
  readonly call: Node;
  readonly input: { readonly kind: "receiver" } | { readonly kind: "argument"; readonly index: number };
} | undefined {
  let current = node;
  for (;;) {
    const parent = input.ast.parent(current);
    if (parent === undefined || isCallable(parent, input.ast)) return undefined;
    const kind = input.ast.kindName(parent);
    if (kind === "KindCallExpression" || kind === "KindNewExpression") {
      const index = input.ast.arguments(parent).findIndex((argument) =>
        argument === current || argument !== undefined && nodeContains(argument, current, input));
      if (index >= 0) {
        return { call: parent, input: { kind: "argument", index } };
      }
      const callee = Node_Expression(input.ast, parent);
      const calleeKind = callee === undefined ? undefined : input.ast.kindName(callee);
      const receiver = calleeKind === "KindPropertyAccessExpression" ||
          calleeKind === "KindElementAccessExpression"
        ? Node_Expression(input.ast, callee)
        : undefined;
      return receiver !== undefined && (receiver === current || nodeContains(receiver, current, input))
        ? { call: parent, input: { kind: "receiver" } }
        : undefined;
    }
    current = parent;
  }
}

function nodeContains(root: Node, selected: Node, input: RustOwnershipAnalysisInput): boolean {
  if (root === selected) return true;
  let found = false;
  input.ast.forEachChild(root, (child) => {
    if (!found && child !== undefined && nodeContains(child, selected, input)) found = true;
  });
  return found;
}

function isCallable(node: Node, ast: AstReader): boolean {
  const kind = ast.kindName(node);
  return kind === "KindFunctionDeclaration" || kind === "KindFunctionExpression" ||
    kind === "KindArrowFunction" || kind === "KindMethodDeclaration" ||
    kind === "KindConstructor" || kind === "KindGetAccessor" || kind === "KindSetAccessor";
}

function enclosingCallable(node: Node, ast: AstReader): Node | undefined {
  let current = ast.parent(node);
  while (current !== undefined) {
    if (isCallable(current, ast)) return current;
    current = ast.parent(current);
  }
  return undefined;
}

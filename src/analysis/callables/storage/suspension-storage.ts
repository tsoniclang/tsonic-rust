import type { Node } from "@tsonic/tsts";

import type { RustSuspendedCallableStorage } from "../../../target-model/records/callables/callables-and-resources.js";
import { selectRustCallableStorageLifetime, selectRustSuspendedStorageLifetime } from "../../../policy/ownership/suspended-storage.js";
import { rustEnclosingStorageContract } from "./storage-contracts.js";
import { type RustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import { rustLifetimeOutlives } from "../../../policy/constraints/lifetime-outlives.js";
import { sourceLexicalEnvironment, sourceCallableValueParameters } from "@tsonic/target-api/source";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustFactWalk } from "../../program/walk.js";
import type { RustSuspendedOwnedReceiver } from "../../../target-model/records/callables/callables-and-resources.js";
import type { RustRetainedEnvironment } from "../../../target-model/records/callables/retained-environments.js";

import { rustCallableInputLifetimeParameters } from "../ownership/source-input-lifetimes.js";
import { resolveExpressionCarrier } from "../../source-evidence/types/resolution/expression-carriers.js";
import { rustRetainedEnvironment, rustSuspendedCapturedParameters } from "../ownership/retained-values.js";
import { selectRustCallableOwnership } from "../ownership/ownership-plan.js";

export type RustSuspendedCallableStorageResolution =
  | {
      readonly kind: "resolved";
      readonly capturedParameters: readonly Node[];
      readonly capturedCarriers: readonly TargetTypeRef[];
      readonly storage: RustSuspendedCallableStorage;
      readonly ownedReceiver?: RustSuspendedOwnedReceiver;
      readonly retainedEnvironment?: RustRetainedEnvironment;
    }
  | { readonly kind: "rejected"; readonly reason: string };

export const rustSuspendingPromiseBorrowReason =
  "A suspending JS Promise body cannot retain a borrowed value across a pending point; its task requires owned storage.";

export function resolveRustSuspendedCallableStorage(
  walk: RustFactWalk,
  declaration: Node,
  storedCarriers: readonly TargetTypeRef[],
  ownedInputReceiver?: TargetTypeRef,
  requiredLifetime?: RustLifetimeRef,
): RustSuspendedCallableStorageResolution {
  walk.context.records.assertOpen();
  const { ast } = walk.context;
  const body = ast.body(declaration);
  if (body === undefined) {
    return { kind: "rejected", reason: "A suspended callable has no concrete source body." };
  }
  const parameters = sourceCallableValueParameters(ast, declaration, walk.context.semanticsFor(declaration));
  if (parameters === undefined) {
    return { kind: "rejected", reason: "A suspended callable contains an undefined parameter slot." };
  }
  const exactParameters = parameters as readonly Node[];
  const capturedParameters = rustSuspendedCapturedParameters(declaration, walk.context);
  if (capturedParameters === undefined) return {
    kind: "rejected", reason: "Suspended input retention requires exact checked parameter-use evidence.",
  };
  const receiverCaptures = walk.context.objectRepresentations.receiverCaptures;
  const capturedFields = receiverCaptures.capturesFor(declaration);
  const occurrences = walk.context.receiverOccurrences?.get(declaration);
  if (occurrences === undefined) return {
    kind: "rejected", reason: "Suspended input retention requires the complete checked receiver-occurrence inventory.",
  };
  const receiverOccurrences = occurrences.filter(node => capturedFields.length === 0 || !receiverCaptures.capturesReceiver(node));

  const owner = walk.context.projectTypes.definitionContainingDeclaration(declaration);
  const representation = walk.context.objectRepresentations.representationFor(owner);
  const receiverCarrier = ownedInputReceiver ?? (owner !== undefined && representation !== undefined && representation.kind !== "value"
    ? walk.context.projectTypes.openCarrier(owner) : undefined);
  const ownsReceiver = receiverOccurrences.length > 0 && !ast.hasModifierKind(declaration, "static") && receiverCarrier !== undefined;
  const ownedReceiver: RustSuspendedOwnedReceiver | undefined = ownsReceiver
    ? Object.freeze({ carrier: receiverCarrier!, occurrences: Object.freeze(receiverOccurrences) })
    : undefined;
  if (receiverOccurrences.length > 0 && !ast.hasModifierKind(declaration, "static") && ownedReceiver === undefined) {
    return {
      kind: "resolved",
      capturedParameters: Object.freeze(capturedParameters),
      capturedCarriers: Object.freeze([]),
      storage: Object.freeze({ kind: "receiver" }),
    };
  }

  const carriers: TargetTypeRef[] = [...storedCarriers, ...(ownedReceiver === undefined ? [] : [ownedReceiver.carrier])];
  const capturedCarriers: TargetTypeRef[] = [];
  for (const field of capturedFields) {
    const carrier = walk.context.records.capturedFieldStorage.get(field.declaration)?.valueCarrier;
    if (carrier === undefined) {
      return { kind: "rejected", reason: "A captured suspended-callable field has no exact finalized Rust storage carrier." };
    }
    capturedCarriers.push(carrier);
  }
  for (const parameter of capturedParameters) {
    const carrier = walk.context.records.sourceParameterAbi.get(parameter)
      ?.parameterCarrier;
    if (carrier === undefined) {
      return {
        kind: "rejected",
        reason: "A captured suspended-callable parameter has no exact finalized Rust ABI carrier.",
      };
    }
    carriers.push(carrier);
  }
  const lexical = sourceLexicalEnvironment(declaration, [body], ast, walk.context.source.navigation, "source",
    (use, referencedDeclaration) => walk.context.records.compileTimeSource.get(use.reference) !== true &&
      walk.context.runtimeValueUses.isRuntimeReference(referencedDeclaration, use.reference));
  if (lexical.kind === "unresolved") return { kind: "rejected", reason: lexical.reason };
  const subject = walk.context.sourceStorage.subject(declaration, "value");
  if (subject.kind === "unresolved") return { kind: "rejected", reason: subject.reason };
  const ownership = selectRustCallableOwnership(walk.context.callableOwnership, subject.subject,
    { kind: "construction", declaration }, []);
  if (ownership.kind === "unresolved") return { kind: "rejected", reason: ownership.reason };
  if (ownership.kind === "frame" && ownership.activation.kind === "class") {
    const definition = walk.context.projectTypes.definitionForDeclaration(ownership.activation.ownerDeclaration);
    const instance = definition === undefined ? undefined : walk.context.projectTypes.openCarrier(definition);
    if (instance === undefined) return { kind: "rejected",
      reason: "A suspended class activation has no exact native instance storage carrier." };
    capturedCarriers.push(instance);
  }
  const captures = ownership.kind === "frame" ? ownership.activation.externalCaptures
    : lexical.captures.map(capture => ({ ...capture, kind: "lexical" as const }));
  for (const capture of captures) {
    const reference = capture.references[0];
    const sourceFile = reference === undefined ? undefined : ast.getSourceFile(reference);
    const stored = capture.kind === "field"
      ? walk.context.records.capturedFieldStorage.get(capture.declaration)?.valueCarrier
      : capture.kind === "receiver" ? undefined
      : walk.context.records.runtimeCarrier.get(capture.declaration)?.carrier;
    const carrier = stored ??
      (reference === undefined || sourceFile === undefined ? undefined
        : resolveExpressionCarrier(walk, reference, sourceFile, undefined));
    if (carrier === undefined) return { kind: "rejected",
      reason: "A suspended callable's lexical capture has no exact native storage carrier." };
    capturedCarriers.push(carrier);
  }
  carriers.push(...capturedCarriers);
  const sourceContract = rustEnclosingStorageContract(declaration, ast, walk.context.sourceLifetimes);
  const inferred = rustCallableInputLifetimeParameters(declaration, ast, walk.context.records);
  const contract = inferred.length === 0 ? sourceContract : { declaration,
    parameters: [...sourceContract.parameters, ...inferred] };
  const inputCarriers = exactParameters.map(parameter =>
    walk.context.records.sourceParameterAbi.get(parameter)?.parameterCarrier);
  const environment = rustRetainedEnvironment(declaration, inputCarriers, walk.context);
  if (environment.kind === "unresolved") return { kind: "rejected", reason: environment.reason };
  if (requiredLifetime !== undefined) {
    const captured = selectRustSuspendedStorageLifetime({ carriers, lifetimes: [] }, contract);
    if (captured === undefined || !rustLifetimeOutlives(captured, requiredLifetime, contract)) return {
      kind: "rejected", reason: rustSuspendingPromiseBorrowReason,
    };
  }
  const lifetime = requiredLifetime ?? (environment.kind === "selected" ? environment.environment.lifetime
    : inputCarriers.some(carrier => carrier === undefined) ? undefined
    : selectRustCallableStorageLifetime(inputCarriers as readonly TargetTypeRef[], { carriers, lifetimes: [] }, contract));
  if (lifetime === undefined) {
    return {
      kind: "rejected",
      reason: "A suspended callable's captured lifetimes require one exact native storage lifetime from its authored contract or unambiguous input elision.",
    };
  }
  const retainedEnvironment = environment.kind === "selected" && requiredLifetime === undefined
    ? environment.environment : undefined;
  if (lifetime.kind === "static") {
    return {
      kind: "resolved",
      capturedParameters: Object.freeze(capturedParameters),
      capturedCarriers: Object.freeze(capturedCarriers),
      storage: Object.freeze({ kind: "static" }),
      ...(ownedReceiver === undefined ? {} : { ownedReceiver }),
      ...(retainedEnvironment === undefined ? {} : { retainedEnvironment }),
    };
  }
  return {
    kind: "resolved",
    capturedParameters: Object.freeze(capturedParameters),
    capturedCarriers: Object.freeze(capturedCarriers),
    storage: Object.freeze({ kind: "lifetime", lifetime }),
    ...(ownedReceiver === undefined ? {} : { ownedReceiver }),
    ...(retainedEnvironment === undefined ? {} : { retainedEnvironment }),
  };
}

import type { Node } from "@tsonic/tsts";
import { rustSourceParameterAbiFactKey } from "../facts/keys.js";
import type { RustSuspendedCallableStorage } from "../facts/keys.js";
import { rustEnclosingStorageContract, selectRustCallableStorageLifetime } from "../../policy/ownership/suspended-storage.js";
import { sourceLexicalEnvironment } from "@tsonic/target-api/source";
import { rustCompileTimeSourceKey } from "../../target-model/facts/source-declarations.js";
import { rustRuntimeCarrierKey } from "../../target-model/facts/selections.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustFactWalk } from "../program/walk.js";
import type { RustSuspendedOwnedReceiver } from "../facts/callables-and-resources.js";
import { rustCapturedFieldStorageFactKey } from "../facts/receiver-captures.js";
import { rustCallableInputLifetimeParameters } from "../facts/source-input-lifetimes.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";

export type RustSuspendedCallableStorageResolution =
  | {
      readonly kind: "resolved";
      readonly capturedParameters: readonly Node[];
      readonly storage: RustSuspendedCallableStorage;
      readonly ownedReceiver?: RustSuspendedOwnedReceiver;
    }
  | { readonly kind: "rejected"; readonly reason: string };

export function resolveRustSuspendedCallableStorage(
  walk: RustFactWalk,
  declaration: Node,
  storedCarriers: readonly TargetTypeRef[],
  ownedInputReceiver?: TargetTypeRef,
): RustSuspendedCallableStorageResolution {
  const { ast } = walk.context;
  const body = ast.body(declaration);
  if (body === undefined) {
    return { kind: "rejected", reason: "A suspended callable has no concrete source body." };
  }
  const parameters = ast.parameters(declaration);
  if (parameters.some((parameter) => parameter === undefined)) {
    return { kind: "rejected", reason: "A suspended callable contains an undefined parameter slot." };
  }
  const exactParameters = parameters as readonly Node[];
  const parameterSet = new Set(exactParameters);
  const capturedParameterSet = new Set<Node>();
  const receiverOccurrences: Node[] = [];
  const receiverCaptures = walk.context.objectRepresentations.receiverCaptures;
  const capturedFields = receiverCaptures.capturesFor(declaration);
  const visit = (node: Node): void => {
    if (ast.is.IsFunctionExpression(node) || ast.is.IsFunctionDeclaration(node) ||
      ast.is.IsClassDeclaration(node) || ast.is.IsClassExpression(node)) return;
    if (ast.kindName(node) === "KindThisKeyword" || ast.kindName(node) === "KindThisExpression") {
      if (capturedFields.length === 0 || !receiverCaptures.capturesReceiver(node)) receiverOccurrences.push(node);
    } else if (ast.kindName(node) === "KindIdentifier") {
      const selectedDeclaration = walk.context.source.navigation.sourceReferenceFor(node)?.declaration;
      const ownerParameter = selectedDeclaration === undefined
        ? undefined
        : containingParameter(selectedDeclaration, parameterSet, ast);
      if (ownerParameter !== undefined) {
        capturedParameterSet.add(ownerParameter);
      }
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) visit(child);
    });
  };
  visit(body);
  const capturedParameters = exactParameters.filter((parameter) =>
    capturedParameterSet.has(parameter));

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
      storage: Object.freeze({ kind: "receiver" }),
    };
  }

  const carriers: TargetTypeRef[] = [...storedCarriers, ...(ownedReceiver === undefined ? [] : [ownedReceiver.carrier])];
  for (const field of capturedFields) {
    const carrier = walk.context.facts.get(field.declaration, rustCapturedFieldStorageFactKey)?.valueCarrier;
    if (carrier === undefined) {
      return { kind: "rejected", reason: "A captured suspended-callable field has no exact finalized Rust storage carrier." };
    }
    carriers.push(carrier);
  }
  for (const parameter of capturedParameters) {
    const carrier = walk.context.facts.get(parameter, rustSourceParameterAbiFactKey)
      ?.parameterCarrier;
    if (carrier === undefined) {
      return {
        kind: "rejected",
        reason: "A captured suspended-callable parameter has no exact finalized Rust ABI carrier.",
      };
    }
    carriers.push(carrier);
  }
  const lexical = sourceLexicalEnvironment(declaration, [body], ast, walk.context.source.navigation,
    (use, referencedDeclaration) => walk.context.facts.get(use.reference, rustCompileTimeSourceKey) !== true &&
      walk.context.runtimeValueUses.isRuntimeReference(referencedDeclaration, use.reference));
  if (lexical.kind === "unresolved") return { kind: "rejected", reason: lexical.reason };
  for (const capture of lexical.captures) {
    const reference = capture.references[0];
    const sourceFile = reference === undefined ? undefined : ast.getSourceFile(reference);
    const carrier = walk.context.facts.get(capture.declaration, rustRuntimeCarrierKey)?.carrier ??
      (reference === undefined || sourceFile === undefined ? undefined
        : resolveExpressionCarrier(walk, reference, sourceFile, undefined));
    if (carrier === undefined) return { kind: "rejected",
      reason: "A suspended callable's lexical capture has no exact native storage carrier." };
    carriers.push(carrier);
  }
  const sourceContract = rustEnclosingStorageContract(declaration, ast, walk.context.sourceLifetimes);
  const inferred = rustCallableInputLifetimeParameters(declaration, ast, walk.context.facts);
  const contract = inferred.length === 0 ? sourceContract : { declaration,
    parameters: [...sourceContract.parameters, ...inferred] };
  const inputCarriers = exactParameters.map(parameter =>
    walk.context.facts.get(parameter, rustSourceParameterAbiFactKey)?.parameterCarrier);
  const lifetime = inputCarriers.some(carrier => carrier === undefined) ? undefined
    : selectRustCallableStorageLifetime(inputCarriers as readonly TargetTypeRef[], carriers, contract);
  if (lifetime === undefined) {
    return {
      kind: "rejected",
      reason: "A suspended callable's captured lifetimes require one exact native storage lifetime from its authored contract or unambiguous input elision.",
    };
  }
  if (lifetime.kind === "static") {
    return {
      kind: "resolved",
      capturedParameters: Object.freeze(capturedParameters),
      storage: Object.freeze({ kind: "static" }),
      ...(ownedReceiver === undefined ? {} : { ownedReceiver }),
    };
  }
  return {
    kind: "resolved",
    capturedParameters: Object.freeze(capturedParameters),
    storage: Object.freeze({ kind: "lifetime", lifetime }),
    ...(ownedReceiver === undefined ? {} : { ownedReceiver }),
  };
}

function containingParameter(
  selectedDeclaration: Node,
  parameters: ReadonlySet<Node>,
  ast: RustFactWalk["context"]["ast"],
): Node | undefined {
  let current: Node | undefined = selectedDeclaration;
  while (current !== undefined) {
    if (parameters.has(current)) return current;
    current = ast.parent(current);
  }
  return undefined;
}

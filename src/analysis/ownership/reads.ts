import type { Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  Node_Expression,
  sourceNodeIdentity,
} from "@tsonic/target-api/source";
import type {
  RustOwnershipOperation,
  RustPlaceRef,
  RustSourceValueContract,
  RustTypeRef,
  RustValueReadDisposition,
} from "../../target-model/semantics/index.js";
import { rustCloneTrait, rustCopyTrait } from "../../target-model/types/index.js";
import type {
  RustOwnershipAnalysisInput,
  RustOwnershipEnvironment,
} from "./context.js";
import type { RustOwnershipOperationInventory } from "./operations.js";
import { rustOwnershipTraitProof } from "./operations.js";

export function classifyRustOwnershipReads(
  nodes: readonly Node[],
  places: WeakMap<Node, RustPlaceRef>,
  sourceContracts: WeakMap<Node, RustSourceValueContract>,
  operations: RustOwnershipOperationInventory,
  input: RustOwnershipAnalysisInput,
  environment: RustOwnershipEnvironment,
): WeakMap<Node, RustValueReadDisposition> {
  const reads = new WeakMap<Node, RustValueReadDisposition>();
  for (const node of nodes) {
    if (places.get(node) === undefined || isWriteOnlyReference(node, input) ||
      isProjectionBase(node, input)) continue;
    const carrier = input.facts.getRuntimeCarrierFact(node)?.carrier ??
      runtimeCarrierForDeclaration(node, input);
    if (carrier === undefined) continue;
    const explicit = operations.operationForSourceValue(node);
    const disposition = explicit === undefined
      ? implicitReadDisposition(node, carrier, sourceContracts.get(node), input, environment)
      : explicitReadDisposition(explicit);
    if (disposition !== undefined) reads.set(node, disposition);
  }
  return reads;
}

function isProjectionBase(
  node: Node,
  input: RustOwnershipAnalysisInput,
): boolean {
  let current = node;
  for (;;) {
    const parent = input.ast.parent(current);
    if (parent === undefined) return false;
    const kind = input.ast.kindName(parent);
    if (isTransparent(kind)) {
      current = parent;
      continue;
    }
    return (kind === "KindPropertyAccessExpression" || kind === "KindElementAccessExpression") &&
      Node_Expression(input.ast, parent) === current;
  }
}

function implicitReadDisposition(
  node: Node,
  carrier: RustTypeRef,
  sourceContract: RustSourceValueContract | undefined,
  input: RustOwnershipAnalysisInput,
  environment: RustOwnershipEnvironment,
): RustValueReadDisposition {
  const evidenceId = sourceNodeIdentity(input.ast, node) ?? "sealed-read";
  if (environment.supportsTrait(carrier, rustCopyTrait)) {
    return Object.freeze({
      kind: "copy",
      proof: rustOwnershipTraitProof(rustCopyTrait, carrier, evidenceId),
    });
  }
  if (sourceContract !== undefined && sourceContract.kind !== "ordinary-typescript") {
    return Object.freeze({
      kind: "borrowed",
      mutable: sourceContract.kind === "mutable-reference",
    });
  }
  if (environment.supportsTrait(carrier, rustCloneTrait)) {
    return Object.freeze({
      kind: "clone",
      proof: rustOwnershipTraitProof(rustCloneTrait, carrier, evidenceId),
    });
  }
  return Object.freeze({ kind: "borrowed", mutable: false });
}

function explicitReadDisposition(
  operation: RustOwnershipOperation,
): RustValueReadDisposition | undefined {
  switch (operation.kind) {
    case "copy":
      return Object.freeze({ kind: "copy", proof: operation.proof });
    case "move":
      return Object.freeze({ kind: "move" });
    case "clone":
    case "to-owned":
      return Object.freeze({ kind: "borrowed", mutable: false });
    case "shared-borrow":
      return Object.freeze({ kind: "borrowed", mutable: false });
    case "mutable-borrow":
      return Object.freeze({ kind: "borrowed", mutable: true });
    case "reborrow":
      return Object.freeze({ kind: "borrowed", mutable: operation.mutable });
    case "load":
      return Object.freeze({ kind: "borrowed", mutable: false });
    case "store":
    case "replace":
    case "take":
      return Object.freeze({ kind: "borrowed", mutable: true });
  }
}

function runtimeCarrierForDeclaration(
  node: Node,
  input: RustOwnershipAnalysisInput,
): RustTypeRef | undefined {
  const declaration = input.navigation.sourceReferenceFor(node)?.declaration;
  return input.facts.getRuntimeCarrierFact(declaration)?.carrier;
}

function isWriteOnlyReference(
  node: Node,
  input: RustOwnershipAnalysisInput,
): boolean {
  if (isWithinSimpleAssignmentTarget(node, input)) return true;
  const declaration = input.navigation.sourceReferenceFor(node)?.declaration;
  if (declaration === undefined) return false;
  return input.navigation.declarationUseSummary(declaration).uses.some((use) =>
    use.reference === node && use.role === "write");
}

function isWithinSimpleAssignmentTarget(
  node: Node,
  input: RustOwnershipAnalysisInput,
): boolean {
  let current = node;
  for (;;) {
    const parent = input.ast.parent(current);
    if (parent === undefined) return false;
    const kind = input.ast.kindName(parent);
    if (kind === "KindBinaryExpression") {
      return BinaryExpression_Left(input.ast, parent) === current &&
        input.ast.operatorKindName(parent) === "KindEqualsToken";
    }
    if (isTransparent(kind)) {
      current = parent;
      continue;
    }
    if ((kind === "KindPropertyAccessExpression" || kind === "KindElementAccessExpression") &&
      Node_Expression(input.ast, parent) === current) {
      current = parent;
      continue;
    }
    return false;
  }
}

function isTransparent(kind: string): boolean {
  return kind === "KindParenthesizedExpression" || kind === "KindAsExpression" ||
    kind === "KindSatisfiesExpression" || kind === "KindNonNullExpression" ||
    kind === "KindTypeAssertionExpression";
}

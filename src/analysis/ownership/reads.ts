import type { Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  Node_Expression,
  sourceNodesEqual,
} from "@tsonic/target-api/source";
import type {
  RustOwnershipOperation,
  RustPlaceRef,
  RustSourceValueContract,
  RustTypeRef,
  RustValueReadDisposition,
} from "../../target-model/semantics/index.js";
import { rustCloneTrait, rustCopyTrait } from "../../target-model/types/index.js";
import { rustFlowReadProjectionFactKey } from "../facts/keys.js";
import type {
  RustOwnershipAnalysisInput,
  RustOwnershipEnvironment,
} from "./context.js";
import type { RustOwnershipOperationInventory } from "./operations.js";
import { rustOwnershipTraitProof } from "./operations.js";
import { requireRustOwnershipSourceIdentity } from "./identity.js";

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
      isProjectionBase(node, input) && input.facts.getFact(node, rustFlowReadProjectionFactKey) === undefined) continue;
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
  const evidenceId = requireRustOwnershipSourceIdentity(input.ast, node);
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
  if (canImplicitlyMoveOrdinarySourceReference(node, input)) {
    return Object.freeze({ kind: "move" });
  }
  if (environment.supportsTrait(carrier, rustCloneTrait)) {
    return Object.freeze({
      kind: "clone",
      proof: rustOwnershipTraitProof(rustCloneTrait, carrier, evidenceId),
    });
  }
  return Object.freeze({ kind: "borrowed", mutable: false });
}

function canImplicitlyMoveOrdinarySourceReference(
  reference: Node,
  input: RustOwnershipAnalysisInput,
): boolean {
  const selected = input.navigation.sourceReferenceFor(reference);
  const declaration = selected?.declaration;
  if (selected?.symbol === undefined || declaration === undefined ||
    enclosingCallable(declaration, input) === undefined) {
    return false;
  }
  const declarationKind = input.ast.variableDeclarationKind(declaration);
  if (declarationKind === "using" || declarationKind === "await using") {
    return false;
  }
  const summary = input.navigation.declarationUseSummary(declaration);
  if (summary.captured || summary.exported) {
    return false;
  }
  if (isExactCallableExitValue(reference, declaration, selected.symbol, input)) {
    return true;
  }
  const runtimeUses = summary.uses.filter((use) =>
    use.kind !== "source-linkage" && use.kind !== "type-only");
  return !summary.bindingWritten && runtimeUses.length === 1 &&
    sourceNodesEqual(input.ast, runtimeUses[0]?.reference, reference) &&
    !isInsideRepeatedRegion(reference, declaration, input);
}

function isExactCallableExitValue(
  reference: Node,
  declaration: Node,
  symbol: NonNullable<NonNullable<ReturnType<RustOwnershipAnalysisInput["navigation"]["sourceReferenceFor"]>>["symbol"]>,
  input: RustOwnershipAnalysisInput,
): boolean {
  const declarationCallable = enclosingCallable(declaration, input);
  if (declarationCallable === undefined) {
    return false;
  }
  let current = reference;
  for (;;) {
    const parent = input.ast.parent(current);
    if (parent === undefined || parent === declarationCallable) {
      const body = input.ast.body(declarationCallable);
      return body !== undefined && sourceNodesEqual(input.ast, body, current);
    }
    if (isTransparentValueWrapper(parent, current, input)) {
      current = parent;
      continue;
    }
    if (input.ast.is.IsReturnStatement(parent) &&
      sourceNodesEqual(input.ast, Node_Expression(input.ast, parent), current) &&
      !returnCrossesRetainedControlRegion(parent, declarationCallable, input)) {
      const references = input.navigation.referencesWithin(symbol, current);
      return references.length === 1 &&
        sourceNodesEqual(input.ast, references[0], reference);
    }
    return false;
  }
}

function returnCrossesRetainedControlRegion(
  statement: Node,
  callable: Node,
  input: RustOwnershipAnalysisInput,
): boolean {
  let current = input.ast.parent(statement);
  while (current !== undefined && current !== callable) {
    const kind = input.ast.kindName(current);
    if (input.ast.is.IsTryStatement(current) || kind === "KindSwitchStatement" ||
      kind === "KindForStatement" || kind === "KindForInStatement" ||
      kind === "KindForOfStatement" || kind === "KindWhileStatement" ||
      kind === "KindDoStatement" || isCallableKind(kind)) {
      return true;
    }
    current = input.ast.parent(current);
  }
  return current !== callable;
}

function isTransparentValueWrapper(
  wrapper: Node,
  expression: Node,
  input: RustOwnershipAnalysisInput,
): boolean {
  if (!isTransparent(input.ast.kindName(wrapper))) {
    return false;
  }
  return sourceNodesEqual(input.ast, Node_Expression(input.ast, wrapper), expression);
}

function isInsideRepeatedRegion(
  reference: Node,
  declaration: Node,
  input: RustOwnershipAnalysisInput,
): boolean {
  const declarationCallable = enclosingCallable(declaration, input);
  let current = input.ast.parent(reference);
  while (current !== undefined && current !== declarationCallable) {
    const kind = input.ast.kindName(current);
    if (isCallableKind(kind) || kind === "KindForStatement" ||
      kind === "KindForInStatement" || kind === "KindForOfStatement" ||
      kind === "KindWhileStatement" || kind === "KindDoStatement") {
      return true;
    }
    current = input.ast.parent(current);
  }
  return current !== declarationCallable;
}

function enclosingCallable(
  node: Node,
  input: RustOwnershipAnalysisInput,
): Node | undefined {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (isCallableKind(input.ast.kindName(current))) {
      return current;
    }
    current = input.ast.parent(current);
  }
  return undefined;
}

function isCallableKind(kind: string): boolean {
  return kind === "KindFunctionDeclaration" || kind === "KindFunctionExpression" ||
    kind === "KindArrowFunction" || kind === "KindMethodDeclaration" ||
    kind === "KindConstructor" || kind === "KindGetAccessor" ||
    kind === "KindSetAccessor";
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

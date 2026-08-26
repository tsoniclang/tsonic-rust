import type { AstReader, Node, ProviderDeclarationIdentity } from "@tsonic/tsts";
import {
  ElementAccessExpression_ArgumentExpression,
  Node_Expression,
  type SourceProgramNavigation,
} from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type {
  RustPlaceProjection,
  RustPlaceRef,
  RustSemanticIdentity,
} from "../../target-model/semantics/index.js";
import {
  rustSemanticIdentitiesEqual,
  rustSemanticIdentityKey,
} from "../../target-model/semantics/index.js";
import {
  rustTargetOperationFactKey,
} from "../facts/keys.js";
import { requireRustOwnershipSourceIdentity } from "./identity.js";

export interface RustPlaceAnalysisContext {
  readonly ast: AstReader;
  readonly navigation: SourceProgramNavigation;
  readonly facts: RustPlanQueries;
}

export function rustPlaceForExpression(
  expression: Node,
  context: RustPlaceAnalysisContext,
): RustPlaceRef | undefined {
  const kind = context.ast.kindName(expression);
  if (kind === "KindIdentifier") {
    const declaration = context.navigation.sourceReferenceFor(expression)?.declaration;
    return declaration === undefined
      ? undefined
      : rustRootPlace(declaration, context.ast);
  }
  if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
    const owner = enclosingCallable(expression, context.ast);
    const ownerId = owner === undefined
      ? undefined
      : requireRustOwnershipSourceIdentity(context.ast, owner);
    return ownerId === undefined
      ? undefined
      : Object.freeze({ rootId: `${ownerId}\0this`, projections: Object.freeze([]) });
  }
  if (isTransparentExpression(kind)) {
    const inner = Node_Expression(context.ast, expression);
    return inner === undefined ? undefined : rustPlaceForExpression(inner, context);
  }
  if (kind === "KindPropertyAccessExpression") {
    const receiver = Node_Expression(context.ast, expression);
    const root = receiver === undefined ? undefined : rustPlaceForExpression(receiver, context);
    const projection = propertyProjection(expression, context);
    return root === undefined || projection === undefined
      ? undefined
      : appendProjection(root, projection);
  }
  if (kind === "KindElementAccessExpression") {
    const receiver = Node_Expression(context.ast, expression);
    const root = receiver === undefined ? undefined : rustPlaceForExpression(receiver, context);
    if (root === undefined) return undefined;
    const operation = context.facts.getFact(expression, rustTargetOperationFactKey);
    if (operation?.kind === "fixed-index" || operation?.kind === "tuple-index") {
      return appendProjection(root, Object.freeze({
        kind: operation.kind === "tuple-index" ? "tuple-field" : "fixed-index",
        index: operation.index,
      }));
    }
    const index = ElementAccessExpression_ArgumentExpression(context.ast, expression);
    const indexId = index === undefined
      ? undefined
      : requireRustOwnershipSourceIdentity(context.ast, index);
    return indexId === undefined
      ? undefined
      : appendProjection(root, Object.freeze({
          kind: "dynamic-index",
          expressionId: indexId,
        }));
  }
  return undefined;
}

export function rustPlaceForDeclaration(
  declaration: Node,
  ast: AstReader,
): RustPlaceRef | undefined {
  return rustRootPlace(declaration, ast);
}

export function rustTemporaryPlaceForExpression(
  expression: Node,
  ast: AstReader,
): RustPlaceRef | undefined {
  const occurrence = requireRustOwnershipSourceIdentity(ast, expression);
  return Object.freeze({
    rootId: `temporary\0${occurrence}`,
    projections: Object.freeze([]),
  });
}

export function rustPlacesOverlap(left: RustPlaceRef, right: RustPlaceRef): boolean {
  if (left.rootId !== right.rootId) return false;
  const count = Math.min(left.projections.length, right.projections.length);
  for (let index = 0; index < count; index += 1) {
    const leftProjection = left.projections[index]!;
    const rightProjection = right.projections[index]!;
    if (projectionsDefinitelyDisjoint(leftProjection, rightProjection)) return false;
  }
  return true;
}

export function rustPlaceContains(
  parent: RustPlaceRef,
  candidate: RustPlaceRef,
): boolean {
  if (parent.rootId !== candidate.rootId ||
    parent.projections.length > candidate.projections.length) {
    return false;
  }
  return parent.projections.every((projection, index) =>
    projectionsEqual(projection, candidate.projections[index]!));
}

export function rustPlaceKey(place: RustPlaceRef): string {
  return [place.rootId, ...place.projections.map(projectionKey)].join("\0");
}

export function rustDereferencedPlace(place: RustPlaceRef): RustPlaceRef {
  return appendProjection(place, Object.freeze({ kind: "dereference" }));
}

export function rustProjectedPlace(
  place: RustPlaceRef,
  projection: RustPlaceProjection,
): RustPlaceRef {
  return appendProjection(place, projection);
}

export function rustProjectFieldProjection(
  declaration: Node,
  ast: AstReader,
  displayName: string,
): RustPlaceProjection {
  return Object.freeze({
    kind: "field",
    identity: sourceSemanticIdentity(declaration, ast),
    displayName,
  });
}

function rustRootPlace(declaration: Node, ast: AstReader): RustPlaceRef | undefined {
  const rootId = requireRustOwnershipSourceIdentity(ast, declaration);
  return Object.freeze({ rootId, projections: Object.freeze([]) });
}

function appendProjection(
  root: RustPlaceRef,
  projection: RustPlaceProjection,
): RustPlaceRef {
  return Object.freeze({
    rootId: root.rootId,
    projections: Object.freeze([...root.projections, projection]),
  });
}

function propertyProjection(
  expression: Node,
  context: RustPlaceAnalysisContext,
): RustPlaceProjection | undefined {
  const operation = context.facts.getFact(expression, rustTargetOperationFactKey);
  if (operation?.kind === "source-field" && operation.declaration !== undefined) {
    return Object.freeze({
      kind: "field",
      identity: sourceSemanticIdentity(operation.declaration, context.ast),
      displayName: `field-${operation.storageIndex}`,
    });
  }
  const selected = context.facts.getSelectedTargetProperty(expression);
  const identity = selected?.providerDeclaration === undefined
    ? operation === undefined
      ? undefined
      : generatedOperationIdentity(operation.operationId, expression, context.ast)
    : providerMemberIdentity(selected.providerDeclaration);
  return identity === undefined
    ? undefined
    : Object.freeze({
        kind: "field",
        identity,
        displayName: selected?.providerDeclaration?.memberName ?? selected?.targetOperation ?? "field",
      });
}

function sourceSemanticIdentity(declaration: Node, ast: AstReader): RustSemanticIdentity {
  const sourceFile = ast.getSourceFile(declaration);
  return Object.freeze({
    kind: "project",
    packageId: "source-program",
    sourceFileId: ast.getPath(sourceFile),
    declarationId: `node:${requireRustOwnershipSourceIdentity(ast, declaration)}`,
  });
}

function providerMemberIdentity(
  declaration: ProviderDeclarationIdentity,
): RustSemanticIdentity | undefined {
  const itemParts = [
    declaration.exportId === undefined ? undefined : `export:${declaration.exportId}`,
    declaration.memberId === undefined ? undefined : `member:${declaration.memberId}`,
    declaration.signatureId === undefined ? undefined : `signature:${declaration.signatureId}`,
    declaration.memberKey === undefined
      ? undefined
      : `member-key:${declaration.memberKey.kind}:${declaration.memberKey.name}`,
  ].filter((part): part is string => part !== undefined);
  if (itemParts.length === 0) return undefined;
  return Object.freeze({
    kind: "provider",
    providerId: declaration.providerId,
    ...(declaration.providerVersion === undefined
      ? {}
      : { providerVersion: declaration.providerVersion }),
    compilationSnapshotId: [
      declaration.providerModuleId,
      declaration.artifactFileName ?? "",
    ].join("\0"),
    itemId: itemParts.join("\0"),
  });
}

function generatedOperationIdentity(
  operationId: string,
  expression: Node,
  ast: AstReader,
): RustSemanticIdentity | undefined {
  const occurrence = requireRustOwnershipSourceIdentity(ast, expression);
  return Object.freeze({
    kind: "generated",
    artifactId: "rust-ownership-analysis",
    itemId: `${operationId}\0${occurrence}`,
  });
}

function projectionsDefinitelyDisjoint(
  left: RustPlaceProjection,
  right: RustPlaceProjection,
): boolean {
  if (left.kind === "field" && right.kind === "field") {
    return !rustSemanticIdentitiesEqual(left.identity, right.identity);
  }
  if ((left.kind === "tuple-field" || left.kind === "fixed-index") &&
    (right.kind === "tuple-field" || right.kind === "fixed-index")) {
    return left.index !== right.index;
  }
  if (left.kind === "downcast" && right.kind === "downcast") {
    return !rustSemanticIdentitiesEqual(left.variant, right.variant);
  }
  return false;
}

function projectionsEqual(
  left: RustPlaceProjection,
  right: RustPlaceProjection,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "field":
      return right.kind === "field" &&
        rustSemanticIdentitiesEqual(left.identity, right.identity);
    case "tuple-field":
    case "fixed-index":
      return right.kind === left.kind && left.index === right.index;
    case "dynamic-index":
      return right.kind === "dynamic-index" &&
        left.expressionId === right.expressionId;
    case "dereference":
      return right.kind === "dereference";
    case "downcast":
      return right.kind === "downcast" &&
        rustSemanticIdentitiesEqual(left.variant, right.variant);
  }
}

function projectionKey(projection: RustPlaceProjection): string {
  switch (projection.kind) {
    case "field":
      return `field:${rustSemanticIdentityKey(projection.identity)}`;
    case "tuple-field":
      return `tuple:${projection.index}`;
    case "fixed-index":
      return `index:${projection.index}`;
    case "dynamic-index":
      return `dynamic:${projection.expressionId}`;
    case "dereference":
      return "deref";
    case "downcast":
      return `downcast:${rustSemanticIdentityKey(projection.variant)}`;
  }
}

function isTransparentExpression(kind: string): boolean {
  return kind === "KindParenthesizedExpression" || kind === "KindAsExpression" ||
    kind === "KindSatisfiesExpression" || kind === "KindNonNullExpression" ||
    kind === "KindTypeAssertionExpression";
}

function enclosingCallable(node: Node, ast: AstReader): Node | undefined {
  let current = ast.parent(node);
  while (current !== undefined) {
    const kind = ast.kindName(current);
    if (kind === "KindFunctionDeclaration" || kind === "KindFunctionExpression" ||
      kind === "KindArrowFunction" || kind === "KindMethodDeclaration" ||
      kind === "KindConstructor" || kind === "KindGetAccessor" ||
      kind === "KindSetAccessor") {
      return current;
    }
    current = ast.parent(current);
  }
  return undefined;
}

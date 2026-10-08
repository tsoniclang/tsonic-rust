import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { RustTargetProgram } from "../program/model.js";
import { rustTargetOperationFactKey } from "./keys.js";

export interface RustNativeStoragePathInput {
  readonly ast: AstReader;
  readonly facts: RustTargetProgram["facts"];
  readonly navigation: RustTargetProgram["sourceNavigation"];
}

export type RustNativeStorageProjection = Node | string;

export function rustNativeStorageRoot(node: Node, input: RustNativeStoragePathInput): Node | undefined {
  const visited = new Set<Node>();
  for (let depth = 0; depth < 256 && !visited.has(node); depth += 1) {
    visited.add(node);
    if (input.ast.is.IsIdentifier(node)) return input.navigation.sourceReferenceFor(node)?.declaration;
    const kind = input.ast.kindName(node);
    if (kind === "KindThisExpression" || kind === "KindThisKeyword") return input.ast.getSourceFile(node);
    const receiver = Node_Expression(input.ast, node);
    if (receiver === undefined) return undefined;
    node = receiver;
  }
  return undefined;
}

export function rustNativeStorageProjections(
  node: Node, root: Node, input: RustNativeStoragePathInput,
): readonly RustNativeStorageProjection[] | undefined {
  const projections: RustNativeStorageProjection[] = [];
  const visited = new Set<Node>();
  for (let depth = 0; depth < 256 && !visited.has(node); depth += 1) {
    visited.add(node);
    const kind = input.ast.kindName(node);
    if (kind === "KindIdentifier") return input.navigation.sourceReferenceFor(node)?.declaration === root
      ? Object.freeze(projections) : undefined;
    if (kind === "KindThisExpression" || kind === "KindThisKeyword") return input.ast.getSourceFile(node) === root
      ? Object.freeze(projections) : undefined;
    if (kind !== "KindParenthesizedExpression") {
      if (kind !== "KindPropertyAccessExpression") return undefined;
      const operation = input.facts.getFact(node, rustTargetOperationFactKey);
      if (operation?.kind !== "source-field" || operation.valueSemantics.kind !== "stored" ||
        operation.dispatch !== undefined || !Number.isSafeInteger(operation.storageIndex) || operation.storageIndex < 0) return undefined;
      projections.unshift(operation.declaration ?? `${operation.operationId}\0${operation.storageIndex}`);
    }
    const receiver = Node_Expression(input.ast, node);
    if (receiver === undefined) return undefined;
    node = receiver;
  }
  return undefined;
}

export function rustNativeStoragePathsDisjoint(
  left: readonly RustNativeStorageProjection[], right: readonly RustNativeStorageProjection[],
): boolean {
  const commonLength = Math.min(left.length, right.length);
  for (let index = 0; index < commonLength; index += 1) {
    if (left[index] !== right[index]) return true;
  }
  return false;
}

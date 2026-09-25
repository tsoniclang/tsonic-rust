import type { Node } from "@tsonic/tsts";
import { sourceBindingHasSingleCaptureOwner } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustCopyCarrier } from "../../target-model/types/index.js";
import { rustBindingStorageFactKey, rustMutatedBindingFactKey } from "../facts/keys.js";

export function rustCapturedBindingStorage(
  walk: RustFactWalk,
  declaration: Node,
  reference: Node,
  owner: Node,
  carrier: TargetTypeRef | undefined,
  permitSingleOwner: boolean,
): "value" | "location" | "cell" | undefined {
  const cached = walk.capturedBindingStorage.get(declaration);
  if (cached !== undefined) {
    return cached;
  }
  const selected = walk.context.source.navigation.sourceReferenceFor(reference);
  const sourceFile = walk.context.ast.getSourceFile(declaration);
  if (
    selected?.declaration !== declaration ||
    selected.symbol === undefined ||
    sourceFile === undefined
  ) {
    return undefined;
  }
  const mutated = walk.context.facts.get(declaration, rustMutatedBindingFactKey) !== undefined ||
    walk.context.source.navigation.bindingWritesWithin(selected.symbol, sourceFile).length > 0;
  const storage = !mutated ? "value" : permitSingleOwner &&
      walk.context.facts.get(declaration, rustBindingStorageFactKey) === undefined &&
      isRustCopyCarrier(carrier) && singleOwnerDirectBinding(walk, declaration, owner)
    ? "cell" : "location";
  walk.capturedBindingStorage.set(declaration, storage);
  return storage;
}

function singleOwnerDirectBinding(walk: RustFactWalk, declaration: Node, owner: Node): boolean {
  const { ast, source } = walk.context;
  if (!["KindVariableDeclaration", "KindParameter"].includes(ast.kindName(declaration))) return false;
  if (!sourceBindingHasSingleCaptureOwner(declaration, owner, [owner], ast, source.navigation)) return false;
  return source.navigation.declarationUseSummary(declaration).uses.every(use => {
    if (use.kind === "type-only") return true;
    for (let current = ast.parent(use.reference); current !== owner; current = ast.parent(current)) {
      if (current === undefined || ["KindArrowFunction", "KindFunctionExpression", "KindFunctionDeclaration",
        "KindMethodDeclaration", "KindGetAccessor", "KindSetAccessor", "KindConstructor"].includes(ast.kindName(current))) return false;
    }
    let expression = use.reference;
    let parent = ast.parent(expression);
    while (parent !== undefined && ["KindParenthesizedExpression", "KindAsExpression", "KindSatisfiesExpression",
      "KindNonNullExpression", "KindTypeAssertionExpression"].includes(ast.kindName(parent))) {
      expression = parent;
      parent = ast.parent(expression);
    }
    return parent !== undefined && ["KindReturnStatement", "KindBinaryExpression", "KindPrefixUnaryExpression",
      "KindPostfixUnaryExpression", "KindConditionalExpression", "KindVariableDeclaration", "KindArrayLiteralExpression",
      "KindPropertyAssignment", "KindShorthandPropertyAssignment", "KindIfStatement", "KindWhileStatement",
      "KindDoStatement", "KindForStatement", "KindSwitchStatement", "KindCaseClause", "KindExpressionStatement"].includes(ast.kindName(parent));
  });
}


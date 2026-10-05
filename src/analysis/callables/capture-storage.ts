import type { Node } from "@tsonic/tsts";
import { sourceBindingHasSingleCaptureOwner, sourceBindingCapturedBeforeInitialization } from "@tsonic/target-api/source";
import type { SourceDeclarationUse } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustCopyCarrier, rustCarrierSupportsClone } from "../../target-model/types/index.js";
import { rustBindingStorageFactKey, rustMutatedBindingFactKey } from "../facts/keys.js";
import type { RustClosureCaptureFact } from "../facts/keys.js";
import { rustCallArgumentIsOwned } from "../facts/parameter-passing.js";
import { rustSourceValueWrapperContains } from "../../policy/ownership/source-value-wrappers.js";

export type RustCaptureStorage = Pick<RustClosureCaptureFact["captures"][number], "storage" | "mutable"> & {
  readonly initialization?: "deferred";
};

export function rustCapturedBindingStorage(
  walk: RustFactWalk,
  declaration: Node,
  reference: Node,
  owner: Node,
  carrier: TargetTypeRef | undefined,
  permitSingleOwner: boolean,
  nativeCallTrait?: "Fn" | "FnMut" | "FnOnce",
  captureRoots: readonly Node[] = [owner],
): RustCaptureStorage | undefined {
  const selected = walk.context.source.navigation.sourceReferenceFor(reference);
  const sourceFile = walk.context.ast.getSourceFile(declaration);
  if (
    carrier === undefined ||
    selected?.declaration !== declaration ||
    selected.symbol === undefined ||
    sourceFile === undefined
  ) {
    return undefined;
  }
  const cached = walk.capturedBindingStorage.get(declaration);
  if (cached !== undefined) {
    return cached;
  }
  const mutated = walk.context.facts.get(declaration, rustMutatedBindingFactKey) !== undefined ||
    walk.context.source.navigation.bindingWritesWithin(selected.symbol, sourceFile).length > 0;
  const existing = walk.context.facts.get(declaration, rustBindingStorageFactKey);
  const deferred = sourceBindingCapturedBeforeInitialization(declaration, walk.context.ast, walk.context.source.navigation);
  const unique = mutated && permitSingleOwner && existing === undefined &&
    singleOwnerDirectBinding(walk, declaration, reference, owner, captureRoots);
  const storage: RustCaptureStorage = deferred
    ? { storage: "location", initialization: "deferred" }
    : existing?.storage === "location"
    ? { storage: "location" }
    : !mutated ? { storage: "value" }
    : unique && (nativeCallTrait === "FnMut" || nativeCallTrait === "FnOnce")
      ? { storage: "value", mutable: true }
      : unique && rustCarrierSupportsClone(carrier, walk.context.typeDefinitions)
        ? { storage: isRustCopyCarrier(carrier) ? "cell" : "borrow-cell" }
        : { storage: "location" };
  walk.capturedBindingStorage.set(declaration, storage);
  return storage;
}

function singleOwnerDirectBinding(
  walk: RustFactWalk, declaration: Node, reference: Node, owner: Node, captureRoots: readonly Node[],
): boolean {
  const { ast, source } = walk.context;
  if (!["KindVariableDeclaration", "KindParameter"].includes(ast.kindName(declaration))) return false;
  if (captureRoots.length === 0 || captureRoots.length > 65_536) return false;
  const summary = source.navigation.declarationUseSummary(declaration);
  if (summary.declaration !== declaration || summary.uses.length > 262_144 ||
    !summary.uses.some(use => use.reference === reference) ||
    summary.hasUnclassifiedValueUse !== summary.uses.some(use => use.role === "value")) return false;
  const roots = new Set(captureRoots);
  let steps = 0;
  return sourceBindingHasSingleCaptureOwner(declaration, owner, captureRoots, ast, source.navigation,
    (use: SourceDeclarationUse) => {
      if (++steps > 262_144) return false;
      for (let current = ast.parent(use.reference); current === undefined || !roots.has(current); current = ast.parent(current)) {
        if (++steps > 262_144) return false;
        if (current === undefined || ["KindArrowFunction", "KindFunctionExpression", "KindFunctionDeclaration",
          "KindMethodDeclaration", "KindGetAccessor", "KindSetAccessor", "KindConstructor"].includes(ast.kindName(current))) return false;
      }
      let expression = use.reference;
      let parent = ast.parent(expression);
      while (parent !== undefined && rustSourceValueWrapperContains(parent, expression, ast)) {
        if (++steps > 262_144) return false;
        expression = parent;
        parent = ast.parent(expression);
      }
      if (parent !== undefined && (ast.is.IsCallExpression(parent) || ast.is.IsNewExpression(parent))) {
        if (!rustCallArgumentIsOwned(expression, ast, walk.context.facts)) return false;
      } else if (parent !== undefined && ast.is.IsArrowFunction(parent) && ast.body(parent) === expression) {
        return true;
      } else if (parent === undefined || !["KindReturnStatement", "KindBinaryExpression", "KindPrefixUnaryExpression",
        "KindPostfixUnaryExpression", "KindConditionalExpression", "KindVariableDeclaration", "KindArrayLiteralExpression",
        "KindPropertyAssignment", "KindShorthandPropertyAssignment", "KindIfStatement", "KindWhileStatement",
        "KindDoStatement", "KindForStatement", "KindSwitchStatement", "KindCaseClause", "KindExpressionStatement"].includes(ast.kindName(parent))) {
        return false;
      }
      return true;
    });
}

import type { Node, SourceFile, Symbol } from "@tsonic/tsts";
import { sourceBindingHasSingleCaptureOwner, sourceBindingCapturedBeforeInitialization, sourceBindingScope, sourceBindingIterationScope } from "@tsonic/target-api/source";
import type { SourceDeclarationUse } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustCopyCarrier, rustCarrierSupportsClone } from "../../target-model/types/index.js";
import { rustBindingStorageFactKey, rustMutatedBindingFactKey, rustTargetOperationFactKey } from "../facts/keys.js";
import type { RustClosureCaptureFact } from "../facts/keys.js";
import { rustCallArgumentIsOwned } from "../facts/parameter-passing.js";
import { rustSourceValueWrapperContains } from "../../policy/ownership/source-value-wrappers.js";
import { rustBorrowedStringInputs } from "../facts/provider-borrows.js";

export type RustCaptureStorage = Pick<RustClosureCaptureFact["captures"][number], "storage" | "mutable"> & {
  readonly initialization?: "deferred";
  readonly iterationScope?: Node;
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
  const scope = sourceBindingScope(declaration, walk.context.ast);
  const iterationValue = existing === undefined && isRustCopyCarrier(carrier) && scope !== undefined &&
    iterationCaptureCanUseValue(walk, declaration, selected.symbol, scope, sourceFile);
  const unique = mutated && permitSingleOwner && existing === undefined &&
    singleOwnerDirectBinding(walk, declaration, reference, owner, captureRoots);
  const selectedStorage: RustCaptureStorage = deferred
    ? { storage: "location", initialization: "deferred" }
    : existing?.storage === "location"
    ? { storage: "location" }
    : !mutated || iterationValue ? { storage: "value" }
    : unique && (nativeCallTrait === "FnMut" || nativeCallTrait === "FnOnce")
      ? { storage: "value", mutable: true }
      : unique && rustCarrierSupportsClone(carrier, walk.context.typeDefinitions)
        ? { storage: isRustCopyCarrier(carrier) ? "cell" : "borrow-cell" }
        : { storage: "location" };
  const iterationScope = selectedStorage.storage === "location"
    ? sourceBindingIterationScope(declaration, walk.context.ast) : undefined;
  const storage = iterationScope === undefined ? selectedStorage : { ...selectedStorage, iterationScope };
  walk.capturedBindingStorage.set(declaration, storage);
  return storage;
}

function iterationCaptureCanUseValue(
  walk: RustFactWalk,
  declaration: Node,
  symbol: Symbol,
  scope: Node,
  sourceFile: SourceFile,
): boolean {
  const { ast, source } = walk.context;
  if (symbol === undefined || sourceBindingIterationScope(declaration, ast) !== scope) return false;
  const incrementor = ast.as.AsForStatement(scope)?.Incrementor;
  if (incrementor === undefined) return false;
  let steps = 0;
  const insideIncrementor = (node: Node, direct: boolean): boolean | undefined => {
    for (let current: Node | undefined = node; current !== undefined; current = ast.parent(current)) {
      if (++steps > 262_144) return undefined;
      if (current === incrementor) return true;
      if (current === scope) return false;
      if (direct && ["KindArrowFunction", "KindFunctionExpression", "KindFunctionDeclaration",
        "KindMethodDeclaration", "KindConstructor", "KindGetAccessor", "KindSetAccessor"].includes(ast.kindName(current))) return false;
    }
    return false;
  };
  const writes = source.navigation.bindingWritesWithin(symbol, sourceFile);
  const references = source.navigation.referencesToDeclaration(declaration);
  return writes.length <= 262_144 && writes.every(write => insideIncrementor(write.operation, true) === true) &&
    references.length <= 262_144 && references.every(reference =>
      insideIncrementor(reference, false) === false || insideIncrementor(reference, true) === true);
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
      const operation = parent === undefined ? undefined : walk.context.facts.get(parent, rustTargetOperationFactKey);
      if (operation?.kind === "provider-operation" && operation.abi.effects.evaluation === "pure" &&
        operation.abi.effects.safety === "safe" && operation.abi.effects.invocation === "infallible" &&
        operation.abi.result.kind === "sync" && isRustCopyCarrier(operation.abi.result.carrier) &&
        rustBorrowedStringInputs(parent!, operation, ast).includes(expression)) return true;
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

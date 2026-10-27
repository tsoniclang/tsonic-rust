import { requireRustRecord } from "../../program/records/objects/required-records.js";
import type { Node, SourceFile, Symbol } from "@tsonic/tsts";
import { Node_Expression, sourceBindingHasSingleCaptureOwner, sourceBindingScope, sourceBindingIterationScope } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { SourceDeclarationUse } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../../program/walk.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { isRustCopyCarrier, rustCarrierSupportsClone } from "../../../policy/constraints/native-traits.js";

import { rustCallArgumentIsOwned } from "../values/parameter-passing.js";
import { rustSourceValueWrapperContains } from "../../../policy/ownership/source-value-wrappers.js";
import { rustBorrowedStringInputs } from "../../storage/provider-borrows.js";
import { selectRustBindingLocationStorage } from "../../storage/binding-locations.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

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
  walk.context.records.assertOpen();
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
    if (!rustTargetTypeRefEquals(cached.carrier, carrier)) failTargetAnalysisInvariant("tsonic-rust",
      "Conflicting Rust semantic plan 'tsonic.rust.bindingStorage' for one exact source subject.");
    return cached.selection;
  }
  const existing = walk.context.records.bindingStorage.get(declaration);
  if (existing !== undefined) {
    const { valueCarrier, ...selection } = existing;
    if (!rustTargetTypeRefEquals(valueCarrier, carrier)) failTargetAnalysisInvariant("tsonic-rust",
      "Conflicting Rust semantic plan 'tsonic.rust.bindingStorage' for one exact source subject.");
    const storage = Object.freeze(selection);
    walk.capturedBindingStorage.set(declaration, { carrier, selection: storage });
    return storage;
  }
  const mutated = walk.context.records.mutatedBinding.get(declaration) !== undefined ||
    walk.context.source.navigation.bindingWritesWithin(selected.symbol, sourceFile).length > 0;
  const location = selectRustBindingLocationStorage(declaration, walk.context.ast, walk.context.source.navigation);
  const scope = sourceBindingScope(declaration, walk.context.ast);
  const iterationValue = isRustCopyCarrier(carrier) && scope !== undefined &&
    iterationCaptureCanUseValue(walk, declaration, selected.symbol, scope, sourceFile);
  const unique = mutated && permitSingleOwner &&
    singleOwnerDirectBinding(walk, declaration, reference, owner, captureRoots);
  const selectedStorage: RustCaptureStorage = location.initialization === "deferred" || walk.promotedStorageDeclarations.has(declaration)
    ? location
    : !mutated || iterationValue ? { storage: "value" }
    : unique && (nativeCallTrait === "FnMut" || nativeCallTrait === "FnOnce")
      ? { storage: "value", mutable: true }
      : unique && rustCarrierSupportsClone(carrier, walk.context.typeDefinitions)
        ? { storage: isRustCopyCarrier(carrier) ? "cell" : "borrow-cell" }
        : location;
  const storage = Object.freeze(selectedStorage);
  if (storage.storage !== "value") {
    requireRustRecord(walk.context.requiredRecords, "bindingStorage", declaration, storage.storage, "rustCapturedBindingStorage");
    walk.context.records.bindingStoragePlans.capture(declaration, carrier, storage);
  }
  walk.capturedBindingStorage.set(declaration, { carrier, selection: storage });
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
      const receiverCall = parent !== undefined &&
        (ast.is.IsPropertyAccessExpression(parent) || ast.is.IsElementAccessExpression(parent)) &&
        Node_Expression(ast, parent) === expression ? ast.parent(parent) : undefined;
      const operationNode = receiverCall !== undefined && ast.is.IsCallExpression(receiverCall) &&
        Node_Expression(ast, receiverCall) === parent ? receiverCall : parent;
      const operation = operationNode === undefined ? undefined : walk.context.records.targetOperation.get(operationNode);
      if (operation?.kind === "provider-operation" && operation.abi.effects.evaluation === "pure" &&
        operation.abi.effects.safety === "safe" && operation.abi.effects.invocation === "infallible" &&
        operation.abi.result.kind === "sync" && isRustCopyCarrier(operation.abi.result.carrier) &&
        rustBorrowedStringInputs(operationNode!, operation, ast).includes(expression)) return true;
      if (parent !== undefined && (ast.is.IsCallExpression(parent) || ast.is.IsNewExpression(parent))) {
        if (!rustCallArgumentIsOwned(expression, ast, walk.context.records)) return false;
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

import type { RustCaptureStorage } from "../../../target-model/records/callables/capture-storage.js";

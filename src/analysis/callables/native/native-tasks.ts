import type { Node, SourceFile, Type } from "@tsonic/tsts";
import { rejectedTargetStage, resolvedTargetStage, type TargetDiagnostic, type TargetStageResult } from "@tsonic/target-api/artifacts";
import { Node_Expression, sourceExpressionResultDisposition } from "@tsonic/target-api/source";
import { analyzeSourceNativeTaskGraph, createSourceStorageBudget, defaultSourceStorageLimits,
  type SourceNativeTaskGraph, type SourceNativeTaskSpawn, type SourceNativeTaskOwnerUse } from "@tsonic/target-api/analysis";
import type { RustAnalysisContext } from "../../program/context.js";
import { rustEffectiveValueCarrier } from "../../conversions/value-carrier-queries.js";
import type { RustFactWalk } from "../../program/walk.js";
import type { RustAwaitSelection } from "../../../target-model/types/await.js";
import { rustAwaitSelectionLeaves } from "../../../target-model/types/await.js";
import type { RustAwaitValueLeafFact } from "../../../target-model/records/callables/await-values.js";
import type { RustSourceErrorEffectSelection } from "../../errors/source-error-effects.js";
import { finalizeRustDiscardedAwaitSelection } from "../async/await-values.js";
import { rustFutureValueMatchesCarrier } from "../async/future-values.js";
import { rustFutureValueForStoredBranch } from "../storage/future-storage.js";
import { resolveOwnedSourceProfileTypeName } from "../../../policy/identities/source-types.js";
import { selectRustSourceProfileCompletionKind } from "../../../policy/operations/source-profiles/type-carriers.js";
import { resolveProviderTypeIdentity } from "../../../policy/identities/provider-types.js";
import { providerCarrierFromRelations } from "../../../policy/types/project/provider-instantiation.js";
import { isRustNativeFutureCarrier } from "../../../target-model/types/carriers/primitives.js";
import { rustJsPromiseOutputTargetType } from "../../../target-model/types/carriers/promises.js";
import { rustUnparenthesizedExpression } from "../../../target-model/syntax/expressions.js";
import { completeRustFutureValue } from "../async/suspension.js";

export interface RustNativeTaskCompletion extends SourceNativeTaskSpawn {
  readonly selection: RustAwaitSelection<RustAwaitValueLeafFact>;
}

export function completeRustNativeTaskValues(
  walk: RustFactWalk,
  graph: SourceNativeTaskGraph,
  errors: RustSourceErrorEffectSelection,
): TargetStageResult<readonly RustNativeTaskCompletion[]> {
  const completed: RustNativeTaskCompletion[] = [];
  const diagnostics: TargetDiagnostic[] = [];
  for (const spawn of graph.spawns) {
    const carrier = rustEffectiveValueCarrier(walk.context.records, spawn.operand);
    const known = walk.context.records.futureValue.get(spawn.operand);
    const selection = carrier === undefined ? undefined : finalizeRustDiscardedAwaitSelection(carrier, branch => completeRustFutureValue(walk, errors,
      known !== undefined && rustFutureValueMatchesCarrier(known, branch, walk.context.typeDefinitions)
        ? known : rustFutureValueForStoredBranch(walk, spawn.operand, branch, errors)), walk.context.typeDefinitions);
    if (selection === undefined || rustAwaitSelectionLeaves(selection).some(leaf => leaf.future === undefined ||
      leaf.future.errorBoundary === "js-rejection" || rustJsPromiseOutputTargetType(leaf.carrier) !== undefined)) {
      diagnostics.push({ code: "RUST_NATIVE_TASK_COMPLETION_NOT_CLOSED", category: "error", source: "tsonic-rust",
        sourceNode: spawn.node, message: "A native task requires its complete native future effects and discarded completion topology; provider-owned Promises retain their provider executor.",
        evidence: ["target.capability=rust.native-tasks"] });
    } else completed.push(Object.freeze({ ...spawn, selection }));
  }
  return diagnostics.length === 0 ? resolvedTargetStage(Object.freeze(completed)) : rejectedTargetStage(diagnostics);
}

export function analyzeRustNativeTaskGraph(input: {
  readonly context: Pick<RustAnalysisContext, "ast" | "source" | "sourceStorage" | "nativeNodes" | "isNativeNode" |
    "promiseResultUses" | "sourceProfiles" | "providerSemantics" | "jsEnabled" | "runtimeValueUses" | "sourceCallables" |
    "moduleCallables" | "callableInvocationReferences">;
  readonly publishedDeclarations: ReadonlySet<Node>;
  readonly lifecycleOwner: SourceFile | undefined;
}): TargetStageResult<SourceNativeTaskGraph> {
  const { context } = input;
  const { ast, source, sourceStorage: storage } = context;
  const spawns: { readonly node: Node; readonly operand: Node }[] = [];
  const unsupported: TargetDiagnostic[] = [];
  const refuse = (node: Node): void => { unsupported.push({ code: "RUST_NATIVE_TASK_CONTEXT_UNSUPPORTED", category: "error",
    source: "tsonic-rust", sourceNode: node,
    message: "Native task spawning requires a direct future-producing call in an ordinary function or the executable entry; captured, generator and initializer contexts are unsupported.",
    evidence: ["target.capability=rust.native-tasks"] }); };
  const nativeCompletion = (type: Type, node: Node, depth = 0): boolean => {
    if (depth >= 128) return false;
    const semantics = source.semantics.forNode(node);
    if (semantics.types.isUnion(type)) return semantics.types.unionOrIntersectionTypes(type)
      .some(member => nativeCompletion(member, node, depth + 1));
    const symbol = semantics.declarations.typeAliasSymbol(type) ?? semantics.declarations.typeSymbol(type);
    const name = resolveOwnedSourceProfileTypeName(symbol, { ast, currentSemantics: semantics }, context.sourceProfiles);
    const completion = name === undefined ? undefined : selectRustSourceProfileCompletionKind(name, context.jsEnabled);
    if (completion !== undefined) return completion === "native-future";
    const identity = resolveProviderTypeIdentity(semantics.facts.typeSubjects(type), { source });
    const row = identity === undefined ? undefined : providerCarrierFromRelations(identity, { providerTypes: context.providerSemantics.types });
    return isRustNativeFutureCarrier(row?.targetCarrier);
  };
  for (const [operand, use] of context.promiseResultUses) {
    if (!context.isNativeNode(operand) || use.kind !== "discarded" || !ast.is.IsVoidExpression(use.use)) continue;
    const checked = source.semantics.forNode(operand).types.expressionType(operand);
    if (checked === undefined || !nativeCompletion(checked, operand)) continue;
    const region = storage.enclosingRegionFor(use.use);
    const owner = region === undefined ? undefined : ast.parent(region);
    if (!ast.is.IsCallExpression(rustUnparenthesizedExpression(ast, operand)) || region === undefined ||
      sourceExpressionResultDisposition(ast, use.use).kind !== "discarded" || owner !== undefined &&
      (ast.is.IsPropertyDeclaration(owner) || ast.is.IsParameterDeclaration(owner) || ast.is.IsConstructorDeclaration(owner) ||
        ast.is.IsClassStaticBlockDeclaration(owner) || source.semantics.forNode(owner).operations.generator(owner) !== undefined)) {
      refuse(use.use);
      continue;
    }
    spawns.push(Object.freeze({ node: use.use, operand }));
  }
  if (unsupported.length !== 0) return rejectedTargetStage(Object.freeze(unsupported));
  const ownerUses = new Map<Node, SourceNativeTaskOwnerUse>();
  const callInputs = new Map<Node, "parameter" | "capture" | "none">();
  if (spawns.length !== 0) for (const node of context.nativeNodes) {
    const expression = ast.is.IsArrowFunction(node) || ast.is.IsFunctionExpression(node);
    const method = ast.is.IsMethodDeclaration(node) || ast.is.IsMethodSignatureDeclaration(node) ||
      ast.is.IsGetAccessorDeclaration(node) || ast.is.IsSetAccessorDeclaration(node);
    const parent = ast.parent(node);
    const nativeMethod = method && parent !== undefined && !ast.is.IsObjectLiteralExpression(parent);
    if (expression || ast.is.IsFunctionDeclaration(node) || ast.is.IsConstructorDeclaration(node) || method) {
      const referenceOwner = expression && parent !== undefined && ast.is.IsVariableDeclaration(parent) ? parent : node;
      const references = ast.is.IsConstructorDeclaration(node) ? [] : context.runtimeValueUses.firstClassReferencesFor(referenceOwner);
      const parameter = !expression && (ast.is.IsFunctionDeclaration(node) || ast.is.IsConstructorDeclaration(node) || nativeMethod) ||
        context.moduleCallables.isNativeCallableExpression(node) || context.sourceCallables.directLexicalBinding(node) !== undefined;
      const capture = references.length !== 0 || (expression || method && !nativeMethod) && !parameter;
      ownerUses.set(node, Object.freeze({ capture, parameter }));
    }
    if (!ast.is.IsCallExpression(node) && !ast.is.IsNewExpression(node)) continue;
    const semantics = source.semantics.forNode(node);
    const call = semantics.operations.call(node);
    const declaration = call === undefined ? undefined : semantics.declarations.signatureDeclaration(call.selectedSignature);
    const original = Node_Expression(ast, node);
    const callee = original === undefined ? undefined : rustUnparenthesizedExpression(ast, original);
    if (declaration === undefined || callee === undefined) continue;
    const reference = context.callableInvocationReferences.forTarget(callee, declaration);
    const member = ast.is.IsMethodDeclaration(declaration) || ast.is.IsMethodSignatureDeclaration(declaration);
    const directMember = member && reference.directDeclaration &&
      (ast.is.IsPropertyAccessExpression(callee) || ast.is.IsElementAccessExpression(callee)) &&
      !ast.is.IsObjectLiteralExpression(ast.parent(declaration));
    callInputs.set(node, ast.is.IsNewExpression(node) || reference.nativeFunction || directMember ? "parameter" : "capture");
  }
  const selected = analyzeSourceNativeTaskGraph({ source, storage, nodes: context.nativeNodes, spawns,
    lifecycleOwner: input.lifecycleOwner, ownerUses, callInputs, publishedDeclarations: input.publishedDeclarations,
    budget: createSourceStorageBudget(defaultSourceStorageLimits) });
  if (selected.kind === "resolved") {
    for (const call of selected.graph.calls) {
      if (!ast.is.IsSourceFile(call.owner)) continue;
      const use = sourceExpressionResultDisposition(ast, call.node);
      if (use.kind !== "discarded" && (use.kind !== "awaited-in-scope" || use.completionReturned)) refuse(call.node);
    }
    return unsupported.length === 0 ? resolvedTargetStage(selected.graph) : rejectedTargetStage(Object.freeze(unsupported));
  }
  return rejectedTargetStage(selected.issues.map(issue => ({ category: "error" as const, source: "tsonic-rust", sourceNode: issue.node,
    code: issue.kind === "public-scope" ? "RUST_NATIVE_TASK_PUBLIC_SCOPE_UNSUPPORTED"
      : issue.kind === "lifecycle-owner" ? "RUST_LIFECYCLE_ERROR_OWNER_MISSING"
        : issue.kind === "scope-owner" ? "RUST_NATIVE_TASK_SCOPE_OWNER_NOT_CLOSED" : "RUST_NATIVE_TASK_CALL_GRAPH_NOT_CLOSED",
    message: issue.reason, evidence: ["target.capability=rust.native-tasks"] })));
}

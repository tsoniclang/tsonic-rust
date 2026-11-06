import type { Node, SourceFile } from "@tsonic/tsts";
import { rejectedTargetStage, resolvedTargetStage, type TargetDiagnostic, type TargetStageResult } from "@tsonic/target-api/artifacts";
import { analyzeSourceDeclarationNativeTaskGraph, createSourceDeclarationOwnershipValues,
  createSourceDeclarationOwnershipBudget, defaultSourceDeclarationOwnershipLimits, sourceDeclarationOwnershipUnresolved,
  type SourceNativeTaskGraph, type SourceNativeTaskSpawn } from "@tsonic/target-api/analysis";
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
import { selectRustPublishedCompletion } from "../async/source-completion.js";
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
    "promiseResultUses" | "sourceProfiles" | "providerSemantics" | "jsEnabled" | "sourceCallables" | "moduleCallables" | "runtimeValueUses">;
  readonly publishedDeclarations: ReadonlySet<Node>;
  readonly lifecycleOwner: SourceFile | undefined;
}): TargetStageResult<SourceNativeTaskGraph> {
  const { context } = input;
  const { ast, source, sourceStorage: storage } = context;
  const empty: SourceNativeTaskGraph = Object.freeze({ lifecycleOwner: undefined, spawns: Object.freeze([]),
    owners: Object.freeze([]), parameterOwners: new Set<Node>(), calls: Object.freeze([]), entries: Object.freeze([]) });
  const root = context.nativeNodes[0] ?? source.sourceFiles[0];
  if (root === undefined) return resolvedTargetStage(empty);
  const budget = createSourceDeclarationOwnershipBudget(root, defaultSourceDeclarationOwnershipLimits);
  const spawns: { readonly node: Node; readonly operand: Node }[] = [];
  const unsupported: TargetDiagnostic[] = [];
  const refuse = (node: Node): void => { unsupported.push({ code: "RUST_NATIVE_TASK_CONTEXT_UNSUPPORTED", category: "error",
    source: "tsonic-rust", sourceNode: node,
    message: "Native task spawning requires a direct future-producing call in an ordinary function or the executable entry; captured, generator and initializer contexts are unsupported.",
    evidence: ["target.capability=rust.native-tasks"] }); };
  for (const [operand, use] of context.promiseResultUses) {
    if (!context.isNativeNode(operand) || use.kind !== "discarded" || !ast.is.IsVoidExpression(use.use)) continue;
    const completion = selectRustPublishedCompletion(operand, context, budget);
    if (completion.kind === "unresolved") return rejectedTargetStage([{ category: "error", source: "tsonic-rust",
      sourceNode: completion.at, code: completion.cause.kind === "resource-limit" ? "TSONIC_COMPILER_RESOURCE_LIMIT"
        : "RUST_NATIVE_TASK_COMPLETION_NOT_CLOSED", message: completion.reason,
      evidence: ["target.capability=rust.native-tasks"] }]);
    if (!completion.nativeFuture) continue;
    const region = storage.enclosingRegionFor(use.use);
    const owner = region === undefined ? undefined : ast.parent(region);
    if (!ast.is.IsCallExpression(rustUnparenthesizedExpression(ast, operand)) || region === undefined ||
      source.navigation.expressionResultDisposition(use.use).kind !== "discarded" || owner !== undefined &&
      (ast.is.IsPropertyDeclaration(owner) || ast.is.IsParameterDeclaration(owner) || ast.is.IsConstructorDeclaration(owner) ||
        ast.is.IsClassStaticBlockDeclaration(owner) || source.semantics.forNode(owner).operations.generator(owner) !== undefined)) {
      refuse(use.use);
      continue;
    }
    spawns.push(Object.freeze({ node: use.use, operand }));
  }
  if (unsupported.length !== 0) return rejectedTargetStage(Object.freeze(unsupported));
  if (spawns.length === 0) return resolvedTargetStage(empty);
  const { values } = createSourceDeclarationOwnershipValues({ source, sourceNodes: storage.nodes,
    nodes: context.nativeNodes, budget, limits: {} });
  const selected = analyzeSourceDeclarationNativeTaskGraph({ source, values, nodes: context.nativeNodes, spawns,
    lifecycleOwner: input.lifecycleOwner, publishedDeclarations: input.publishedDeclarations, budget,
    scopeFor(declaration) {
      const semantics = source.semantics.forNode(declaration);
      const selectedType = semantics.types.declarationSignatureInfo(declaration)?.returnType ??
        semantics.declarations.declaredValueType(declaration);
      if (selectedType === undefined) return sourceDeclarationOwnershipUnresolved(declaration,
        "A native task scope requires its exact checked callable declaration component.");
      const parent = ast.parent(declaration);
      const expression = ast.is.IsArrowFunction(declaration) || ast.is.IsFunctionExpression(declaration);
      const member = ast.is.IsMethodDeclaration(declaration) || ast.is.IsMethodSignatureDeclaration(declaration) ||
        ast.is.IsGetAccessorDeclaration(declaration) || ast.is.IsSetAccessorDeclaration(declaration);
      const parameter = !expression && (ast.is.IsFunctionDeclaration(declaration) || ast.is.IsConstructorDeclaration(declaration) ||
        member && parent !== undefined && !ast.is.IsObjectLiteralExpression(parent)) ||
        context.moduleCallables.isNativeCallableExpression(declaration) || context.sourceCallables.directLexicalBinding(declaration) !== undefined;
      const referenceOwner = expression && parent !== undefined && ast.is.IsVariableDeclaration(parent) ? parent : declaration;
      const captured = !ast.is.IsConstructorDeclaration(declaration) &&
        context.runtimeValueUses.firstClassReferencesFor(referenceOwner).some(reference => context.isNativeNode(reference)) ||
        (expression || member && parent !== undefined && ast.is.IsObjectLiteralExpression(parent)) && !parameter;
      return Object.freeze({ kind: !context.isNativeNode(declaration) ? "none" : captured ? "capture" : parameter ? "parameter" : "none",
        contract: Object.freeze({ kind: "declaration", declaration, component: Object.freeze({ selectedType }) }) });
    },
  });
  if (selected.kind === "resolved") {
    for (const call of selected.graph.calls) {
      if (!ast.is.IsSourceFile(call.owner)) continue;
      const use = source.navigation.expressionResultDisposition(call.node);
      if (use.kind !== "discarded" && (use.kind !== "awaited-in-scope" || use.completionReturned)) refuse(call.node);
    }
    return unsupported.length === 0 ? resolvedTargetStage(selected.graph) : rejectedTargetStage(Object.freeze(unsupported));
  }
  if (!("issues" in selected)) return rejectedTargetStage([{ category: "error", source: "tsonic-rust", sourceNode: selected.at,
    code: selected.cause.kind === "resource-limit" ? "TSONIC_COMPILER_RESOURCE_LIMIT" : "RUST_NATIVE_TASK_SCOPE_OWNER_NOT_CLOSED",
    message: selected.reason, evidence: ["target.capability=rust.native-tasks"] }]);
  return rejectedTargetStage(selected.issues.map(issue => ({ category: "error" as const, source: "tsonic-rust", sourceNode: issue.node,
    code: issue.kind === "public-scope" ? "RUST_NATIVE_TASK_PUBLIC_SCOPE_UNSUPPORTED"
      : issue.kind === "lifecycle-owner" ? "RUST_LIFECYCLE_ERROR_OWNER_MISSING"
        : issue.kind === "scope-owner" ? "RUST_NATIVE_TASK_SCOPE_OWNER_NOT_CLOSED" : "RUST_NATIVE_TASK_CALL_GRAPH_NOT_CLOSED",
    message: issue.reason, evidence: ["target.capability=rust.native-tasks"] })));
}

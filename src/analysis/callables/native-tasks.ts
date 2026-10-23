import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant, rejectedTargetStage, resolvedTargetStage, type TargetDiagnostic, type TargetStageResult } from "@tsonic/target-api/artifacts";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustAnalysisContext } from "../program/context.js";
import type { RustLexicalFunctionEnvironments } from "../../target-model/records/lexical-functions.js";
import { rustAwaitSelection } from "../../policy/operations/flow/await.js";
import { rustAwaitSelectionLeaves } from "../../target-model/types/await.js";
import { rustJsPromiseOutputTargetType } from "../../target-model/types/carriers/promises.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";
import type { RustFactWalk } from "../program/walk.js";
import type { RustAwaitSelection } from "../../target-model/types/await.js";
import type { RustAwaitValueLeafFact } from "../../target-model/records/await-values.js";
import type { RustSourceErrorEffectSelection } from "../errors/source-error-effects.js";
import { finalizeRustDiscardedAwaitSelection } from "./await-values.js";
import { rustFutureValueMatchesCarrier } from "./future-values.js";
import { rustFutureValueForStoredBranch } from "./future-storage.js";

export interface RustNativeTaskSpawn {
  readonly node: Node;
  readonly operand: Node;
  readonly owner: Node;
}

export interface RustNativeTaskCompletion extends RustNativeTaskSpawn {
  readonly selection: RustAwaitSelection<RustAwaitValueLeafFact>;
}

export interface RustNativeTaskGraph {
  readonly spawns: readonly RustNativeTaskSpawn[];
  readonly owners: readonly Node[];
  readonly capturedOwners: ReadonlySet<Node>;
  readonly calls: readonly { readonly node: Node; readonly owner: Node;
    readonly targets: readonly Node[] }[];
  readonly entries: readonly Node[];
}

export function completeRustNativeTaskValues(
  walk: RustFactWalk,
  graph: RustNativeTaskGraph,
  errors: RustSourceErrorEffectSelection,
): TargetStageResult<readonly RustNativeTaskCompletion[]> {
  const completed: RustNativeTaskCompletion[] = [];
  const diagnostics: TargetDiagnostic[] = [];
  for (const spawn of graph.spawns) {
    const carrier = rustEffectiveValueCarrier(walk.context.records, spawn.operand);
    const known = walk.context.records.futureValue.get(spawn.operand);
    const selection = carrier === undefined ? undefined : finalizeRustDiscardedAwaitSelection(carrier, branch =>
      known !== undefined && rustFutureValueMatchesCarrier(known, branch, walk.context.typeDefinitions)
        ? known : rustFutureValueForStoredBranch(walk, spawn.operand, branch, errors), walk.context.typeDefinitions);
    if (selection === undefined) {
      diagnostics.push({ code: "RUST_NATIVE_TASK_COMPLETION_NOT_CLOSED", category: "error", source: "tsonic-rust",
        sourceNode: spawn.node, message: "A native task requires its complete existing future effects and discarded completion topology.",
        evidence: ["target.capability=rust.native-tasks"] });
    } else completed.push(Object.freeze({ ...spawn, selection }));
  }
  return diagnostics.length === 0 ? resolvedTargetStage(Object.freeze(completed)) : rejectedTargetStage(diagnostics);
}

export function analyzeRustNativeTaskGraph(input: {
  readonly context: RustAnalysisContext;
  readonly lexicalFunctions: RustLexicalFunctionEnvironments;
  readonly publishedDeclarations: ReadonlySet<Node>;
}): TargetStageResult<RustNativeTaskGraph> {
  const { context, lexicalFunctions } = input;
  const { ast, records, sourceStorage: storage } = context;
  const diagnostics: TargetDiagnostic[] = [];
  const reject = (node: Node, code: string, message: string): void => {
    diagnostics.push({ code, category: "error", source: "tsonic-rust", sourceNode: node, message,
      evidence: ["target.capability=rust.native-tasks"] });
  };
  const ownerFor = (node: Node): Node => {
    const selected = sourceEnclosingCallable(node, ast) ?? ast.getSourceFile(node);
    if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native task requires its original checked execution owner.", node);
    return selected;
  };
  const spawns: RustNativeTaskSpawn[] = [];
  for (const [operand, use] of context.promiseResultUses) {
    if (!context.isNativeNode(operand) || use.kind !== "discarded" || !ast.is.IsVoidExpression(use.use)) continue;
    const topology = rustAwaitSelection(rustEffectiveValueCarrier(records, operand), context.typeDefinitions);
    if (topology === undefined || !rustAwaitSelectionLeaves(topology).some(leaf => leaf.future !== undefined &&
      rustJsPromiseOutputTargetType(leaf.future.futureCarrier) === undefined)) continue;
    spawns.push(Object.freeze({ node: use.use, operand, owner: ownerFor(operand) }));
  }
  if (spawns.length === 0) return resolvedTargetStage(Object.freeze({ spawns: Object.freeze([]),
    owners: Object.freeze([]), capturedOwners: new Set<Node>(), calls: Object.freeze([]), entries: Object.freeze([]) }));
  const edges: { readonly node: Node; readonly owner: Node; readonly targets: readonly Node[]; readonly exact: boolean }[] = [];
  for (const node of context.nativeNodes) {
    if (records.targetOperation.get(node)?.kind !== "source-call") continue;
    const owner = ownerFor(node);
    const bindings = ast.is.IsSourceFile(owner) ? storage.emptyBindings : context.callableValues.native.bindingsFor(owner);
    if (bindings === undefined) {
      reject(node, "RUST_NATIVE_TASK_CALL_GRAPH_NOT_CLOSED", "Native task scope propagation requires the exact checked caller activation.");
      continue;
    }
    const selected = storage.invocationImplementationsFor(node, bindings);
    if (selected.kind === "unresolved") {
      reject(node, "RUST_NATIVE_TASK_CALL_GRAPH_NOT_CLOSED", selected.reason);
      continue;
    }
    edges.push(Object.freeze({ node, owner, targets: selected.nodes, exact: selected.exact }));
  }
  const captures = new Map<Node, boolean>();
  const capturesScope = (owner: Node): boolean => {
    const existing = captures.get(owner);
    if (existing !== undefined) return existing;
    const lexical = lexicalFunctions.forDeclaration(owner);
    const module = records.moduleBinding.get(ast.parent(owner));
    const closure = records.targetOperation.get(owner)?.kind === "closure";
    const observed = ast.is.IsFunctionDeclaration(owner) && context.source.navigation.declarationUseSummary(owner).aliasedOrStored;
    const captured = module?.storage !== "native-callable" && (observed ||
      lexical?.kind === "resolved" && lexical.valueObserved || closure && lexical === undefined);
    captures.set(owner, captured);
    return captured;
  };
  const needed = new Set<Node>();
  const queue: Node[] = [];
  const requireOwner = (owner: Node): void => {
    if (needed.has(owner)) return;
    needed.add(owner);
    queue.push(owner);
  };
  for (const spawn of spawns) requireOwner(spawn.owner);
  const incoming = new Map<Node, typeof edges>();
  for (const edge of edges) for (const target of edge.targets) {
    const callers = incoming.get(target) ?? [];
    callers.push(edge);
    incoming.set(target, callers);
  }
  const selectedCalls = new Map<Node, RustNativeTaskGraph["calls"][number]>();
  for (let index = 0; index < queue.length; index++) {
    const owner = queue[index]!;
    if (ast.is.IsSourceFile(owner)) continue;
    const captured = capturesScope(owner);
    const authoredBinding = ast.parent(owner);
    if (input.publishedDeclarations.has(owner) || authoredBinding !== undefined && input.publishedDeclarations.has(authoredBinding))
      reject(owner, "RUST_NATIVE_TASK_PUBLIC_SCOPE_UNSUPPORTED",
      "A public package function requiring native task scope cannot expose an implicit executor parameter in its source ABI.");
    if (captured) requireOwner(ownerFor(ast.parent(owner) ?? owner));
    for (const edge of incoming.get(owner) ?? []) {
      if (!edge.exact || edge.targets.some(target => capturesScope(target) !== captured)) {
        reject(edge.node, "RUST_NATIVE_TASK_CALL_GRAPH_NOT_CLOSED",
          "A native task invocation requires one exact selected scope ownership contract for every callable alternative.");
        continue;
      }
      if (captured) continue;
      selectedCalls.set(edge.node, Object.freeze({ node: edge.node, owner: edge.owner, targets: edge.targets }));
      requireOwner(edge.owner);
    }
  }
  return diagnostics.length !== 0 ? rejectedTargetStage(diagnostics) : resolvedTargetStage(Object.freeze({
    spawns: Object.freeze(spawns),
    owners: Object.freeze([...needed].filter(owner => !ast.is.IsSourceFile(owner))),
    capturedOwners: new Set([...needed].filter(owner => !ast.is.IsSourceFile(owner) && capturesScope(owner))),
    calls: Object.freeze([...selectedCalls.values()]),
    entries: Object.freeze([...needed].filter(owner => ast.is.IsSourceFile(owner))),
  }));
}

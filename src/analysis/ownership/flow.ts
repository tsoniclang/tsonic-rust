import type { Node } from "@tsonic/tsts";
import { analyzeSourceLiveness, createSourceControlFlow, createSourceControlFlowDomain, type SourceFlowLimits,
  type SourceControlFlowGraph, type SourceFlowLivenessSelection, type SourceStorageQueries } from "@tsonic/target-api/analysis";
import { Node_Expression, isSourceCallableBodyBoundary, sourceEnclosingCallable, sourceExpressionResultDisposition, sourceNodesEqual, sourceParameterIsProperty, sourceTransparentExpressionOperand,
  type TargetSourceProgram } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustClosureCaptureFact } from "../../target-model/records/operation-selections.js";
import type { RustBorrowUseAnalysis } from "./effects.js";

export interface RustOwnershipFlow {
  readonly movingReads: ReadonlySet<Node>;
  readonly captureTransfers: ReadonlyMap<Node, ReadonlySet<Node>>;
  readonly graphs: ReadonlyMap<Node, SourceControlFlowGraph>;
  readonly liveness: ReadonlyMap<Node, Extract<SourceFlowLivenessSelection, { readonly kind: "resolved" }>>;
}

export interface RustOwnershipFlowInput {
  readonly source: TargetSourceProgram;
  readonly storage: SourceStorageQueries;
  readonly nativeNodes: readonly Node[];
  readonly borrowUses: RustBorrowUseAnalysis;
  readonly capturesFor: (closure: Node) => RustClosureCaptureFact | undefined;
  readonly isOnceCallable: (closure: Node) => boolean;
  readonly canMoveStoredField: (field: Node) => boolean;
  readonly isOwnedOperationResult: (expression: Node) => boolean;
  readonly mayBorrowArgument?: (argument: Node, reference: Node) => boolean;
  readonly isInstanceFieldUse?: (reference: Node, declaration: Node) => boolean;
  readonly limits?: Partial<SourceFlowLimits>;
}

export function analyzeRustOwnershipFlow(input: RustOwnershipFlowInput):
  | { readonly kind: "resolved"; readonly flow: RustOwnershipFlow }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] } {
  const { source, storage } = input;
  if (storage.source !== source) throw new Error("Rust ownership and flow require the identical checked source program.");
  if (input.borrowUses === undefined) return { kind: "rejected", diagnostics: [{
    code: "RUST_OWNERSHIP_FLOW_UNRESOLVED", category: "error", source: "tsonic-rust",
    message: "Rust ownership flow requires its original canonical native-use analysis.",
    evidence: ["target.capability=rust.analysis.ownership"],
  }] };
  const { ast } = source;
  const domain = createSourceControlFlowDomain(source, input.nativeNodes);
  if (domain.kind === "unresolved") return { kind: "rejected", diagnostics: [{
    code: "RUST_OWNERSHIP_FLOW_UNRESOLVED", category: "error", source: "tsonic-rust",
    message: domain.reason, sourceNode: domain.source,
    evidence: ["target.capability=rust.analysis.ownership"],
  }] };
  const nativeNodes = new Set(input.nativeNodes);
  const movingReads = new Set<Node>();
  const captureTransfers = new Map<Node, ReadonlySet<Node>>();
  const graphs = new Map<Node, SourceControlFlowGraph>();
  const livenessByDeclaration = new Map<Node, Extract<SourceFlowLivenessSelection, { readonly kind: "resolved" }>>();
  for (const declaration of input.nativeNodes) {
    if (input.borrowUses.failure() !== undefined) break;
    if (!isSourceCallableBodyBoundary(ast, declaration) || ast.body(declaration) === undefined) continue;
    const selected = createSourceControlFlow(source, declaration, { domain: domain.domain, limits: input.limits });
    const liveness = selected.kind === "resolved" ? analyzeSourceLiveness(selected.graph, input.limits) : selected;
    if (liveness.kind === "unresolved") return { kind: "rejected", diagnostics: [{
      code: "RUST_OWNERSHIP_FLOW_UNRESOLVED", category: "error", source: "tsonic-rust",
      message: liveness.reason, sourceNode: liveness.source ?? declaration,
      evidence: ["target.capability=rust.analysis.ownership"],
    }] };
    if (selected.kind !== "resolved") throw new Error("Resolved ownership liveness requires its source graph.");
    const graph = selected.graph;
    graphs.set(declaration, graph);
    livenessByDeclaration.set(declaration, liveness);
    const awaitedReads = new Set<Node>();
    for (const point of graph.points) if (point.operation.kind === "read" && point.source !== undefined &&
      liveness.reachable.has(point.id) && sourceEnclosingCallable(point.source, ast) === declaration &&
      sourceExpressionResultDisposition(ast, point.source).kind === "awaited-in-scope") awaitedReads.add(point.source);
    const ownedCaptures = new Set((input.capturesFor(declaration)?.captures ?? [])
      .filter(capture => capture.storage === "value").map(capture => capture.declaration));
    for (const point of graph.points) {
      if (!liveness.reachable.has(point.id) || point.source === undefined) continue;
      if (point.operation.kind === "capture") {
        const capture = input.capturesFor(point.source)?.captures.find(value =>
          sourceNodesEqual(ast, value.declaration, point.operation.kind === "capture" ? point.operation.binding : undefined));
        if (capture === undefined || capture.storage !== "value" ||
          liveness.after.get(point.id)!.has(point.operation.binding) ||
          !bindingCanTransfer(point.operation.binding, declaration, input, awaitedReads, nativeNodes)) continue;
        const transferred = new Set(captureTransfers.get(point.source));
        transferred.add(capture.declaration);
        captureTransfers.set(point.source, transferred);
      } else if (point.operation.kind === "read" && liveness.lastUses.has(point.source) &&
        !hasOverlappingArgumentBorrow(point.source, point.operation.binding, input, nativeNodes) &&
        (bindingCanTransfer(point.operation.binding, declaration, input, awaitedReads, nativeNodes) ||
          input.isOnceCallable(declaration) && ownedCaptures.has(point.operation.binding))) {
        movingReads.add(point.source);
      }
    }
  }
  for (const node of input.nativeNodes) {
    if (input.borrowUses.failure() !== undefined) break;
    if (sourceParameterIsProperty(ast, node)) {
      const summary = input.borrowUses.useSummaryFor(node);
      if (summary === undefined) break;
      const name = ast.name(node);
      if (name !== undefined && !summary.bindingWritten && summary.uses.every(use => !nativeNodes.has(use.reference) ||
        use.kind === "source-linkage" || use.kind === "type-only" || input.isInstanceFieldUse?.(use.reference, node) === true)) {
        movingReads.add(name);
      }
    }
  }
  const useFailure = input.borrowUses.failure();
  if (useFailure !== undefined) return { kind: "rejected", diagnostics: [{
    code: "RUST_BORROW_STABILITY_BUDGET_INVALID", category: "error", source: "tsonic-rust",
    message: useFailure, evidence: ["target.capability=rust.backend.borrow-stability"],
  }] };
  for (let index = input.nativeNodes.length - 1; index >= 0; index -= 1) {
    const node = input.nativeNodes[index]!;
    if (ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node) || input.isOwnedOperationResult(node)) movingReads.add(node);
    const operand = sourceTransparentExpressionOperand(ast, node);
    if (operand !== undefined && movingReads.has(operand)) movingReads.add(node);
    if (input.canMoveStoredField(node)) {
      const receiver = Node_Expression(ast, node);
      if (receiver !== undefined && movingReads.has(receiver)) movingReads.add(node);
    }
  }
  return { kind: "resolved", flow: Object.freeze({ movingReads, captureTransfers, graphs, liveness: livenessByDeclaration }) };
}

function bindingCanTransfer(binding: Node, callable: Node, input: RustOwnershipFlowInput, awaitedReads: ReadonlySet<Node>,
  nativeNodes: ReadonlySet<Node>): boolean {
  const { ast } = input.source;
  if (sourceEnclosingCallable(binding, ast) !== callable) return false;
  const kind = ast.variableDeclarationKind(binding);
  if (kind === "using" || kind === "await using") return false;
  const summary = input.borrowUses.useSummaryFor(binding);
  if (summary === undefined) return false;
  return !summary.exported && summary.uses.every(use => !nativeNodes.has(use.reference) ||
    use.role !== "value" || awaitedReads.has(use.reference));
}

function hasOverlappingArgumentBorrow(reference: Node, binding: Node, input: RustOwnershipFlowInput,
  nativeNodes: ReadonlySet<Node>): boolean {
  if (input.mayBorrowArgument === undefined) return false;
  const { ast } = input.source;
  const invocations = new Set<Node>();
  for (let parent = ast.parent(reference); parent !== undefined && !isSourceCallableBodyBoundary(ast, parent); parent = ast.parent(parent)) {
    if (ast.is.IsCallExpression(parent) || ast.is.IsNewExpression(parent)) invocations.add(parent);
  }
  if (invocations.size === 0) return false;
  const range = ast.authoredRange(reference);
  if (range.kind !== "authored") return true;
  const summary = input.borrowUses.useSummaryFor(binding);
  if (summary === undefined) return false;
  return summary.uses.some(use => {
    if (!nativeNodes.has(use.reference) || use.kind === "source-linkage" || use.kind === "type-only" || use.reference === reference) return false;
    const other = ast.authoredRange(use.reference);
    if (other.kind !== "authored" || other.end > range.start) return false;
    let argument = use.reference;
    for (let parent = ast.parent(argument); parent !== undefined && !isSourceCallableBodyBoundary(ast, parent); parent = ast.parent(argument)) {
      if (invocations.has(parent)) return input.mayBorrowArgument!(argument, use.reference);
      argument = parent;
    }
    return false;
  });
}

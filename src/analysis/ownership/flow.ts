import type { Node } from "@tsonic/tsts";
import { analyzeSourceLiveness, createSourceControlFlow, type SourceFlowLimits,
  type SourceStorageQueries } from "@tsonic/target-api/analysis";
import { Node_Expression, isSourceCallableBodyBoundary, sourceEnclosingCallable, sourceNodesEqual, sourceParameterIsProperty, sourceTransparentExpressionOperand,
  type TargetSourceProgram } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustClosureCaptureFact } from "../../target-model/records/operation-selections.js";

export interface RustOwnershipFlow {
  readonly movingReads: ReadonlySet<Node>;
  readonly captureTransfers: ReadonlyMap<Node, ReadonlySet<Node>>;
}

export interface RustOwnershipFlowInput {
  readonly source: TargetSourceProgram;
  readonly storage: SourceStorageQueries;
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
  const { ast } = source;
  const movingReads = new Set<Node>();
  const captureTransfers = new Map<Node, ReadonlySet<Node>>();
  for (const declaration of storage.nodes) {
    if (!isSourceCallableBodyBoundary(ast, declaration) || ast.body(declaration) === undefined) continue;
    const selected = createSourceControlFlow(source, declaration, { limits: input.limits });
    const liveness = selected.kind === "resolved" ? analyzeSourceLiveness(selected.graph, input.limits) : selected;
    if (liveness.kind === "unresolved") return { kind: "rejected", diagnostics: [{
      code: "RUST_OWNERSHIP_FLOW_UNRESOLVED", category: "error", source: "tsonic-rust",
      message: liveness.reason, sourceNode: liveness.source ?? declaration,
      evidence: ["target.capability=rust.analysis.ownership"],
    }] };
    if (selected.kind !== "resolved") throw new Error("Resolved ownership liveness requires its source graph.");
    const graph = selected.graph;
    const ownedCaptures = new Set((input.capturesFor(declaration)?.captures ?? [])
      .filter(capture => capture.storage === "value").map(capture => capture.declaration));
    for (const point of graph.points) {
      if (!liveness.reachable.has(point.id) || point.source === undefined) continue;
      if (point.operation.kind === "capture") {
        const capture = input.capturesFor(point.source)?.captures.find(value =>
          sourceNodesEqual(ast, value.declaration, point.operation.kind === "capture" ? point.operation.binding : undefined));
        if (capture === undefined || capture.storage !== "value" ||
          liveness.after.get(point.id)!.has(point.operation.binding) ||
          !bindingCanTransfer(point.operation.binding, declaration, input)) continue;
        const transferred = new Set(captureTransfers.get(point.source));
        transferred.add(capture.declaration);
        captureTransfers.set(point.source, transferred);
      } else if (point.operation.kind === "read" && liveness.lastUses.has(point.source) &&
        !hasOverlappingArgumentBorrow(point.source, point.operation.binding, input) &&
        (bindingCanTransfer(point.operation.binding, declaration, input) ||
          input.isOnceCallable(declaration) && ownedCaptures.has(point.operation.binding))) {
        movingReads.add(point.source);
      }
    }
  }
  for (const node of storage.nodes) {
    if (sourceParameterIsProperty(ast, node)) {
      const summary = source.navigation.declarationUseSummary(node);
      const name = ast.name(node);
      if (name !== undefined && !summary.bindingWritten && summary.uses.every(use =>
        use.kind === "source-linkage" || use.kind === "type-only" || input.isInstanceFieldUse?.(use.reference, node) === true)) {
        movingReads.add(name);
      }
    }
    if (ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node) || input.isOwnedOperationResult(node)) movingReads.add(node);
    if (input.canMoveStoredField(node)) {
      const receiver = Node_Expression(ast, node);
      if (receiver !== undefined && movingReads.has(receiver)) movingReads.add(node);
    }
  }
  for (let index = storage.nodes.length - 1; index >= 0; index -= 1) {
    const node = storage.nodes[index]!;
    const operand = sourceTransparentExpressionOperand(ast, node);
    if (operand !== undefined && movingReads.has(operand)) movingReads.add(node);
  }
  return { kind: "resolved", flow: Object.freeze({ movingReads, captureTransfers }) };
}

function bindingCanTransfer(binding: Node, callable: Node, input: RustOwnershipFlowInput): boolean {
  const { ast, navigation } = input.source;
  if (sourceEnclosingCallable(binding, ast) !== callable) return false;
  const kind = ast.variableDeclarationKind(binding);
  if (kind === "using" || kind === "await using") return false;
  const summary = navigation.declarationUseSummary(binding);
  return !summary.exported && !summary.hasUnclassifiedValueUse;
}

function hasOverlappingArgumentBorrow(reference: Node, binding: Node, input: RustOwnershipFlowInput): boolean {
  if (input.mayBorrowArgument === undefined) return false;
  const { ast, navigation } = input.source;
  const invocations = new Set<Node>();
  for (let parent = ast.parent(reference); parent !== undefined && !isSourceCallableBodyBoundary(ast, parent); parent = ast.parent(parent)) {
    if (ast.is.IsCallExpression(parent) || ast.is.IsNewExpression(parent)) invocations.add(parent);
  }
  if (invocations.size === 0) return false;
  const range = ast.authoredRange(reference);
  if (range.kind !== "authored") return true;
  return navigation.declarationUses(binding).some(use => {
    if (use.kind === "source-linkage" || use.kind === "type-only" || use.reference === reference) return false;
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

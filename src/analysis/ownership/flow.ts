import type { RustOwnershipFlow } from "../../target-model/records/ownership-flow.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { Node } from "@tsonic/tsts";
import { analyzeSourceLiveness, createSourceControlFlow, type SourceControlFlowGraph, type SourceFlowLivenessSelection, type SourceFlowLimits, type SourceStorageQueries } from "@tsonic/target-api/analysis";
import { Node_Expression, isSourceCallableBodyBoundary, sourceEnclosingCallable, sourceExpressionResultDisposition, sourceNodesEqual, sourceParameterIsProperty, sourceTransparentExpressionOperand, type TargetSourceProgram } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustClosureCaptureFact } from "../../target-model/records/operation-selections.js";
import type { RustLexicalFunctionQueries } from "../../target-model/records/lexical-functions.js";

export interface RustOwnershipFlowInput {
  readonly source: TargetSourceProgram;
  readonly storage: SourceStorageQueries;
  readonly nativeNodes: readonly Node[];
  readonly capturesFor: (closure: Node) => RustClosureCaptureFact | undefined;
  readonly isOnceCallable: (closure: Node) => boolean;
  readonly canMoveStoredField: (field: Node) => boolean;
  readonly isOwnedOperationResult: (expression: Node) => boolean;
  readonly mayBorrowArgument?: (argument: Node, reference: Node) => boolean;
  readonly isInstanceFieldUse?: (reference: Node, declaration: Node) => boolean;
  readonly lexicalFunctions?: Pick<RustLexicalFunctionQueries, "forDeclaration" | "calleesFor">;
  readonly limits?: Partial<SourceFlowLimits>;
}

export function analyzeRustOwnershipFlow(input: RustOwnershipFlowInput):
  | { readonly kind: "resolved"; readonly flow: RustOwnershipFlow }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] } {
  const { source, storage } = input;
  if (storage.source !== source) failTargetAnalysisInvariant("tsonic-rust", "Rust ownership and flow require the identical checked source program.");
  const { ast } = source;
  const movingReads = new Set<Node>();
  const captureTransfers = new Map<Node, ReadonlySet<Node>>();
  const regions: { readonly graph: SourceControlFlowGraph;
    readonly liveness: Extract<SourceFlowLivenessSelection, { readonly kind: "resolved" }> }[] = [];
  for (const declaration of input.nativeNodes) {
    if (!isSourceCallableBodyBoundary(ast, declaration) || ast.body(declaration) === undefined) continue;
    const selected = createSourceControlFlow(source, declaration, { domain: { kind: "source" }, limits: input.limits });
    const liveness = selected.kind === "resolved" ? analyzeSourceLiveness(selected.graph, input.limits) : selected;
    if (liveness.kind === "unresolved") return { kind: "rejected", diagnostics: [{
      code: "RUST_OWNERSHIP_FLOW_UNRESOLVED", category: "error", source: "tsonic-rust",
      message: liveness.reason, sourceNode: liveness.source ?? declaration,
      evidence: ["target.capability=rust.analysis.ownership"],
    }] };
    if (selected.kind !== "resolved") failTargetAnalysisInvariant("tsonic-rust", "Resolved ownership liveness requires its source graph.", declaration);
    const graph = selected.graph;
    regions.push(Object.freeze({ graph, liveness }));
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
          !bindingCanTransfer(point.operation.binding, declaration, input, awaitedReads)) continue;
        const transferred = new Set(captureTransfers.get(point.source));
        transferred.add(capture.declaration);
        captureTransfers.set(point.source, transferred);
      } else if (point.operation.kind === "read" && liveness.lastUses.has(point.source) &&
        !isFunctionScopedLoopRead(point.source, point.operation.binding, input) &&
        !hasOverlappingArgumentBorrow(point.source, point.operation.binding, input) &&
        (bindingCanTransfer(point.operation.binding, declaration, input, awaitedReads) ||
          input.isOnceCallable(declaration) && ownedCaptures.has(point.operation.binding))) {
        movingReads.add(point.source);
      }
    }
  }
  if (input.lexicalFunctions !== undefined) transferInvokedLexicalCaptures(input, input.lexicalFunctions, captureTransfers);
  for (const node of input.nativeNodes) {
    if (sourceParameterIsProperty(ast, node)) {
      const summary = source.navigation.declarationUseSummary(node);
      const name = ast.name(node);
      if (name !== undefined && !summary.bindingWritten && summary.uses.every(use =>
        use.kind === "source-linkage" || use.kind === "type-only" || input.isInstanceFieldUse?.(use.reference, node) === true)) {
        movingReads.add(name);
      }
    }
  }
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
  return { kind: "resolved", flow: Object.freeze({ movingReads, captureTransfers, regions: Object.freeze(regions) }) };
}

// A lexical function that is not observed as a value receives its captures as arguments at its invocations. Its
// declaration-site capture point in the enclosing region is therefore not where the binding is consumed. When such a
// function is invoked exactly once, from one once-called lexical invoker that itself received the binding by move, and
// that invoker uses the binding only by making this invocation, the invoker passes its owned capture on by move.
// Chains (outer -> through -> read) close by repeating until no capture gains a transfer.
function transferInvokedLexicalCaptures(
  input: RustOwnershipFlowInput,
  lexical: Pick<RustLexicalFunctionQueries, "forDeclaration" | "calleesFor">,
  captureTransfers: Map<Node, ReadonlySet<Node>>,
): void {
  const { ast, navigation } = input.source;
  const invokers = new Map<Node, Node[]>();
  for (const declaration of input.nativeNodes) {
    for (const callee of lexical.calleesFor(declaration)) {
      const owners = invokers.get(callee) ?? [];
      if (!owners.includes(declaration)) owners.push(declaration);
      invokers.set(callee, owners);
    }
  }
  const capturesBinding = (callable: Node, binding: Node): boolean => (input.capturesFor(callable)?.captures ?? [])
    .some(capture => sourceNodesEqual(ast, capture.declaration, binding));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [callee, owners] of invokers) {
      const selected = lexical.forDeclaration(callee);
      if (selected?.kind !== "resolved" || selected.valueObserved || !selected.singleInvocation || owners.length !== 1) continue;
      const invoker = owners[0]!;
      if (!input.isOnceCallable(invoker)) continue;
      for (const capture of input.capturesFor(callee)?.captures ?? []) {
        const binding = capture.declaration;
        if (capture.storage !== "value" || captureTransfers.get(callee)?.has(binding) === true ||
          captureTransfers.get(invoker)?.has(binding) !== true ||
          !(input.capturesFor(invoker)?.captures ?? []).some(owned => owned.storage === "value" &&
            sourceNodesEqual(ast, owned.declaration, binding)) ||
          navigation.declarationUses(binding).some(use => use.kind !== "source-linkage" && use.kind !== "type-only" &&
            sourceEnclosingCallable(use.reference, ast) === invoker) ||
          lexical.calleesFor(invoker).some(other => other !== callee && capturesBinding(other, binding))) continue;
        captureTransfers.set(callee, new Set([...captureTransfers.get(callee) ?? [], binding]));
        changed = true;
      }
    }
  }
}

function bindingCanTransfer(binding: Node, callable: Node, input: RustOwnershipFlowInput, awaitedReads: ReadonlySet<Node>): boolean {
  const { ast, navigation } = input.source;
  if (sourceEnclosingCallable(binding, ast) !== callable) return false;
  const kind = ast.variableDeclarationKind(binding);
  if (kind === "using" || kind === "await using") return false;
  const summary = navigation.declarationUseSummary(binding);
  return !summary.exported && (!summary.hasUnclassifiedValueUse || summary.uses.every(use => {
    if (use.role !== "value" || awaitedReads.has(use.reference)) return true;
    const disposition = sourceExpressionResultDisposition(ast, use.reference);
    return disposition.kind === "consumed" && ast.is.IsThrowStatement(disposition.use);
  }));
}

// A function-scoped `var` is one storage that stays readable after the loop reading it (RULINGS 2026-10-22), so a
// read inside a loop is never its final use; block-scoped loop bindings are fresh per iteration and may move.
function isFunctionScopedLoopRead(reference: Node, binding: Node, input: RustOwnershipFlowInput): boolean {
  const { ast } = input.source;
  if (!ast.is.IsVariableDeclaration(binding) || ast.variableDeclarationKind(binding) !== "var") return false;
  for (let parent = ast.parent(reference); parent !== undefined && !isSourceCallableBodyBoundary(ast, parent); parent = ast.parent(parent))
    if (ast.is.IsForStatement(parent) || ast.is.IsForOfStatement(parent) || ast.is.IsForInStatement(parent) ||
      ast.is.IsWhileStatement(parent) || ast.is.IsDoStatement(parent)) return true;
  return false;
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

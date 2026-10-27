import type { RustOwnershipFlow } from "../../target-model/records/storage/ownership-flow.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { Node } from "@tsonic/tsts";
import { analyzeSourceLiveness, createSourceControlFlow, type SourceControlFlowGraph, type SourceFlowLivenessSelection, type SourceFlowLimits, type SourceStorageQueries } from "@tsonic/target-api/analysis";
import { Node_Expression, isSourceCallableBodyBoundary, sourceEnclosingCallable, sourceExpressionResultDisposition, sourceNodesEqual, sourceParameterIsProperty, sourceTransparentExpressionOperand, type TargetSourceProgram } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustClosureCaptureFact } from "../../target-model/records/operations/operation-selections.js";
import type { RustLexicalFunctionCapture, RustLexicalFunctionQueries } from "../../target-model/records/callables/lexical-functions.js";
import type { RustReadUse } from "../../target-model/records/storage/ownership.js";

export interface RustOwnershipFlowInput {
  readonly source: TargetSourceProgram;
  readonly storage: SourceStorageQueries;
  readonly nativeNodes: readonly Node[];
  readonly uses: ReadonlyMap<Node, RustReadUse>;
  readonly sourceCallableFor: (invocation: Node) => Node | undefined;
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
  const captureForwarding: { readonly invoker: Node; readonly callee: Node; readonly binding: Node }[] = [];
  const lexicalReadMoves: { readonly callable: Node; readonly binding: Node; readonly reference: Node }[] = [];
  const capturedStorageBindings = new Set<Node>();
  for (const declaration of input.nativeNodes) {
    if (!isSourceCallableBodyBoundary(ast, declaration) || ast.body(declaration) === undefined) continue;
    for (const capture of input.capturesFor(declaration)?.captures ?? []) {
      if (capture.storage !== "value") capturedStorageBindings.add(capture.declaration);
    }
  }
  const regions: { readonly graph: SourceControlFlowGraph;
    readonly liveness: Extract<SourceFlowLivenessSelection, { readonly kind: "resolved" }> }[] = [];
  for (const declaration of input.nativeNodes) {
    if (!isSourceCallableBodyBoundary(ast, declaration) || ast.body(declaration) === undefined) continue;
    const selected = createSourceControlFlow(source, declaration, { domain: { kind: "source" }, limits: input.limits });
    const additionalReads = new Map<number, readonly Node[]>();
    const nativeInvocations = new Map<number, { readonly declaration: Node;
      readonly captures: readonly RustLexicalFunctionCapture[]; readonly singleInvocation: boolean }>();
    if (selected.kind === "resolved") for (const point of selected.graph.points) {
      if (point.operation.kind !== "evaluate" || point.source === undefined || !ast.is.IsCallExpression(point.source)) continue;
      const callee = input.sourceCallableFor(point.source);
      const lexical = callee === undefined ? undefined : input.lexicalFunctions?.forDeclaration(callee);
      if (lexical?.kind === "unresolved") return { kind: "rejected", diagnostics: [{
        code: "RUST_OWNERSHIP_FLOW_UNRESOLVED", category: "error", source: "tsonic-rust",
        message: lexical.reason, sourceNode: point.source, evidence: ["target.capability=rust.analysis.ownership"],
      }] };
      if (callee === undefined || lexical?.kind !== "resolved" || lexical.valueObserved) continue;
      additionalReads.set(point.id, Object.freeze(lexical.captures.map(capture => capture.declaration)));
      nativeInvocations.set(point.id, { declaration: callee, captures: lexical.captures, singleInvocation: lexical.singleInvocation });
    }
    const liveness = selected.kind === "resolved" ? analyzeSourceLiveness(selected.graph, additionalReads, input.limits) : selected;
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
    const lexicalOwner = input.lexicalFunctions?.forDeclaration(declaration);
    const ownedCaptures = new Set((input.capturesFor(declaration)?.captures ?? [])
      .filter(capture => capture.storage === "value" && !(lexicalOwner?.kind === "resolved" && !lexicalOwner.valueObserved &&
        lexicalOwner.captures.some(selected => selected.mutable && sourceNodesEqual(ast, selected.declaration, capture.declaration))))
      .map(capture => capture.declaration));
    for (const point of graph.points) {
      if (!liveness.reachable.has(point.id) || point.source === undefined) continue;
      const invocation = nativeInvocations.get(point.id);
      if (invocation?.singleInvocation) for (const capture of invocation.captures) {
        const binding = capture.declaration;
        if (capture.mutable || input.capturesFor(invocation.declaration)?.captures.some(selected =>
          selected.storage === "value" && sourceNodesEqual(ast, selected.declaration, binding)) !== true ||
          liveness.after.get(point.id)!.has(binding) || invocationBorrowsBinding(point.source, binding, input)) continue;
        if (bindingCanTransfer(binding, declaration, input, awaitedReads, capturedStorageBindings)) {
          captureTransfers.set(invocation.declaration, new Set([...captureTransfers.get(invocation.declaration) ?? [], binding]));
        } else if (input.isOnceCallable(declaration) && ownedCaptures.has(binding)) {
          captureForwarding.push({ invoker: declaration, callee: invocation.declaration, binding });
        }
      }
      if (point.operation.kind === "capture") {
        const lexical = input.lexicalFunctions?.forDeclaration(point.source);
        if (lexical?.kind === "resolved" && !lexical.valueObserved) continue;
        const capture = input.capturesFor(point.source)?.captures.find(value =>
          sourceNodesEqual(ast, value.declaration, point.operation.kind === "capture" ? point.operation.binding : undefined));
        if (capture === undefined || capture.storage !== "value" ||
          liveness.after.get(point.id)!.has(point.operation.binding) ||
          hasOverlappingArgumentBorrow(point.source, point.operation.binding, input) ||
          !bindingCanTransfer(point.operation.binding, declaration, input, awaitedReads, capturedStorageBindings)) continue;
        const transferred = new Set(captureTransfers.get(point.source));
        transferred.add(capture.declaration);
        captureTransfers.set(point.source, transferred);
      } else if (point.operation.kind === "read" && liveness.lastUses.has(point.source) &&
        !isFunctionScopedLoopRead(point.source, point.operation.binding, input) &&
        !hasOverlappingArgumentBorrow(point.source, point.operation.binding, input)) {
        if (bindingCanTransfer(point.operation.binding, declaration, input, awaitedReads, capturedStorageBindings)) {
          movingReads.add(point.source);
        } else if (input.isOnceCallable(declaration) && ownedCaptures.has(point.operation.binding)) {
          if (lexicalOwner?.kind === "resolved" && !lexicalOwner.valueObserved) {
            lexicalReadMoves.push({ callable: declaration, binding: point.operation.binding, reference: point.source });
          } else movingReads.add(point.source);
        }
      }
    }
  }
  transferInvokedLexicalCaptures(captureForwarding, captureTransfers);
  for (const read of lexicalReadMoves) {
    if (captureTransfers.get(read.callable)?.has(read.binding) === true) movingReads.add(read.reference);
  }
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

function transferInvokedLexicalCaptures(
  forwarding: readonly { readonly invoker: Node; readonly callee: Node; readonly binding: Node }[],
  captureTransfers: Map<Node, ReadonlySet<Node>>,
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const { invoker, callee, binding } of forwarding) {
      if (captureTransfers.get(invoker)?.has(binding) !== true || captureTransfers.get(callee)?.has(binding) === true) continue;
      captureTransfers.set(callee, new Set([...captureTransfers.get(callee) ?? [], binding]));
      changed = true;
    }
  }
}

function invocationBorrowsBinding(invocation: Node, binding: Node, input: RustOwnershipFlowInput): boolean {
  if (input.mayBorrowArgument === undefined) return false;
  const { ast, navigation } = input.source;
  const arguments_ = new Set(ast.arguments(invocation));
  return navigation.declarationUses(binding).some(use => {
    if (use.kind === "source-linkage" || use.kind === "type-only") return false;
    for (let node: Node | undefined = use.reference; node !== undefined && !isSourceCallableBodyBoundary(ast, node); node = ast.parent(node)) {
      if (arguments_.has(node)) return input.mayBorrowArgument!(node, use.reference);
      if (node === invocation) return false;
    }
    return false;
  });
}

function bindingCanTransfer(binding: Node, callable: Node, input: RustOwnershipFlowInput,
  awaitedReads: ReadonlySet<Node>, capturedStorageBindings: ReadonlySet<Node>): boolean {
  const { ast, navigation } = input.source;
  if (sourceEnclosingCallable(binding, ast) !== callable || capturedStorageBindings.has(binding)) return false;
  const kind = ast.variableDeclarationKind(binding);
  if (kind === "using" || kind === "await using") return false;
  const summary = navigation.declarationUseSummary(binding);
  return !summary.exported && (!(summary.hasUnclassifiedValueUse || summary.captured) || summary.uses.every(use => {
    if (use.kind === "source-linkage" || use.kind === "type-only") return true;
    const owner = sourceEnclosingCallable(use.reference, ast);
    if (owner !== undefined && owner !== callable) return input.capturesFor(owner)?.captures.some(capture =>
      capture.storage === "value" && sourceNodesEqual(ast, capture.declaration, binding)) === true;
    if (use.role !== "value" || awaitedReads.has(use.reference) || input.uses.has(use.reference)) return true;
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
      if (invocations.has(parent)) {
        let operand: Node | undefined = argument;
        if (argument === Node_Expression(ast, parent)) {
          for (let transparent = sourceTransparentExpressionOperand(ast, operand); transparent !== undefined;
            transparent = sourceTransparentExpressionOperand(ast, operand)) operand = transparent;
          operand = Node_Expression(ast, operand);
        }
        if (operand !== undefined) {
          for (let transparent = sourceTransparentExpressionOperand(ast, operand); transparent !== undefined;
            transparent = sourceTransparentExpressionOperand(ast, operand)) operand = transparent;
        }
        const selected = operand === use.reference ? input.uses.get(use.reference)?.mode : undefined;
        return selected === "shared" || selected === "mutable" || input.mayBorrowArgument?.(argument, use.reference) === true;
      }
      argument = parent;
    }
    return false;
  });
}

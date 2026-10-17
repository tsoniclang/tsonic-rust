import type { Node } from "@tsonic/tsts";
import { analyzeSourceLiveness, createSourceControlFlow, createSourceControlFlowDomain, solveSourceFlow, type SourceFlowLimits,
  type SourceControlFlowGraph, type SourceFlowLivenessSelection, type SourceStorageQueries } from "@tsonic/target-api/analysis";
import { Node_Expression, isSourceCallableBodyBoundary, sourceEnclosingCallable, sourceExpressionResultDisposition, sourceNodesEqual, sourceParameterIsProperty, sourceTransparentExpressionOperand,
  type TargetSourceProgram } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustClosureCaptureFact } from "../../target-model/records/operation-selections.js";
import type { RustBorrowUseAnalysis } from "./effects.js";
import { rustCaptureReadFormation, type RustCaptureReadRequirement, type RustCaptureReadRequirements } from "./reads.js";
import type { RustCaptureReadOwnership } from "../../target-model/records/ownership.js";

export interface RustNativeCaptureDependency {
  readonly owner: Node;
  readonly declaration: Node;
  readonly requirement: RustCaptureReadRequirement | undefined;
}

export interface RustReadTransferRequirement {
  readonly node: Node;
  readonly dependencies: readonly RustNativeCaptureDependency[];
}

export interface RustOwnershipFlow {
  readonly readTransfers: ReadonlyMap<Node, RustReadTransferRequirement>;
  readonly captureRequirements: RustCaptureReadRequirements;
  readonly captureTransfers: ReadonlyMap<Node, ReadonlySet<Node>>;
  readonly graphs: ReadonlyMap<Node, SourceControlFlowGraph>;
  readonly liveness: ReadonlyMap<Node, Extract<SourceFlowLivenessSelection, { readonly kind: "resolved" }>>;
}

export interface RustOwnershipFlowInput {
  readonly source: TargetSourceProgram;
  readonly storage: SourceStorageQueries;
  readonly nativeNodes: readonly Node[];
  readonly borrowUses: RustBorrowUseAnalysis;
  readonly captureRequirements: RustCaptureReadRequirements;
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
  const readTransfers = new Map<Node, RustReadTransferRequirement>();
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
    const nativeDependencies = analyzeCaptureDependencies(graph, input, nativeNodes);
    if (nativeDependencies.kind === "unresolved") return { kind: "rejected", diagnostics: [{
      code: "RUST_OWNERSHIP_FLOW_UNRESOLVED", category: "error", source: "tsonic-rust",
      message: nativeDependencies.reason, sourceNode: nativeDependencies.source ?? declaration,
      evidence: ["target.capability=rust.analysis.ownership"],
    }] };
    for (const point of graph.points) {
      if (!liveness.reachable.has(point.id) || point.source === undefined) continue;
      if (point.operation.kind === "capture") {
        const binding = point.operation.binding;
        const capture = input.capturesFor(point.source)?.captures.find(value =>
          sourceNodesEqual(ast, value.declaration, point.operation.kind === "capture" ? point.operation.binding : undefined));
        if (capture === undefined || capture.storage !== "value" ||
          liveness.after.get(point.id)!.has(point.operation.binding) ||
          !bindingCanTransfer(point.operation.binding, declaration, input, awaitedReads, nativeNodes)) continue;
        const dependencies = [...nativeDependencies.after.get(point.id)!].filter(value =>
          value.declaration === binding && value.owner !== point.source);
        if (dependencies.some(value => !independentCaptureFormation(value, captureTransfers))) continue;
        const transferred = new Set(captureTransfers.get(point.source));
        transferred.add(capture.declaration);
        captureTransfers.set(point.source, transferred);
      } else if (point.operation.kind === "read" && liveness.lastUses.has(point.source) &&
        !hasOverlappingArgumentBorrow(point.source, point.operation.binding, input, nativeNodes) &&
        (bindingCanTransfer(point.operation.binding, declaration, input, awaitedReads, nativeNodes) ||
          input.isOnceCallable(declaration) && ownedCaptures.has(point.operation.binding))) {
        const binding = point.operation.binding;
        const dependencies = [...nativeDependencies.after.get(point.id)!].filter(value => value.declaration === binding);
        if (sourceEnclosingCallable(binding, ast) !== declaration && ownedCaptures.has(binding)) {
          dependencies.push(Object.freeze({ owner: declaration, declaration: binding,
            requirement: input.captureRequirements.get(declaration)?.find(value => value.capture.declaration === binding) }));
        }
        const previous = readTransfers.get(point.source);
        readTransfers.set(point.source, Object.freeze({ node: point.source,
          dependencies: Object.freeze([...new Set([...(previous?.dependencies ?? []), ...dependencies])]) }));
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
        readTransfers.set(name, Object.freeze({ node: name, dependencies: Object.freeze([]) }));
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
    if (ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node) || input.isOwnedOperationResult(node))
      readTransfers.set(node, Object.freeze({ node, dependencies: Object.freeze([]) }));
    const operand = sourceTransparentExpressionOperand(ast, node);
    const inherited = operand === undefined ? undefined : readTransfers.get(operand);
    if (inherited !== undefined) readTransfers.set(node, Object.freeze({ node, dependencies: inherited.dependencies }));
    if (input.canMoveStoredField(node)) {
      const receiver = Node_Expression(ast, node);
      const transferred = receiver === undefined ? undefined : readTransfers.get(receiver);
      if (transferred !== undefined) readTransfers.set(node, Object.freeze({ node, dependencies: transferred.dependencies }));
    }
  }
  return { kind: "resolved", flow: Object.freeze({ readTransfers, captureRequirements: input.captureRequirements,
    captureTransfers, graphs, liveness: livenessByDeclaration }) };
}

export function rustReadTransferRequirement(flow: RustOwnershipFlow, node: Node): "transfer" | "snapshot" | "unavailable" {
  const candidate = flow.readTransfers.get(node);
  if (candidate === undefined) return "snapshot";
  if (candidate.dependencies.some(dependency => dependency.requirement === undefined)) return "unavailable";
  return candidate.dependencies.every(dependency => independentCaptureFormation(dependency, flow.captureTransfers))
    ? "transfer" : "snapshot";
}

export function completeRustNativeReadTransfers(flow: RustOwnershipFlow,
  captures: ReadonlyMap<Node, readonly RustCaptureReadOwnership[]>): ReadonlySet<Node> {
  const movingReads = new Set<Node>();
  for (const [node, candidate] of flow.readTransfers) {
    if (candidate.dependencies.every(dependency => {
      const requirement = dependency.requirement;
      if (requirement === undefined || requirement.aliasesBinding) return false;
      const capture = captures.get(dependency.owner)?.find(value => value.declaration === dependency.declaration);
      return capture !== undefined && capture.reference === requirement.capture.reference &&
        capture.source === requirement.source && capture.carrier === requirement.physical.carrier && capture.read.kind !== "borrow";
    })) movingReads.add(node);
  }
  return movingReads;
}

function independentCaptureFormation(dependency: RustNativeCaptureDependency,
  transfers: ReadonlyMap<Node, ReadonlySet<Node>>): boolean {
  const requirement = dependency.requirement;
  return requirement !== undefined && !requirement.aliasesBinding && rustCaptureReadFormation(requirement, transfers).owned;
}

function analyzeCaptureDependencies(graph: SourceControlFlowGraph, input: RustOwnershipFlowInput,
  nativeNodes: ReadonlySet<Node>) {
  type State = ReadonlySet<RustNativeCaptureDependency>;
  const dependencies = new Map<Node, Map<Node, RustNativeCaptureDependency>>();
  for (const point of graph.points) {
    if (point.operation.kind !== "capture" || point.source === undefined) continue;
    const rows = dependencies.get(point.source) ?? new Map<Node, RustNativeCaptureDependency>();
    if (!rows.has(point.operation.binding)) rows.set(point.operation.binding, Object.freeze({ owner: point.source,
      declaration: point.operation.binding, requirement: input.captureRequirements.get(point.source)?.find(value =>
        sourceNodesEqual(input.source.ast, value.capture.declaration, point.operation.kind === "capture" ? point.operation.binding : undefined)) }));
    dependencies.set(point.source, rows);
  }
  const uses = new Map<number, Set<RustNativeCaptureDependency>>();
  const boundary = new Set<RustNativeCaptureDependency>();
  for (const [owner, rows] of dependencies) {
    const aliases = input.source.navigation.expressionValueFlow(owner);
    const summary = input.source.ast.is.IsFunctionDeclaration(owner) ? input.borrowUses.useSummaryFor(owner) : undefined;
    const selectedUses = [...aliases.uses, ...(summary?.uses ?? [])];
    if (!input.borrowUses.reserve(selectedUses.length + rows.size)) break;
    for (const use of selectedUses) {
      if (!nativeNodes.has(use.reference) || use.kind === "type-only" || use.kind === "source-linkage") continue;
      for (const id of graph.sourcePoints.get(use.reference) ?? []) {
        const selected = uses.get(id) ?? new Set<RustNativeCaptureDependency>();
        for (const dependency of rows.values()) selected.add(dependency);
        uses.set(id, selected);
      }
      if (use.role === "return" || use.role === "yield" || use.role === "storage" && use.throughMember)
        for (const dependency of rows.values()) boundary.add(dependency);
    }
  }
  return solveSourceFlow<State>(graph, {
    direction: "backward",
    boundary: new Map([[graph.exit, boundary], [graph.exceptionExit, boundary]]),
    lattice: {
      empty: () => new Set<RustNativeCaptureDependency>(),
      join(left, right, work) {
        if (left === right || right.size === 0) return left;
        const selected = new Set(left);
        for (const dependency of right) { work.step(); selected.add(dependency); }
        return selected;
      },
      equals(left, right, work) {
        if (left === right) return true;
        if (left.size !== right.size) return false;
        for (const dependency of left) { work.step(); if (!right.has(dependency)) return false; }
        return true;
      },
    },
    transfer(point, later, work) {
      const selected = new Set(later);
      for (const dependency of uses.get(point.id) ?? []) { work.step(); selected.add(dependency); }
      if (point.operation.kind === "capture") for (const dependency of selected) {
        work.step();
        if (dependency.owner === point.source) selected.delete(dependency);
      }
      return selected;
    },
  }, input.limits);
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

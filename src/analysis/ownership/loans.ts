import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  Node_Expression,
  Node_Initializer,
} from "@tsonic/target-api/source";
import type {
  RustLoan,
  RustOwnershipOperation,
  RustRegionRef,
  RustValueReadDisposition,
} from "../../target-model/semantics/index.js";
import type { RustSourceFlowGraph, RustSourceFlowPoint } from "./control-flow.js";
import type { RustOwnershipAnalysisInput } from "./context.js";
import { rustOwnershipDiagnostic } from "./diagnostics.js";
import type { RustOwnershipNodeInventory } from "./inventory.js";
import type {
  RustOwnershipOperationInventory,
  RustOwnershipOperationRecord,
} from "./operations.js";
import { rustPlacesOverlap } from "./places.js";
import { rustSourceValueContractForDeclaration } from "./source-values.js";

interface RustLoanRecord {
  readonly loan: RustLoan;
  readonly source: RustOwnershipOperationRecord;
  readonly livePointIndexes: ReadonlySet<number>;
  readonly activationPointIndex: number;
}

export interface RustLoanAnalysis {
  readonly loans: readonly RustLoan[];
  readonly loansByNode: WeakMap<Node, readonly RustLoan[]>;
}

export function analyzeRustLoans(
  flow: RustSourceFlowGraph,
  inventory: RustOwnershipNodeInventory,
  operations: RustOwnershipOperationInventory,
  reads: WeakMap<Node, RustValueReadDisposition>,
  input: RustOwnershipAnalysisInput,
  diagnostics: TargetDiagnostic[],
): RustLoanAnalysis {
  const pointIndexById = new Map(flow.points.map((point) => [point.id, point.index]));
  const records = operations.records.flatMap((record): readonly RustLoanRecord[] => {
    const operation = record.operation;
    if (operation.kind !== "shared-borrow" && operation.kind !== "mutable-borrow" &&
      operation.kind !== "reborrow") return [];
    const reservation = flow.pointFor(record.node);
    if (reservation === undefined) return [];
    const mutable = operation.kind === "mutable-borrow" ||
      operation.kind === "reborrow" && operation.mutable;
    const completionNodes = loanCompletionNodes(record, input);
    const completions = completionNodes.map((node) => flow.pointFor(node)).filter(
      (point): point is RustSourceFlowPoint => point !== undefined &&
        point.regionId === reservation.regionId &&
        (point.index === reservation.index || flow.reaches(reservation, point)),
    );
    const twoPhase = mutable && record.origin === "selected-operation" &&
      selectedAsReceiver(record, input);
    const activation = twoPhase
      ? flow.pointFor(record.completionNode) ?? reservation
      : reservation;
    const livePoints = completions.length === 0
      ? [reservation]
      : flow.pointsOnPaths(reservation, completions);
    const livePointIds = Object.freeze(
      [...new Set([reservation, ...livePoints, ...completions].map((point) => point.index))]
        .sort((left, right) => left - right)
        .map((index) => flow.points[index]!.id),
    );
    const reservationRegion = loanRegion(operation.loanId, reservation.regionId, "reservation");
    const liveRegion = loanRegion(operation.loanId, reservation.regionId, "live");
    const loan = Object.freeze({
      id: operation.loanId,
      kind: mutable ? "mutable" as const : "shared" as const,
      place: operation.place,
      reservationRegion,
      ...(twoPhase
        ? { activationRegion: loanRegion(operation.loanId, reservation.regionId, "activation") }
        : {}),
      liveRegion,
      reservationPointId: reservation.id,
      activationPointId: activation.id,
      livePointIds,
      twoPhase,
    });
    return [Object.freeze({
      loan,
      source: record,
      livePointIndexes: new Set(livePointIds.map((id) => pointIndexById.get(id)!)),
      activationPointIndex: activation.index,
    })];
  });
  validateLoanPairs(records, flow, diagnostics);
  validateOperationsAgainstLoans(records, operations, flow, input, diagnostics);
  validateDirectPlaceUses(records, inventory, reads, flow, diagnostics);
  validateLoansAcrossSuspension(records, inventory, flow, input, diagnostics);
  const loansByNode = new WeakMap<Node, readonly RustLoan[]>();
  for (const point of flow.points) {
    if (point.node === undefined) continue;
    const selected = records.filter((record) => record.livePointIndexes.has(point.index)).map(
      (record) => record.loan,
    );
    if (selected.length > 0) loansByNode.set(point.node, Object.freeze(selected));
  }
  return Object.freeze({
    loans: Object.freeze(records.map((record) => record.loan)),
    loansByNode,
  });
}

function validateLoansAcrossSuspension(
  loans: readonly RustLoanRecord[],
  inventory: RustOwnershipNodeInventory,
  flow: RustSourceFlowGraph,
  input: RustOwnershipAnalysisInput,
  diagnostics: TargetDiagnostic[],
): void {
  const reported = new Set<string>();
  for (const loan of loans) {
    const rootDeclaration = inventory.declarationByRoot.get(loan.loan.place.rootId);
    if (rootDeclaration === undefined) continue;
    for (const pointIndex of loan.livePointIndexes) {
      const point = flow.points[pointIndex];
      if (point?.node === undefined ||
        (input.ast.kindName(point.node) !== "KindAwaitExpression" &&
          input.ast.kindName(point.node) !== "KindYieldExpression")) continue;
      const callable = enclosingCallable(point.node, input);
      if (callable === undefined || !nodeContains(callable, rootDeclaration, input)) continue;
      const contract = rustSourceValueContractForDeclaration(rootDeclaration, input);
      const borrowedParameter = input.ast.kindName(rootDeclaration) === "KindParameter" &&
        contract.kind === "resolved" &&
        (contract.value?.kind === "shared-reference" ||
          contract.value?.kind === "mutable-reference") &&
        loan.loan.place.projections.some((projection) => projection.kind === "dereference");
      if (borrowedParameter) continue;
      const key = `${loan.loan.id}\0${point.id}`;
      if (reported.has(key)) continue;
      reported.add(key);
      diagnostics.push(rustOwnershipDiagnostic(
        "RUST_SELF_REFERENTIAL_LOAN_ACROSS_SUSPENSION",
        "A loan of callable-owned storage cannot cross await or yield because that would require a self-referential Rust future or generator.",
        loan.source.node,
      ));
    }
  }
}

function loanCompletionNodes(
  record: RustOwnershipOperationRecord,
  input: RustOwnershipAnalysisInput,
): readonly Node[] {
  if (record.origin === "selected-operation") return Object.freeze([record.completionNode]);
  const declaration = declarationInitializedBy(record.node, input);
  if (declaration !== undefined) {
    const uses = input.navigation.declarationUses(declaration).filter((use) =>
      use.kind !== "source-linkage" && use.kind !== "type-only").map((use) => use.reference);
    return Object.freeze(uses.length === 0 ? [record.completionNode] : uses);
  }
  const parentCall = enclosingCall(record.node, input);
  return Object.freeze([parentCall ?? enclosingEvaluation(record.node, input) ?? record.completionNode]);
}

function declarationInitializedBy(
  node: Node,
  input: RustOwnershipAnalysisInput,
): Node | undefined {
  let current = node;
  for (;;) {
    const parent = input.ast.parent(current);
    if (parent === undefined || isCallable(parent, input)) return undefined;
    const kind = input.ast.kindName(parent);
    if (kind === "KindVariableDeclaration" || kind === "KindBindingElement") {
      return Node_Initializer(input.ast, parent) !== undefined ? parent : undefined;
    }
    if (!isTransparent(kind)) return undefined;
    current = parent;
  }
}

function selectedAsReceiver(
  record: RustOwnershipOperationRecord,
  input: RustOwnershipAnalysisInput,
): boolean {
  const completionKind = input.ast.kindName(record.completionNode);
  if (completionKind !== "KindCallExpression" && completionKind !== "KindPropertyAccessExpression" &&
    completionKind !== "KindElementAccessExpression") return false;
  const calleeOrReceiver = Node_Expression(input.ast, record.completionNode);
  if (calleeOrReceiver === undefined) return false;
  const receiver = completionKind === "KindCallExpression" &&
      (input.ast.kindName(calleeOrReceiver) === "KindPropertyAccessExpression" ||
        input.ast.kindName(calleeOrReceiver) === "KindElementAccessExpression")
    ? Node_Expression(input.ast, calleeOrReceiver)
    : calleeOrReceiver;
  return receiver !== undefined && nodeContains(receiver, record.sourceValue, input);
}

function validateLoanPairs(
  records: readonly RustLoanRecord[],
  flow: RustSourceFlowGraph,
  diagnostics: TargetDiagnostic[],
): void {
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    const left = records[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const right = records[rightIndex]!;
      if (!rustPlacesOverlap(left.loan.place, right.loan.place)) continue;
      const common = [...left.livePointIndexes].filter((point) => right.livePointIndexes.has(point));
      const conflict = common.find((point) =>
        effectiveLoanKind(left, point, flow) === "mutable" ||
        effectiveLoanKind(right, point, flow) === "mutable");
      if (conflict === undefined) continue;
      diagnostics.push(rustOwnershipDiagnostic(
        "RUST_OVERLAPPING_LOANS",
        `Overlapping ${left.loan.kind} and ${right.loan.kind} loans require incompatible access to the same Rust place.`,
        right.source.node,
      ));
    }
  }
}

function validateOperationsAgainstLoans(
  loans: readonly RustLoanRecord[],
  operations: RustOwnershipOperationInventory,
  flow: RustSourceFlowGraph,
  input: RustOwnershipAnalysisInput,
  diagnostics: TargetDiagnostic[],
): void {
  const reported = new Set<string>();
  for (const operation of operations.records) {
    const point = flow.pointFor(operation.node);
    if (point === undefined || isBorrowOperation(operation.operation)) continue;
    for (const loan of loans) {
      if (!loan.livePointIndexes.has(point.index) ||
        !rustPlacesOverlap(operation.operation.place, loan.loan.place)) continue;
      if (operationUsesExactLoan(operation, loan, input)) continue;
      const loanKind = effectiveLoanKind(loan, point.index, flow);
      const conflict = loanKind === "mutable" || operationMutates(operation.operation);
      if (!conflict) continue;
      const key = `${loan.loan.id}\0${point.id}\0${operation.operation.kind}`;
      if (reported.has(key)) continue;
      reported.add(key);
      diagnostics.push(rustOwnershipDiagnostic(
        "RUST_OPERATION_CONFLICTS_WITH_LIVE_LOAN",
        `Rust '${operation.operation.kind}' conflicts with a live ${loanKind} loan of the same place.`,
        operation.node,
      ));
    }
  }
}

function operationUsesExactLoan(
  operation: RustOwnershipOperationRecord,
  loan: RustLoanRecord,
  input: RustOwnershipAnalysisInput,
): boolean {
  if (operation.operation.kind !== "load" && operation.operation.kind !== "store" &&
    operation.operation.kind !== "replace" && operation.operation.kind !== "take") {
    return false;
  }
  if (operation.sourceValue === loan.source.node) {
    return true;
  }
  const loanBinding = declarationInitializedBy(loan.source.node, input);
  const operationBinding = input.navigation.sourceReferenceFor(operation.sourceValue)?.declaration;
  return loanBinding !== undefined && operationBinding === loanBinding;
}

function validateDirectPlaceUses(
  loans: readonly RustLoanRecord[],
  inventory: RustOwnershipNodeInventory,
  reads: WeakMap<Node, RustValueReadDisposition>,
  flow: RustSourceFlowGraph,
  diagnostics: TargetDiagnostic[],
): void {
  const reported = new Set<string>();
  for (const node of inventory.nodes) {
    if (reads.get(node) === undefined) continue;
    const point = flow.pointFor(node);
    const place = inventory.places.get(node);
    if (point === undefined || place === undefined) continue;
    for (const loan of loans) {
      if (!loan.livePointIndexes.has(point.index) ||
        effectiveLoanKind(loan, point.index, flow) !== "mutable" ||
        !rustPlacesOverlap(place, loan.loan.place) ||
        node === loan.source.sourceValue || node === loan.source.node) continue;
      const key = `${loan.loan.id}\0${point.id}`;
      if (reported.has(key)) continue;
      reported.add(key);
      diagnostics.push(rustOwnershipDiagnostic(
        "RUST_DIRECT_USE_CONFLICTS_WITH_MUTABLE_LOAN",
        "A direct use of a Rust place overlaps an active mutable loan.",
        node,
      ));
    }
  }
}

function effectiveLoanKind(
  record: RustLoanRecord,
  point: number,
  flow: RustSourceFlowGraph,
): "shared" | "mutable" {
  if (record.loan.kind === "shared" || !record.loan.twoPhase) return record.loan.kind;
  if (point === record.activationPointIndex) return "mutable";
  const activation = flow.points[record.activationPointIndex]!;
  const selected = flow.points[point]!;
  return flow.reaches(activation, selected) ? "mutable" : "shared";
}

function loanRegion(loanId: string, parentId: string, phase: string): RustRegionRef {
  return Object.freeze({ id: `${loanId}\0${phase}`, kind: "flow", parentId });
}

function isBorrowOperation(operation: RustOwnershipOperation): boolean {
  return operation.kind === "shared-borrow" || operation.kind === "mutable-borrow" ||
    operation.kind === "reborrow";
}

function operationMutates(operation: RustOwnershipOperation): boolean {
  return operation.kind === "move" || operation.kind === "mutable-borrow" ||
    operation.kind === "reborrow" && operation.mutable || operation.kind === "store" ||
    operation.kind === "replace" || operation.kind === "take";
}

function enclosingCall(node: Node, input: RustOwnershipAnalysisInput): Node | undefined {
  let current = node;
  for (;;) {
    const parent = input.ast.parent(current);
    if (parent === undefined || isCallable(parent, input)) return undefined;
    const kind = input.ast.kindName(parent);
    if (kind === "KindCallExpression" || kind === "KindNewExpression") return parent;
    current = parent;
  }
}

function enclosingEvaluation(node: Node, input: RustOwnershipAnalysisInput): Node | undefined {
  let current = node;
  for (;;) {
    const parent = input.ast.parent(current);
    if (parent === undefined || isCallable(parent, input)) return current;
    if (input.ast.kindName(parent).endsWith("Statement")) return parent;
    current = parent;
  }
}

function isCallable(node: Node, input: RustOwnershipAnalysisInput): boolean {
  const kind = input.ast.kindName(node);
  return kind === "KindFunctionDeclaration" || kind === "KindFunctionExpression" ||
    kind === "KindArrowFunction" || kind === "KindMethodDeclaration" ||
    kind === "KindConstructor" || kind === "KindGetAccessor" || kind === "KindSetAccessor";
}

function enclosingCallable(
  node: Node,
  input: RustOwnershipAnalysisInput,
): Node | undefined {
  let current = input.ast.parent(node);
  while (current !== undefined) {
    if (isCallable(current, input)) return current;
    current = input.ast.parent(current);
  }
  return undefined;
}

function isTransparent(kind: string): boolean {
  return kind === "KindParenthesizedExpression" || kind === "KindAsExpression" ||
    kind === "KindSatisfiesExpression" || kind === "KindNonNullExpression" ||
    kind === "KindTypeAssertionExpression";
}

function nodeContains(root: Node, selected: Node, input: RustOwnershipAnalysisInput): boolean {
  if (root === selected) return true;
  let found = false;
  input.ast.forEachChild(root, (child) => {
    if (!found && child !== undefined && nodeContains(child, selected, input)) found = true;
  });
  return found;
}

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
import type { RustSourceFlowGraph } from "./control-flow.js";
import type { RustOwnershipAnalysisInput } from "./context.js";
import {
  maximumLoanOperationComparisons,
  maximumLoanPairComparisons,
  maximumLoanPointComparisons,
  maximumLoanReadComparisons,
  maximumLoans,
  rustLoanLivenessComplexityDiagnostic,
  rustLoanOperationComplexityDiagnostic,
  rustLoanPairComplexityDiagnostic,
  rustLoanPointComplexityDiagnostic,
  rustLoanReadComplexityDiagnostic,
} from "./complexity.js";
import { rustOwnershipDiagnostic } from "./diagnostics.js";
import type { RustOwnershipNodeInventory } from "./inventory.js";
import type {
  RustOwnershipOperationInventory,
  RustOwnershipOperationRecord,
} from "./operations.js";
import {
  rustOwnershipOperationCompletionFlowPoints,
  rustOwnershipOperationFlowPoints,
} from "./operations.js";
import { rustPlacesOverlap } from "./places.js";
import { rustSourceValueContractForDeclaration } from "./source-values.js";

interface RustLoanRecord {
  readonly index: number;
  readonly loan: RustLoan;
  readonly source: RustOwnershipOperationRecord;
  readonly livePointIndexes: ReadonlySet<number>;
  readonly activationPointIndex: number;
}

export interface RustLoanAnalysis {
  readonly loans: readonly RustLoan[];
  readonly loansByNode: WeakMap<Node, readonly RustLoan[]>;
}

export type AnalyzeRustLoansResult =
  | { readonly kind: "resolved"; readonly analysis: RustLoanAnalysis }
  | { readonly kind: "rejected"; readonly diagnostic: TargetDiagnostic };

export function analyzeRustLoans(
  flow: RustSourceFlowGraph,
  inventory: RustOwnershipNodeInventory,
  operations: RustOwnershipOperationInventory,
  reads: WeakMap<Node, RustValueReadDisposition>,
  input: RustOwnershipAnalysisInput,
  diagnostics: TargetDiagnostic[],
): AnalyzeRustLoansResult {
  const pointIndexById = new Map(flow.points.map((point) => [point.id, point.index]));
  const records: RustLoanRecord[] = [];
  let livePointMembershipCount = 0;
  for (const record of operations.records) {
    const operation = record.operation;
    if (operation.kind !== "shared-borrow" && operation.kind !== "mutable-borrow" &&
      operation.kind !== "reborrow") continue;
    const mutable = operation.kind === "mutable-borrow" ||
      operation.kind === "reborrow" && operation.mutable;
    const completionNodes = record.flowPointIndex === undefined
      ? loanCompletionNodes(record, input)
      : Object.freeze([]);
    const twoPhase = mutable && record.origin === "selected-operation" &&
      selectedAsReceiver(record, input);
    const allCompletionPoints = record.flowPointIndex === undefined
      ? completionNodes.flatMap((node) => [...flow.pointsFor(node)])
      : [...rustOwnershipOperationCompletionFlowPoints(record, flow)];
    const allActivationPoints = rustOwnershipOperationCompletionFlowPoints(record, flow);
    for (const reservation of rustOwnershipOperationFlowPoints(record, flow)) {
      const completions = allCompletionPoints.filter((point) =>
        point.regionId === reservation.regionId &&
        (point.index === reservation.index || flow.reaches(reservation, point)));
      const activation = twoPhase
        ? allActivationPoints.find((point) =>
            point.regionId === reservation.regionId &&
            (point.index === reservation.index || flow.reaches(reservation, point))) ?? reservation
        : reservation;
      const livePoints = completions.length === 0
        ? [reservation]
        : flow.pointsOnPaths(reservation, completions);
      const livePointIds = Object.freeze(
        [...new Set([reservation, ...livePoints, ...completions].map((point) => point.index))]
          .sort((left, right) => left - right)
          .map((index) => flow.points[index]!.id),
      );
      const loanId = `${operation.loanId}\0flow:${reservation.id}`;
      const reservationRegion = loanRegion(loanId, reservation.regionId, "reservation");
      const liveRegion = loanRegion(loanId, reservation.regionId, "live");
      const loan = Object.freeze({
        id: loanId,
        kind: mutable ? "mutable" as const : "shared" as const,
        place: operation.place,
        reservationRegion,
        ...(twoPhase
          ? { activationRegion: loanRegion(loanId, reservation.regionId, "activation") }
          : {}),
        liveRegion,
        reservationPointId: reservation.id,
        activationPointId: activation.id,
        livePointIds,
        twoPhase,
      });
      const livePointIndexes = new Set(livePointIds.map((id) => pointIndexById.get(id)!));
      livePointMembershipCount += livePointIndexes.size;
      const livenessDiagnostic = rustLoanLivenessComplexityDiagnostic(
        livePointMembershipCount,
        record.node,
      );
      if (livenessDiagnostic !== undefined) {
        return {
          kind: "rejected",
          diagnostic: livenessDiagnostic,
        };
      }
      if (records.length >= maximumLoans) {
        return {
          kind: "rejected",
          diagnostic: rustOwnershipDiagnostic(
            "RUST_OWNERSHIP_LOAN_BUDGET_EXCEEDED",
            `Rust ownership analysis produced ${records.length + 1} exact flow loans; the finite limit is ${maximumLoans}.`,
            record.node,
          ),
        };
      }
      records.push(Object.freeze({
        index: records.length,
        loan,
        source: record,
        livePointIndexes,
        activationPointIndex: activation.index,
      }));
    }
  }
  const pairBudgetDiagnostic = validateLoanPairs(records, flow, diagnostics);
  if (pairBudgetDiagnostic !== undefined) {
    return { kind: "rejected", diagnostic: pairBudgetDiagnostic };
  }
  const recordsByPoint = indexLoansByPoint(records);
  const operationBudgetDiagnostic = validateOperationsAgainstLoans(
    recordsByPoint,
    operations,
    flow,
    input,
    diagnostics,
  );
  if (operationBudgetDiagnostic !== undefined) {
    return { kind: "rejected", diagnostic: operationBudgetDiagnostic };
  }
  const readBudgetDiagnostic = validateDirectPlaceUses(
    recordsByPoint,
    inventory,
    reads,
    flow,
    diagnostics,
  );
  if (readBudgetDiagnostic !== undefined) {
    return { kind: "rejected", diagnostic: readBudgetDiagnostic };
  }
  validateLoansAcrossSuspension(records, inventory, flow, input, diagnostics);
  const loansByNode = new WeakMap<Node, readonly RustLoan[]>();
  for (const [pointIndex, selectedRecords] of recordsByPoint) {
    const point = flow.points[pointIndex];
    if (point?.node === undefined) continue;
    const selected = new Map((loansByNode.get(point.node) ?? [])
      .map((loan) => [loan.id, loan] as const));
    selectedRecords.forEach((record) => selected.set(record.loan.id, record.loan));
    loansByNode.set(point.node, Object.freeze([...selected.values()]));
  }
  return {
    kind: "resolved",
    analysis: Object.freeze({
      loans: Object.freeze(records.map((record) => record.loan)),
      loansByNode,
    }),
  };
}

function indexLoansByPoint(
  records: readonly RustLoanRecord[],
): ReadonlyMap<number, readonly RustLoanRecord[]> {
  const selected = new Map<number, RustLoanRecord[]>();
  for (const record of records) {
    for (const point of record.livePointIndexes) {
      const atPoint = selected.get(point) ?? [];
      atPoint.push(record);
      selected.set(point, atPoint);
    }
  }
  return new Map([...selected].map(([point, values]) => [point, Object.freeze(values)]));
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
      const suspensionNode = point?.node ?? point?.resourceCleanup?.declaration;
      if (point?.suspension === undefined || suspensionNode === undefined ||
        loan.source.origin === "resource-cleanup") continue;
      const callable = enclosingCallable(suspensionNode, input);
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
        "A loan of callable-owned storage cannot cross a suspension because that would require a self-referential Rust future or generator.",
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
): TargetDiagnostic | undefined {
  const byRoot = new Map<string, RustLoanRecord[]>();
  for (const record of records) {
    const selected = byRoot.get(record.loan.place.rootId) ?? [];
    selected.push(record);
    byRoot.set(record.loan.place.rootId, selected);
  }
  let pairComparisons = 0;
  for (const selected of byRoot.values()) {
    pairComparisons += selected.length * (selected.length - 1) / 2;
    if (!Number.isSafeInteger(pairComparisons) || pairComparisons > maximumLoanPairComparisons) {
      return rustLoanPairComplexityDiagnostic(pairComparisons);
    }
  }
  let pointComparisons = 0;
  for (const selected of byRoot.values()) {
    for (let leftIndex = 0; leftIndex < selected.length; leftIndex += 1) {
      const left = selected[leftIndex]!;
      for (let rightIndex = leftIndex + 1; rightIndex < selected.length; rightIndex += 1) {
        const right = selected[rightIndex]!;
        if (left.loan.kind === "shared" && right.loan.kind === "shared") continue;
        if (!rustPlacesOverlap(left.loan.place, right.loan.place)) continue;
        const [smaller, larger] = left.livePointIndexes.size <= right.livePointIndexes.size
          ? [left, right]
          : [right, left];
        let conflict: number | undefined;
        for (const point of smaller.livePointIndexes) {
          pointComparisons += 1;
          if (pointComparisons > maximumLoanPointComparisons) {
            return rustLoanPointComplexityDiagnostic(pointComparisons);
          }
          if (larger.livePointIndexes.has(point) &&
            (effectiveLoanKind(left, point, flow) === "mutable" ||
              effectiveLoanKind(right, point, flow) === "mutable")) {
            conflict = point;
            break;
          }
        }
        if (conflict === undefined) continue;
        diagnostics.push(rustOwnershipDiagnostic(
          "RUST_OVERLAPPING_LOANS",
          `Overlapping ${left.loan.kind} and ${right.loan.kind} loans require incompatible access to the same Rust place.`,
          right.source.node,
        ));
      }
    }
  }
  return undefined;
}

function validateOperationsAgainstLoans(
  loansByPoint: ReadonlyMap<number, readonly RustLoanRecord[]>,
  operations: RustOwnershipOperationInventory,
  flow: RustSourceFlowGraph,
  input: RustOwnershipAnalysisInput,
  diagnostics: TargetDiagnostic[],
): TargetDiagnostic | undefined {
  const reported = new Set<string>();
  let comparisonCount = 0;
  for (const operation of operations.records) {
    if (isBorrowOperation(operation.operation)) continue;
    for (const point of rustOwnershipOperationFlowPoints(operation, flow)) {
      for (const loan of loansByPoint.get(point.index) ?? []) {
        comparisonCount += 1;
        if (comparisonCount > maximumLoanOperationComparisons) {
          return rustLoanOperationComplexityDiagnostic(comparisonCount, operation.node);
        }
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
  return undefined;
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
  loansByPoint: ReadonlyMap<number, readonly RustLoanRecord[]>,
  inventory: RustOwnershipNodeInventory,
  reads: WeakMap<Node, RustValueReadDisposition>,
  flow: RustSourceFlowGraph,
  diagnostics: TargetDiagnostic[],
): TargetDiagnostic | undefined {
  const reported = new Set<string>();
  let comparisonCount = 0;
  for (const node of inventory.nodes) {
    if (reads.get(node) === undefined) continue;
    const place = inventory.places.get(node);
    if (place === undefined) continue;
    for (const point of flow.pointsFor(node)) {
      for (const loan of loansByPoint.get(point.index) ?? []) {
        comparisonCount += 1;
        if (comparisonCount > maximumLoanReadComparisons) {
          return rustLoanReadComplexityDiagnostic(comparisonCount, node);
        }
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
  return undefined;
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
    if (isStatement(parent, input)) return parent;
    current = parent;
  }
}

function isStatement(node: Node, input: RustOwnershipAnalysisInput): boolean {
  const { is } = input.ast;
  return is.IsBlock(node) || is.IsVariableStatement(node) ||
    is.IsExpressionStatement(node) || is.IsIfStatement(node) ||
    is.IsDoStatement(node) || is.IsWhileStatement(node) ||
    is.IsForStatement(node) || is.IsForInStatement(node) ||
    is.IsForOfStatement(node) || is.IsBreakStatement(node) ||
    is.IsContinueStatement(node) || is.IsReturnStatement(node) ||
    is.IsWithStatement(node) || is.IsSwitchStatement(node) ||
    is.IsThrowStatement(node) || is.IsTryStatement(node) ||
    is.IsDebuggerStatement(node) || is.IsLabeledStatement(node) ||
    is.IsEmptyStatement(node) || is.IsClassDeclaration(node) ||
    is.IsEnumDeclaration(node) || is.IsModuleDeclaration(node) ||
    is.IsImportDeclaration(node) || is.IsExportDeclaration(node) ||
    is.IsExportAssignment(node) || is.IsNamespaceExportDeclaration(node) ||
    is.IsNotEmittedStatement(node);
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
  let current: Node | undefined = selected;
  while (current !== undefined) {
    if (current === root) return true;
    current = input.ast.parent(current);
  }
  return false;
}

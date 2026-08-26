import assert from "node:assert/strict";
import test from "node:test";

import {
  maximumDropObligations,
  maximumDropProjectionComparisons,
  maximumDropStates,
  maximumCallableBoundRequirements,
  maximumCaptureEvidenceVisits,
  maximumCaptureReferenceVisits,
  maximumCaptures,
  maximumFlowQuerySteps,
  maximumFlowConstructionDepth,
  maximumFlowEdges,
  maximumFlowPoints,
  maximumLexicalRegions,
  maximumLoanLivePointMemberships,
  maximumLoanOperationComparisons,
  maximumLoanPairComparisons,
  maximumLoanPointComparisons,
  maximumLoanReadComparisons,
  maximumLoans,
  maximumMoveDataflowEvaluations,
  maximumMovePlaceEvaluations,
  maximumMoveStateMemberships,
  maximumOwnershipOperations,
  maximumSourceNodes,
  maximumSourceUnits,
  maximumSuspendedValues,
  maximumSuspendedDropComparisons,
  maximumSuspensionPoints,
  maximumTrackedOwnershipPlaces,
  rustDropObligationComplexityDiagnostic,
  rustDropProjectionComplexityDiagnostic,
  rustDropStateComplexityDiagnostic,
  rustCallableBoundComplexityDiagnostic,
  rustCaptureCountComplexityDiagnostic,
  rustCaptureEvidenceComplexityDiagnostic,
  rustCaptureReferenceComplexityDiagnostic,
  rustFlowConstructionDepthComplexityDiagnostic,
  rustFlowEdgeComplexityDiagnostic,
  rustFlowPointComplexityDiagnostic,
  rustFlowQueryComplexityDiagnostic,
  rustLoanLivenessComplexityDiagnostic,
  rustLoanOperationComplexityDiagnostic,
  rustLoanPairComplexityDiagnostic,
  rustLoanPointComplexityDiagnostic,
  rustLoanReadComplexityDiagnostic,
  rustMoveDataflowComplexityDiagnostic,
  rustMovePlaceEvaluationComplexityDiagnostic,
  rustMoveStateMembershipComplexityDiagnostic,
  rustOwnershipInventoryCountComplexityDiagnostic,
  rustOwnershipOperationCountComplexityDiagnostic,
  rustOwnershipPlaceComplexityDiagnostic,
  rustSuspendedValueComplexityDiagnostic,
  rustSuspendedDropComparisonComplexityDiagnostic,
  rustSuspensionPointComplexityDiagnostic,
} from "../../../dist/analysis/ownership/complexity.js";

function provesExactBoundary(maximum, select, code) {
  assert.equal(select(maximum), undefined);
  assert.equal(select(maximum + 1)?.code, code);
  assert.equal(select(Number.MAX_SAFE_INTEGER + 1)?.code, code);
}

test("ownership inventory budgets accept exact limits and reject every next unit", () => {
  provesExactBoundary(
    maximumSourceUnits,
    (value) => rustOwnershipInventoryCountComplexityDiagnostic(value, 0, 0),
    "RUST_OWNERSHIP_SOURCE_UNIT_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumSourceNodes,
    (value) => rustOwnershipInventoryCountComplexityDiagnostic(0, value, 0),
    "RUST_OWNERSHIP_SOURCE_NODE_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumLexicalRegions,
    (value) => rustOwnershipInventoryCountComplexityDiagnostic(0, 0, value),
    "RUST_OWNERSHIP_REGION_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumTrackedOwnershipPlaces,
    rustOwnershipPlaceComplexityDiagnostic,
    "RUST_OWNERSHIP_PLACE_BUDGET_EXCEEDED",
  );
});

test("ownership operation and move-state budgets have closed arithmetic boundaries", () => {
  provesExactBoundary(
    maximumOwnershipOperations,
    (value) => rustOwnershipOperationCountComplexityDiagnostic(value, 0),
    "RUST_OWNERSHIP_OPERATION_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumLoans,
    (value) => rustOwnershipOperationCountComplexityDiagnostic(0, value),
    "RUST_OWNERSHIP_LOAN_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumMoveDataflowEvaluations,
    rustMoveDataflowComplexityDiagnostic,
    "RUST_OWNERSHIP_DATAFLOW_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumMoveStateMemberships,
    rustMoveStateMembershipComplexityDiagnostic,
    "RUST_OWNERSHIP_MOVE_STATE_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumMovePlaceEvaluations,
    rustMovePlaceEvaluationComplexityDiagnostic,
    "RUST_OWNERSHIP_MOVE_PLACE_BUDGET_EXCEEDED",
  );
});

test("loan analysis budgets cover retained liveness and every comparison family", () => {
  provesExactBoundary(
    maximumLoanLivePointMemberships,
    rustLoanLivenessComplexityDiagnostic,
    "RUST_OWNERSHIP_LOAN_LIVENESS_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumLoanPairComparisons,
    rustLoanPairComplexityDiagnostic,
    "RUST_OWNERSHIP_LOAN_PAIR_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumLoanPointComparisons,
    rustLoanPointComplexityDiagnostic,
    "RUST_OWNERSHIP_LOAN_POINT_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumLoanOperationComparisons,
    rustLoanOperationComplexityDiagnostic,
    "RUST_OWNERSHIP_OPERATION_LOAN_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumLoanReadComparisons,
    rustLoanReadComplexityDiagnostic,
    "RUST_OWNERSHIP_READ_LOAN_BUDGET_EXCEEDED",
  );
});

test("drop and flow-query budgets reject before retained work becomes unbounded", () => {
  provesExactBoundary(
    maximumDropStates,
    rustDropStateComplexityDiagnostic,
    "RUST_OWNERSHIP_DROP_STATE_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumDropObligations,
    rustDropObligationComplexityDiagnostic,
    "RUST_OWNERSHIP_DROP_OBLIGATION_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumDropProjectionComparisons,
    rustDropProjectionComplexityDiagnostic,
    "RUST_OWNERSHIP_DROP_PROJECTION_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumFlowQuerySteps,
    rustFlowQueryComplexityDiagnostic,
    "RUST_OWNERSHIP_FLOW_QUERY_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumFlowPoints,
    rustFlowPointComplexityDiagnostic,
    "RUST_OWNERSHIP_FLOW_POINT_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumFlowEdges,
    rustFlowEdgeComplexityDiagnostic,
    "RUST_OWNERSHIP_FLOW_EDGE_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumFlowConstructionDepth,
    rustFlowConstructionDepthComplexityDiagnostic,
    "RUST_OWNERSHIP_FLOW_DEPTH_BUDGET_EXCEEDED",
  );
});

test("capture and suspension budgets reject every first unit beyond their exact limits", () => {
  provesExactBoundary(
    maximumCaptures,
    rustCaptureCountComplexityDiagnostic,
    "RUST_OWNERSHIP_CAPTURE_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumCaptureEvidenceVisits,
    rustCaptureEvidenceComplexityDiagnostic,
    "RUST_OWNERSHIP_CAPTURE_EVIDENCE_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumCaptureReferenceVisits,
    rustCaptureReferenceComplexityDiagnostic,
    "RUST_OWNERSHIP_CAPTURE_REFERENCE_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumSuspensionPoints,
    rustSuspensionPointComplexityDiagnostic,
    "RUST_OWNERSHIP_SUSPENSION_POINT_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumSuspendedValues,
    rustSuspendedValueComplexityDiagnostic,
    "RUST_OWNERSHIP_SUSPENDED_VALUE_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumSuspendedDropComparisons,
    rustSuspendedDropComparisonComplexityDiagnostic,
    "RUST_OWNERSHIP_SUSPENDED_DROP_BUDGET_EXCEEDED",
  );
  provesExactBoundary(
    maximumCallableBoundRequirements,
    rustCallableBoundComplexityDiagnostic,
    "RUST_OWNERSHIP_CALLABLE_BOUND_BUDGET_EXCEEDED",
  );
});

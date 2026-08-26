import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { rustOwnershipDiagnostic } from "./diagnostics.js";

export const maximumSourceUnits = 65_536;
export const maximumSourceNodes = 1_048_576;
export const maximumLexicalRegions = 262_144;
export const maximumOwnershipOperations = 1_048_576;
export const maximumLoans = 262_144;
export const maximumTrackedOwnershipPlaces = 1_048_576;
export const maximumMoveDataflowEvaluations = 16_777_216;
export const maximumMoveStateMemberships = 4_194_304;
export const maximumMovePlaceEvaluations = 67_108_864;
export const maximumDropStates = 1_048_576;
export const maximumDropObligations = 1_048_576;
export const maximumDropProjectionComparisons = 67_108_864;
export const maximumFlowPoints = 1_048_576;
export const maximumFlowEdges = 4_194_304;
export const maximumFlowConstructionDepth = 1_024;
export const maximumFlowQuerySteps = 67_108_864;
export const maximumFlowReachabilityCacheEntries = 1_048_576;

export const maximumLoanLivePointMemberships = 4_194_304;
export const maximumLoanPairComparisons = 16_777_216;
export const maximumLoanPointComparisons = 67_108_864;
export const maximumLoanOperationComparisons = 67_108_864;
export const maximumLoanReadComparisons = 67_108_864;
export const maximumCaptures = 1_048_576;
export const maximumCaptureEvidenceVisits = 16_777_216;
export const maximumCaptureReferenceVisits = 16_777_216;
export const maximumSuspensionPoints = 1_048_576;
export const maximumSuspendedValues = 1_048_576;
export const maximumSuspendedDropComparisons = 16_777_216;
export const maximumCallableBoundRequirements = 1_048_576;

export class RustOwnershipComplexityError extends Error {
  constructor(readonly diagnostic: TargetDiagnostic) {
    super(diagnostic.message);
  }
}

function exceedsFiniteBudget(value: number, maximum: number): boolean {
  return !Number.isSafeInteger(value) || value < 0 || value > maximum;
}

export function rustOwnershipInventoryCountComplexityDiagnostic(
  sourceUnitCount: number,
  sourceNodeCount: number,
  lexicalRegionCount: number,
): TargetDiagnostic | undefined {
  if (exceedsFiniteBudget(sourceUnitCount, maximumSourceUnits)) {
    return rustOwnershipDiagnostic(
      "RUST_OWNERSHIP_SOURCE_UNIT_BUDGET_EXCEEDED",
      `Rust ownership analysis received ${sourceUnitCount} source units; the finite limit is ${maximumSourceUnits}.`,
    );
  }
  if (exceedsFiniteBudget(sourceNodeCount, maximumSourceNodes)) {
    return rustOwnershipDiagnostic(
      "RUST_OWNERSHIP_SOURCE_NODE_BUDGET_EXCEEDED",
      `Rust ownership analysis received ${sourceNodeCount} source nodes; the finite limit is ${maximumSourceNodes}.`,
    );
  }
  if (exceedsFiniteBudget(lexicalRegionCount, maximumLexicalRegions)) {
    return rustOwnershipDiagnostic(
      "RUST_OWNERSHIP_REGION_BUDGET_EXCEEDED",
      `Rust ownership analysis received ${lexicalRegionCount} lexical regions; the finite limit is ${maximumLexicalRegions}.`,
    );
  }
  return undefined;
}

export function rustOwnershipOperationCountComplexityDiagnostic(
  operationCount: number,
  loanCount: number,
): TargetDiagnostic | undefined {
  if (exceedsFiniteBudget(operationCount, maximumOwnershipOperations)) {
    return rustOwnershipDiagnostic(
      "RUST_OWNERSHIP_OPERATION_BUDGET_EXCEEDED",
      `Rust ownership analysis produced ${operationCount} exact operations; the finite limit is ${maximumOwnershipOperations}.`,
    );
  }
  return exceedsFiniteBudget(loanCount, maximumLoans)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_LOAN_BUDGET_EXCEEDED",
        `Rust ownership analysis produced ${loanCount} exact loans; the finite limit is ${maximumLoans}.`,
      )
    : undefined;
}

export function rustOwnershipPlaceComplexityDiagnostic(
  placeCount: number,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(placeCount, maximumTrackedOwnershipPlaces)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_PLACE_BUDGET_EXCEEDED",
        `Rust ownership analysis produced ${placeCount} tracked places; the finite limit is ${maximumTrackedOwnershipPlaces}.`,
      )
    : undefined;
}

export function rustCaptureCountComplexityDiagnostic(
  captureCount: number,
  node?: Node,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(captureCount, maximumCaptures)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_CAPTURE_BUDGET_EXCEEDED",
        `Rust ownership analysis retained ${captureCount} captures; the finite limit is ${maximumCaptures}.`,
        node,
      )
    : undefined;
}

export function rustCaptureEvidenceComplexityDiagnostic(
  visitCount: number,
  node?: Node,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(visitCount, maximumCaptureEvidenceVisits)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_CAPTURE_EVIDENCE_BUDGET_EXCEEDED",
        `Rust ownership analysis visited ${visitCount} callable-evidence nodes; the finite limit is ${maximumCaptureEvidenceVisits}.`,
        node,
      )
    : undefined;
}

export function rustCaptureReferenceComplexityDiagnostic(
  visitCount: number,
  node?: Node,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(visitCount, maximumCaptureReferenceVisits)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_CAPTURE_REFERENCE_BUDGET_EXCEEDED",
        `Rust ownership analysis visited ${visitCount} capture references; the finite limit is ${maximumCaptureReferenceVisits}.`,
        node,
      )
    : undefined;
}

export function rustSuspensionPointComplexityDiagnostic(
  pointCount: number,
  node?: Node,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(pointCount, maximumSuspensionPoints)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_SUSPENSION_POINT_BUDGET_EXCEEDED",
        `Rust ownership analysis retained ${pointCount} suspension points; the finite limit is ${maximumSuspensionPoints}.`,
        node,
      )
    : undefined;
}

export function rustSuspendedValueComplexityDiagnostic(
  valueCount: number,
  node?: Node,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(valueCount, maximumSuspendedValues)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_SUSPENDED_VALUE_BUDGET_EXCEEDED",
        `Rust ownership analysis retained ${valueCount} suspended values; the finite limit is ${maximumSuspendedValues}.`,
        node,
      )
    : undefined;
}

export function rustSuspendedDropComparisonComplexityDiagnostic(
  comparisonCount: number,
  node?: Node,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(comparisonCount, maximumSuspendedDropComparisons)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_SUSPENDED_DROP_BUDGET_EXCEEDED",
        `Rust ownership analysis performed ${comparisonCount} suspension-to-drop comparisons; the finite limit is ${maximumSuspendedDropComparisons}.`,
        node,
      )
    : undefined;
}

export function rustCallableBoundComplexityDiagnostic(
  boundCount: number,
  node?: Node,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(boundCount, maximumCallableBoundRequirements)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_CALLABLE_BOUND_BUDGET_EXCEEDED",
        `Rust ownership analysis retained ${boundCount} callable-bound requirements; the finite limit is ${maximumCallableBoundRequirements}.`,
        node,
      )
    : undefined;
}

export function rustMoveDataflowComplexityDiagnostic(
  evaluationCount: number,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(evaluationCount, maximumMoveDataflowEvaluations)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_DATAFLOW_BUDGET_EXCEEDED",
        `Rust ownership analysis performed ${evaluationCount} move-state evaluations; the finite limit is ${maximumMoveDataflowEvaluations}.`,
      )
    : undefined;
}

export function rustMoveStateMembershipComplexityDiagnostic(
  membershipCount: number,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(membershipCount, maximumMoveStateMemberships)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_MOVE_STATE_BUDGET_EXCEEDED",
        `Rust ownership analysis retained ${membershipCount} move-state memberships; the finite limit is ${maximumMoveStateMemberships}.`,
      )
    : undefined;
}

export function rustMovePlaceEvaluationComplexityDiagnostic(
  evaluationCount: number,
  node?: Node,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(evaluationCount, maximumMovePlaceEvaluations)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_MOVE_PLACE_BUDGET_EXCEEDED",
        `Rust ownership analysis performed ${evaluationCount} move-place evaluations; the finite limit is ${maximumMovePlaceEvaluations}.`,
        node,
      )
    : undefined;
}

export function rustLoanLivenessComplexityDiagnostic(
  membershipCount: number,
  node?: Node,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(membershipCount, maximumLoanLivePointMemberships)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_LOAN_LIVENESS_BUDGET_EXCEEDED",
        `Rust ownership analysis retained ${membershipCount} loan-liveness memberships; the finite limit is ${maximumLoanLivePointMemberships}.`,
        node,
      )
    : undefined;
}

export function rustLoanPairComplexityDiagnostic(
  comparisonCount: number,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(comparisonCount, maximumLoanPairComparisons)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_LOAN_PAIR_BUDGET_EXCEEDED",
        `Rust ownership analysis performed ${comparisonCount} loan-pair comparisons; the finite limit is ${maximumLoanPairComparisons}.`,
      )
    : undefined;
}

export function rustLoanPointComplexityDiagnostic(
  comparisonCount: number,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(comparisonCount, maximumLoanPointComparisons)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_LOAN_POINT_BUDGET_EXCEEDED",
        `Rust ownership analysis performed ${comparisonCount} loan-liveness comparisons; the finite limit is ${maximumLoanPointComparisons}.`,
      )
    : undefined;
}

export function rustLoanOperationComplexityDiagnostic(
  comparisonCount: number,
  node?: Node,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(comparisonCount, maximumLoanOperationComparisons)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_OPERATION_LOAN_BUDGET_EXCEEDED",
        `Rust ownership analysis performed ${comparisonCount} operation-to-loan comparisons; the finite limit is ${maximumLoanOperationComparisons}.`,
        node,
      )
    : undefined;
}

export function rustLoanReadComplexityDiagnostic(
  comparisonCount: number,
  node?: Node,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(comparisonCount, maximumLoanReadComparisons)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_READ_LOAN_BUDGET_EXCEEDED",
        `Rust ownership analysis performed ${comparisonCount} read-to-loan comparisons; the finite limit is ${maximumLoanReadComparisons}.`,
        node,
      )
    : undefined;
}

export function rustDropStateComplexityDiagnostic(
  stateCount: number,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(stateCount, maximumDropStates)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_DROP_STATE_BUDGET_EXCEEDED",
        `Rust ownership analysis produced ${stateCount} drop states; the finite limit is ${maximumDropStates}.`,
      )
    : undefined;
}

export function rustDropObligationComplexityDiagnostic(
  obligationCount: number,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(obligationCount, maximumDropObligations)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_DROP_OBLIGATION_BUDGET_EXCEEDED",
        `Rust ownership analysis produced ${obligationCount} drop obligations; the finite limit is ${maximumDropObligations}.`,
      )
    : undefined;
}

export function rustDropProjectionComplexityDiagnostic(
  comparisonCount: number,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(comparisonCount, maximumDropProjectionComparisons)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_DROP_PROJECTION_BUDGET_EXCEEDED",
        `Rust ownership analysis performed ${comparisonCount} drop-projection comparisons; the finite limit is ${maximumDropProjectionComparisons}.`,
      )
    : undefined;
}

export function rustFlowPointComplexityDiagnostic(
  pointCount: number,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(pointCount, maximumFlowPoints)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_FLOW_POINT_BUDGET_EXCEEDED",
        `Rust ownership analysis produced ${pointCount} control-flow points; the finite limit is ${maximumFlowPoints}.`,
      )
    : undefined;
}

export function rustFlowEdgeComplexityDiagnostic(
  edgeCount: number,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(edgeCount, maximumFlowEdges)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_FLOW_EDGE_BUDGET_EXCEEDED",
        `Rust ownership analysis produced ${edgeCount} control-flow edges; the finite limit is ${maximumFlowEdges}.`,
      )
    : undefined;
}

export function rustFlowConstructionDepthComplexityDiagnostic(
  depth: number,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(depth, maximumFlowConstructionDepth)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_FLOW_DEPTH_BUDGET_EXCEEDED",
        `Rust ownership analysis reached control-flow construction depth ${depth}; the finite limit is ${maximumFlowConstructionDepth}.`,
      )
    : undefined;
}

export function rustFlowQueryComplexityDiagnostic(
  stepCount: number,
): TargetDiagnostic | undefined {
  return exceedsFiniteBudget(stepCount, maximumFlowQuerySteps)
    ? rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_FLOW_QUERY_BUDGET_EXCEEDED",
        `Rust ownership analysis performed ${stepCount} control-flow query steps; the finite limit is ${maximumFlowQuerySteps}.`,
      )
    : undefined;
}

import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  Node_Expression,
  Node_Initializer,
} from "@tsonic/target-api/source";
import {
  rustTargetOperationFactKey,
} from "../facts/keys.js";
import { rustSourceOwnershipOperationFactKey } from "../../source/semantics/facts.js";
import { isRustCallableCarrier } from "../../target-model/types/index.js";
import type { RustOwnershipAnalysisInput } from "./context.js";
import { nodeContains } from "./capture-execution.js";
import {
  RustOwnershipComplexityError,
  rustCallableBoundComplexityDiagnostic,
  rustCaptureCountComplexityDiagnostic,
  rustCaptureEvidenceComplexityDiagnostic,
  rustCaptureReferenceComplexityDiagnostic,
  rustSuspendedDropComparisonComplexityDiagnostic,
  rustSuspendedValueComplexityDiagnostic,
} from "./complexity.js";

export interface RustCaptureWorkBudget {
  chargeCapture(node: Node): void;
  chargeEvidence(count: number, node: Node): void;
  chargeReferences(count: number, node: Node): void;
  chargeSuspendedValue(node: Node): void;
  chargeSuspendedDropComparisons(count: number, node: Node): void;
  chargeCallableBound(node: Node): void;
}

export interface RustCallableEvidenceIndex {
  candidatesFor(callable: Node): readonly Node[];
  valueCandidatesFor(callable: Node): readonly Node[];
  referencesWithin(callable: Node, declaration: Node): readonly Node[];
}

export function createRustCallableEvidenceIndex(
  input: RustOwnershipAnalysisInput,
  budget: RustCaptureWorkBudget,
): RustCallableEvidenceIndex {
  const candidatesByCallable = new WeakMap<Node, readonly Node[]>();
  const valueCandidatesByCallable = new WeakMap<Node, readonly Node[]>();
  const referencesByDeclaration = new WeakMap<Node, readonly Node[]>();
  const referencesByCallable = new WeakMap<Node, WeakMap<Node, readonly Node[]>>();
  return Object.freeze<RustCallableEvidenceIndex>({
    candidatesFor(callable) {
      const existing = candidatesByCallable.get(callable);
      if (existing !== undefined) return existing;
      const candidates = collectCallableEvidenceCandidates(callable, input, budget);
      candidatesByCallable.set(callable, candidates);
      return candidates;
    },
    valueCandidatesFor(callable) {
      const existing = valueCandidatesByCallable.get(callable);
      if (existing !== undefined) return existing;
      const candidates = collectCallableValueEvidenceCandidates(callable, input, budget);
      valueCandidatesByCallable.set(callable, candidates);
      return candidates;
    },
    referencesWithin(callable, declaration) {
      let byDeclaration = referencesByCallable.get(callable);
      if (byDeclaration === undefined) {
        byDeclaration = new WeakMap<Node, readonly Node[]>();
        referencesByCallable.set(callable, byDeclaration);
      }
      const existing = byDeclaration.get(declaration);
      if (existing !== undefined) return existing;
      let allReferences = referencesByDeclaration.get(declaration);
      if (allReferences === undefined) {
        const selected = input.navigation.referencesToDeclaration(declaration);
        budget.chargeReferences(selected.length, declaration);
        allReferences = Object.freeze([...selected]);
        referencesByDeclaration.set(declaration, allReferences);
      }
      budget.chargeReferences(allReferences.length, declaration);
      const references = Object.freeze(allReferences.filter((reference) =>
        nodeContains(callable, reference, input)));
      byDeclaration.set(declaration, references);
      return references;
    },
  });
}

export function createRustCaptureWorkBudget(): RustCaptureWorkBudget {
  let captureCount = 0;
  let evidenceVisits = 0;
  let referenceVisits = 0;
  let suspendedValueCount = 0;
  let suspendedDropComparisons = 0;
  let callableBoundCount = 0;
  const requireWithinBudget = (diagnostic: TargetDiagnostic | undefined): void => {
    if (diagnostic !== undefined) throw new RustOwnershipComplexityError(diagnostic);
  };
  return Object.freeze<RustCaptureWorkBudget>({
    chargeCapture(node) {
      captureCount += 1;
      requireWithinBudget(rustCaptureCountComplexityDiagnostic(captureCount, node));
    },
    chargeEvidence(count, node) {
      evidenceVisits += count;
      requireWithinBudget(rustCaptureEvidenceComplexityDiagnostic(evidenceVisits, node));
    },
    chargeReferences(count, node) {
      referenceVisits += count;
      requireWithinBudget(rustCaptureReferenceComplexityDiagnostic(referenceVisits, node));
    },
    chargeSuspendedValue(node) {
      suspendedValueCount += 1;
      requireWithinBudget(rustSuspendedValueComplexityDiagnostic(suspendedValueCount, node));
    },
    chargeSuspendedDropComparisons(count, node) {
      suspendedDropComparisons += count;
      requireWithinBudget(rustSuspendedDropComparisonComplexityDiagnostic(
        suspendedDropComparisons,
        node,
      ));
    },
    chargeCallableBound(node) {
      callableBoundCount += 1;
      requireWithinBudget(rustCallableBoundComplexityDiagnostic(callableBoundCount, node));
    },
  });
}

function collectCallableEvidenceCandidates(
  callable: Node,
  input: RustOwnershipAnalysisInput,
  budget: RustCaptureWorkBudget,
): readonly Node[] {
  const candidates: Node[] = [];
  const pending: Node[] = [callable];
  budget.chargeEvidence(1, callable);
  const seen = new Set<Node>();
  let cursor = 0;
  while (cursor < pending.length) {
    const candidate = pending[cursor++]!;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
    const invocation = directInvocationOf(candidate, input);
    if (invocation !== undefined) {
      budget.chargeEvidence(1, invocation);
      pending.push(invocation);
    }
    const ownershipResult = exactCallableOwnershipResultOf(candidate, input);
    if (ownershipResult !== undefined) {
      budget.chargeEvidence(1, ownershipResult);
      pending.push(ownershipResult);
    }
    const initializedDeclaration = declarationInitializedExactlyBy(candidate, input);
    if (initializedDeclaration !== undefined) {
      const uses = input.navigation.declarationUses(initializedDeclaration);
      budget.chargeEvidence(uses.length, initializedDeclaration);
      for (const use of uses) {
        if (use.kind !== "source-linkage" && use.kind !== "type-only") {
          pending.push(use.reference);
        }
      }
    }
  }
  return Object.freeze(candidates);
}

function collectCallableValueEvidenceCandidates(
  callable: Node,
  input: RustOwnershipAnalysisInput,
  budget: RustCaptureWorkBudget,
): readonly Node[] {
  const candidates: Node[] = [];
  const pending: Node[] = [callable];
  budget.chargeEvidence(1, callable);
  const seen = new Set<Node>();
  let cursor = 0;
  while (cursor < pending.length) {
    const candidate = pending[cursor++]!;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
    const transparentWrapper = transparentCallableValueWrapperOf(candidate, input);
    if (transparentWrapper !== undefined) {
      budget.chargeEvidence(1, transparentWrapper);
      pending.push(transparentWrapper);
    }
    const ownershipResult = exactCallableOwnershipResultOf(candidate, input);
    if (ownershipResult !== undefined) {
      budget.chargeEvidence(1, ownershipResult);
      pending.push(ownershipResult);
    }
    const initializedDeclaration = declarationInitializedExactlyBy(candidate, input);
    if (initializedDeclaration !== undefined) {
      budget.chargeEvidence(1, initializedDeclaration);
      pending.push(initializedDeclaration);
      const uses = input.navigation.declarationUses(initializedDeclaration);
      budget.chargeEvidence(uses.length, initializedDeclaration);
      for (const use of uses) {
        if (use.kind !== "source-linkage" && use.kind !== "type-only") {
          pending.push(use.reference);
        }
      }
    }
  }
  return Object.freeze(candidates);
}

function transparentCallableValueWrapperOf(
  node: Node,
  input: RustOwnershipAnalysisInput,
): Node | undefined {
  const parent = input.ast.parent(node);
  if (parent === undefined) return undefined;
  const kind = input.ast.kindName(parent);
  return kind === "KindParenthesizedExpression" || kind === "KindAsExpression" ||
      kind === "KindSatisfiesExpression" || kind === "KindNonNullExpression" ||
      kind === "KindTypeAssertionExpression"
    ? parent
    : undefined;
}

function exactCallableOwnershipResultOf(
  node: Node,
  input: RustOwnershipAnalysisInput,
): Node | undefined {
  let current = node;
  for (;;) {
    const parent = input.ast.parent(current);
    if (parent === undefined) return undefined;
    const kind = input.ast.kindName(parent);
    if (kind === "KindParenthesizedExpression" || kind === "KindAsExpression" ||
      kind === "KindSatisfiesExpression" || kind === "KindNonNullExpression" ||
      kind === "KindTypeAssertionExpression") {
      current = parent;
      continue;
    }
    if (kind !== "KindCallExpression") return undefined;
    const source = input.facts.getFact(parent, rustSourceOwnershipOperationFactKey);
    const target = input.facts.getFact(parent, rustTargetOperationFactKey);
    return source?.valueExpression === current &&
        target?.kind === "ownership-marker" &&
        isRustCallableCarrier(target.resultCarrier)
      ? parent
      : undefined;
  }
}

function directInvocationOf(node: Node, input: RustOwnershipAnalysisInput): Node | undefined {
  let current = node;
  for (;;) {
    const parent = input.ast.parent(current);
    if (parent === undefined) return undefined;
    const kind = input.ast.kindName(parent);
    if (kind === "KindParenthesizedExpression" || kind === "KindAsExpression" ||
      kind === "KindSatisfiesExpression" || kind === "KindNonNullExpression" ||
      kind === "KindTypeAssertionExpression") {
      current = parent;
      continue;
    }
    if (kind !== "KindCallExpression") return undefined;
    return Node_Expression(input.ast, parent) === current ? parent : undefined;
  }
}

function declarationInitializedExactlyBy(
  node: Node,
  input: RustOwnershipAnalysisInput,
): Node | undefined {
  let current = node;
  for (;;) {
    const parent = input.ast.parent(current);
    if (parent === undefined) return undefined;
    const kind = input.ast.kindName(parent);
    if (kind === "KindParenthesizedExpression" || kind === "KindAsExpression" ||
      kind === "KindSatisfiesExpression" || kind === "KindNonNullExpression" ||
      kind === "KindTypeAssertionExpression") {
      current = parent;
      continue;
    }
    return kind === "KindVariableDeclaration" && Node_Initializer(input.ast, parent) === current
      ? parent
      : undefined;
  }
}

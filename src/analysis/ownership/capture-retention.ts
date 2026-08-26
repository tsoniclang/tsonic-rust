import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import { rustTargetOperationFactKey } from "../facts/keys.js";
import type {
  RustDropObligation,
  RustPlaceRef,
  RustSuspendedValue,
  RustSuspensionPoint,
} from "../../target-model/semantics/index.js";
import { rustTypeSemanticKey } from "../../target-model/semantics/index.js";
import type { RustSourceFlowGraph, RustSourceFlowPoint } from "./control-flow.js";
import type { RustOwnershipAnalysisInput } from "./context.js";
import type { RustOwnershipNodeInventory } from "./inventory.js";
import type { RustOwnershipOperationInventory } from "./operations.js";
import type { RustMoveAndDropAnalysis } from "./moves.js";
import {
  rustPlaceKey,
  rustTemporaryPlaceForExpression,
} from "./places.js";
import { isRustSourceValueDeclarationKind } from "./source-values.js";
import type {
  RustCallableEvidenceIndex,
  RustCaptureWorkBudget,
} from "./capture-evidence.js";

export function collectSuspendedValues(
  callable: Node,
  suspensionPoints: readonly RustSuspensionPoint[],
  flow: RustSourceFlowGraph,
  flowPointById: ReadonlyMap<string, RustSourceFlowPoint>,
  inventory: RustOwnershipNodeInventory,
  moves: RustMoveAndDropAnalysis,
  input: RustOwnershipAnalysisInput,
  evidence: RustCallableEvidenceIndex,
  budget: RustCaptureWorkBudget,
): readonly RustSuspendedValue[] {
  if (suspensionPoints.length === 0) return Object.freeze([]);
  const retained: RustSuspendedValue[] = [];
  const seen = new Set<string>();
  const dropObligationsByRoot = new Map<string, RustDropObligation[]>();
  for (const obligation of moves.dropObligations) {
    const selected = dropObligationsByRoot.get(obligation.place.rootId);
    if (selected === undefined) {
      dropObligationsByRoot.set(obligation.place.rootId, [obligation]);
    } else {
      selected.push(obligation);
    }
  }
  for (const declaration of inventory.nodesByCallable.get(callable) ?? Object.freeze([])) {
    if (!isRustSourceValueDeclarationKind(input.ast.kindName(declaration))) continue;
    const place = inventory.places.get(declaration);
    const carrier = input.facts.getRuntimeCarrierFact(declaration)?.carrier;
    const declarationPoints = flow.pointsFor(declaration);
    if (place === undefined || carrier === undefined || declarationPoints.length === 0) continue;
    const references = evidence.referencesWithin(callable, declaration);
    const dropObligations = dropObligationsByRoot.get(place.rootId) ?? [];
    const crosses = suspensionPoints.some((suspension) => {
      const suspensionPoint = flowPointById.get(suspension.flowPointId);
      if (suspensionPoint === undefined ||
        !declarationPoints.some((declarationPoint) => flow.reaches(declarationPoint, suspensionPoint))) {
        return false;
      }
      if (suspensionPoint.resourceCleanup?.declaration === declaration ||
        references.some((reference) => flow.reaches(suspensionPoint, reference))) {
        return true;
      }
      if (!moves.placeMayBeAvailableAfter(suspension.flowPointId, place)) return false;
      budget.chargeSuspendedDropComparisons(dropObligations.length, declaration);
      return dropObligations.some((obligation) => {
        const dropPoint = flowPointById.get(obligation.flowPointId);
        return dropPoint !== undefined && flow.reaches(suspensionPoint, dropPoint);
      });
    });
    const key = `${rustTypeSemanticKey(carrier)}\0${rustPlaceKey(place)}`;
    if (!crosses || seen.has(key)) continue;
    budget.chargeSuspendedValue(declaration);
    seen.add(key);
    retained.push(Object.freeze({ place, carrier }));
  }
  for (const suspension of suspensionPoints) {
    const point = flowPointById.get(suspension.flowPointId);
    const operation = point?.node === undefined
      ? undefined
      : input.facts.getFact(point.node, rustTargetOperationFactKey);
    if (point?.node === undefined || operation?.kind !== "iteration" ||
      operation.iterationKind !== "for-await-of" ||
      operation.lowering.kind !== "async-generator") {
      continue;
    }
    const iterable = Node_Expression(input.ast, point.node);
    const carrier = input.facts.getRuntimeCarrierFact(iterable)?.carrier;
    if (iterable === undefined || carrier === undefined) continue;
    const place = inventory.places.get(iterable) ??
      rustTemporaryPlaceForExpression(iterable, input.ast);
    const key = `${rustTypeSemanticKey(carrier)}\0${rustPlaceKey(place)}`;
    if (seen.has(key)) continue;
    budget.chargeSuspendedValue(iterable);
    seen.add(key);
    retained.push(Object.freeze({ place, carrier }));
  }
  return Object.freeze(retained);
}

export function indexFlowPointsById(
  flow: RustSourceFlowGraph,
): ReadonlyMap<string, RustSourceFlowPoint> {
  const indexed = new Map<string, RustSourceFlowPoint>();
  for (const point of flow.points) indexed.set(point.id, point);
  return indexed;
}

export function indexMovedPlacesByCallable(
  operations: RustOwnershipOperationInventory,
  inventory: RustOwnershipNodeInventory,
): WeakMap<Node, ReadonlyMap<string, readonly RustPlaceRef[]>> {
  const indexed = new WeakMap<Node, Map<string, RustPlaceRef[]>>();
  for (const record of operations.records) {
    if (record.operation.kind !== "move") continue;
    const callable = inventory.callableOwnerByNode.get(record.node);
    if (callable === undefined) continue;
    let byRoot = indexed.get(callable);
    if (byRoot === undefined) {
      byRoot = new Map();
      indexed.set(callable, byRoot);
    }
    const places = byRoot.get(record.operation.place.rootId) ?? [];
    places.push(record.operation.place);
    byRoot.set(record.operation.place.rootId, places);
  }
  return indexed;
}

export function indexMutablyUsedPlacesByCallable(
  operations: RustOwnershipOperationInventory,
  inventory: RustOwnershipNodeInventory,
): WeakMap<Node, ReadonlyMap<string, readonly RustPlaceRef[]>> {
  const indexed = new WeakMap<Node, Map<string, RustPlaceRef[]>>();
  for (const record of operations.records) {
    const operation = record.operation;
    if (operation.kind !== "mutable-borrow" &&
      (operation.kind !== "reborrow" || !operation.mutable) &&
      operation.kind !== "store" && operation.kind !== "replace" && operation.kind !== "take") {
      continue;
    }
    const callable = inventory.callableOwnerByNode.get(record.node);
    if (callable === undefined) continue;
    let byRoot = indexed.get(callable);
    if (byRoot === undefined) {
      byRoot = new Map();
      indexed.set(callable, byRoot);
    }
    const places = byRoot.get(operation.place.rootId) ?? [];
    places.push(operation.place);
    byRoot.set(operation.place.rootId, places);
  }
  return indexed;
}

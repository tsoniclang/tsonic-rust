import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  BinaryExpression_Left,
  CatchClause_VariableDeclaration,
  ForInOrOfStatement_Initializer,
  Node_Expression,
  Node_Initializer,
  Node_Operand,
} from "@tsonic/target-api/source";
import type {
  RustDropObligation,
  RustDropState,
  RustLifetimeRef,
  RustPlaceRef,
  RustTypeRef,
  RustValueReadDisposition,
} from "../../target-model/semantics/index.js";
import {
  compareRustSemanticKeys,
  rustLifetimeSemanticKey,
} from "../../target-model/semantics/index.js";
import {
  isRustNullishSourceCarrier,
  rustFixedArrayCarrierValue,
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
  rustStructuralObjectCarrierValue,
} from "../../target-model/types/index.js";
import type { RustSourceFlowGraph, RustSourceFlowPoint } from "./control-flow.js";
import type {
  RustOwnershipAnalysisInput,
  RustOwnershipEnvironment,
} from "./context.js";
import { rustOwnershipDiagnostic } from "./diagnostics.js";
import type { RustOwnershipNodeInventory } from "./inventory.js";
import type { RustOwnershipOperationInventory } from "./operations.js";
import { rustOwnershipOperationFlowPoints } from "./operations.js";
import {
  maximumDropObligations,
  maximumDropProjectionComparisons,
  maximumDropStates,
  maximumMoveDataflowEvaluations,
  maximumMovePlaceEvaluations,
  maximumTrackedOwnershipPlaces,
  rustDropObligationComplexityDiagnostic,
  rustDropProjectionComplexityDiagnostic,
  rustDropStateComplexityDiagnostic,
  rustMoveDataflowComplexityDiagnostic,
  rustMovePlaceEvaluationComplexityDiagnostic,
  rustMoveStateMembershipComplexityDiagnostic,
  rustOwnershipPlaceComplexityDiagnostic,
} from "./complexity.js";
import {
  rustPlaceKey,
  rustPlaceContains,
  rustPlacesOverlap,
  rustProjectedPlace,
  rustProjectFieldProjection,
} from "./places.js";
import { requireRustOwnershipSourceIdentity } from "./identity.js";
import { requireDenseRustOwnershipNodes } from "./source-shape.js";

interface RustPlaceUniverse {
  readonly places: readonly RustPlaceRef[];
  readonly byKey: ReadonlyMap<string, RustPlaceRef>;
  readonly byRoot: ReadonlyMap<string, readonly RustPlaceRef[]>;
  readonly regionByRoot: ReadonlyMap<string, string>;
  readonly carrierByRoot: ReadonlyMap<string, RustTypeRef>;
  readonly completeChildrenByParent: ReadonlyMap<string, readonly string[]>;
}

interface RustMoveState {
  readonly unavailable: ReadonlySet<string>;
  readonly moved: ReadonlySet<string>;
  readonly possiblyAvailable: ReadonlySet<string>;
}

type RustMoveEvent =
  | { readonly kind: "declare"; readonly place: RustPlaceRef; readonly initialized: boolean; readonly node: Node }
  | { readonly kind: "move"; readonly place: RustPlaceRef; readonly node: Node }
  | { readonly kind: "write"; readonly place: RustPlaceRef; readonly node: Node };

export interface RustMoveAndDropAnalysis {
  readonly drops: readonly RustDropState[];
  readonly dropObligations: readonly RustDropObligation[];
  readonly dropObligationsByRegion: ReadonlyMap<string, readonly RustDropObligation[]>;
  readonly dropsByNode: WeakMap<Node, readonly RustDropState[]>;
  readonly unavailableAtNode: WeakMap<Node, ReadonlySet<string>>;
  placeMayBeAvailableAfter(flowPointId: string, place: RustPlaceRef): boolean;
  placeIsWrittenWithin(callable: Node, place: RustPlaceRef): boolean;
}

export type AnalyzeRustMovesAndDropsResult =
  | { readonly kind: "resolved"; readonly analysis: RustMoveAndDropAnalysis }
  | { readonly kind: "rejected"; readonly diagnostic: TargetDiagnostic };

class RustMoveComplexityError extends Error {
  constructor(readonly diagnostic: TargetDiagnostic) {
    super(diagnostic.message);
  }
}

export function analyzeRustMovesAndDrops(
  flow: RustSourceFlowGraph,
  inventory: RustOwnershipNodeInventory,
  operations: RustOwnershipOperationInventory,
  reads: WeakMap<Node, RustValueReadDisposition>,
  input: RustOwnershipAnalysisInput,
  environment: RustOwnershipEnvironment,
  diagnostics: TargetDiagnostic[],
): AnalyzeRustMovesAndDropsResult {
  try {
    const universe = createPlaceUniverse(inventory, operations, input);
    const events = collectMoveEvents(flow, inventory, operations, input);
    const work = { placeEvaluations: 0 };
    const states = solveMoveStates(flow, events.byFlowPoint, universe, work);
    const unavailableAtNode = new WeakMap<Node, ReadonlySet<string>>();
    const reported = new Set<string>();
    for (const node of inventory.nodes) {
      const place = inventory.places.get(node);
      const unavailable = new Set<string>();
      let reached = false;
      for (const point of flow.pointsFor(node)) {
        const state = states.inStates[point.index];
        if (state === undefined) continue;
        reached = true;
        state.unavailable.forEach((key) => unavailable.add(key));
        if (place !== undefined && reads.get(node) !== undefined) {
          validateAvailable(
            place,
            node,
            requireRustOwnershipSourceIdentity(input.ast, node),
            state,
            universe,
            diagnostics,
            reported,
            work,
          );
        }
      }
      if (reached) unavailableAtNode.set(node, unavailable);
    }
    for (const record of operations.records) {
      let reached = false;
      for (const point of rustOwnershipOperationFlowPoints(record, flow)) {
        const state = states.inStates[point.index];
        if (state === undefined) continue;
        reached = true;
        if (record.operation.kind !== "store") {
          validateAvailable(
            record.operation.place,
            record.node,
            requireRustOwnershipSourceIdentity(input.ast, record.node),
            state,
            universe,
            diagnostics,
            reported,
            work,
          );
        }
      }
      if (!reached) continue;
      if (record.operation.kind === "move" &&
        record.operation.place.projections.length > 0) {
        const rootCarrier = universe.carrierByRoot.get(record.operation.place.rootId);
        if (rootCarrier !== undefined && environment.customDropProof(rootCarrier) !== undefined) {
          diagnostics.push(rustOwnershipDiagnostic(
            "RUST_PARTIAL_MOVE_OF_DROP_TYPE",
            "A value with an exact native Drop implementation cannot be partially moved.",
            record.node,
          ));
        }
      }
    }
    const dropResult = collectDropStates(
      flow,
      inventory,
      events.byFlowPoint,
      states.outStates,
      universe,
      environment,
      work,
      diagnostics,
    );
    const flowPointIndexById = new Map(flow.points.map((point) => [point.id, point.index]));
    return {
      kind: "resolved",
      analysis: Object.freeze<RustMoveAndDropAnalysis>({
        drops: dropResult.drops,
        dropObligations: dropResult.obligations,
        dropObligationsByRegion: dropResult.obligationsByRegion,
        dropsByNode: dropResult.dropsByNode,
        unavailableAtNode,
        placeMayBeAvailableAfter(flowPointId, place) {
          const pointIndex = flowPointIndexById.get(flowPointId);
          const state = pointIndex === undefined ? undefined : states.outStates[pointIndex];
          return state?.possiblyAvailable.has(rustPlaceKey(place)) === true;
        },
        placeIsWrittenWithin(callable, place) {
          return events.writtenPlacesByCallable.get(callable)?.get(place.rootId)?.some(
            (writtenPlace) => rustPlacesOverlap(writtenPlace, place),
          ) === true;
        },
      }),
    };
  } catch (error) {
    if (!(error instanceof RustMoveComplexityError)) throw error;
    return { kind: "rejected", diagnostic: error.diagnostic };
  }
}

function createPlaceUniverse(
  inventory: RustOwnershipNodeInventory,
  operations: RustOwnershipOperationInventory,
  input: RustOwnershipAnalysisInput,
): RustPlaceUniverse {
  const byKey = new Map<string, RustPlaceRef>();
  const carrierByRoot = new Map<string, RustTypeRef>();
  const regionByRoot = new Map<string, string>();
  let placeBudgetExceeded = false;
  const add = (place: RustPlaceRef, carrier?: RustTypeRef): void => {
    const key = rustPlaceKey(place);
    if (!byKey.has(key)) {
      if (byKey.size >= maximumTrackedOwnershipPlaces) {
        placeBudgetExceeded = true;
        return;
      }
      byKey.set(key, place);
    }
    if (carrier !== undefined && place.projections.length === 0 &&
      !carrierByRoot.has(place.rootId)) carrierByRoot.set(place.rootId, carrier);
  };
  for (const node of inventory.nodes) {
    const place = inventory.places.get(node);
    if (place !== undefined) {
      add(place, input.facts.getRuntimeCarrierFact(node)?.carrier ??
        input.facts.getRuntimeCarrierFact(input.navigation.sourceReferenceFor(node)?.declaration)?.carrier);
      const region = inventory.regionByNode.get(node)?.id;
      if (region !== undefined && !regionByRoot.has(place.rootId)) regionByRoot.set(place.rootId, region);
    }
  }
  for (const record of operations.records) add(record.operation.place, record.carrier);
  const observedPlaces = Object.freeze([...byKey.values()]);
  const expandableParents = new Set<string>();
  for (const place of observedPlaces) {
    for (let length = 0; length < place.projections.length; length += 1) {
      expandableParents.add(rustPlaceKey(Object.freeze({
        rootId: place.rootId,
        projections: Object.freeze(place.projections.slice(0, length)),
      })));
    }
  }
  const completeChildrenByParent = new Map<string, readonly string[]>();
  const pending: { readonly place: RustPlaceRef; readonly carrier: RustTypeRef }[] = [];
  for (const [rootId, carrier] of carrierByRoot) {
    const root = byKey.get(rootId);
    if (root !== undefined) pending.push({ place: root, carrier });
  }
  const expanded = new Set<string>();
  while (pending.length > 0 && !placeBudgetExceeded) {
    const { place, carrier } = pending.pop()!;
    const parentKey = rustPlaceKey(place);
    if (expanded.has(parentKey) || !expandableParents.has(parentKey)) continue;
    expanded.add(parentKey);
    const childrenResult = completeAggregateChildren(
      place,
      carrier,
      input,
      maximumTrackedOwnershipPlaces - byKey.size,
    );
    if (childrenResult.kind === "budget-exceeded") {
      placeBudgetExceeded = true;
      break;
    }
    if (childrenResult.kind === "not-aggregate" || childrenResult.children.length === 0) continue;
    const children = childrenResult.children;
    const childKeys = children.map(({ place: child, carrier: childCarrier }) => {
      add(child, childCarrier);
      const childKey = rustPlaceKey(child);
      if (expandableParents.has(childKey)) {
        pending.push({ place: child, carrier: childCarrier });
      }
      return childKey;
    });
    completeChildrenByParent.set(parentKey, Object.freeze(childKeys));
  }
  if (placeBudgetExceeded) {
    const diagnostic = rustOwnershipPlaceComplexityDiagnostic(byKey.size + 1);
    if (diagnostic !== undefined) throw new RustMoveComplexityError(diagnostic);
  }
  const byRoot = new Map<string, RustPlaceRef[]>();
  for (const place of byKey.values()) {
    const selected = byRoot.get(place.rootId) ?? [];
    selected.push(place);
    byRoot.set(place.rootId, selected);
  }
  return Object.freeze({
    places: Object.freeze([...byKey.values()]),
    byKey,
    byRoot: new Map([...byRoot].map(([root, places]) => [root, Object.freeze(places)])),
    regionByRoot,
    carrierByRoot,
    completeChildrenByParent,
  });
}

function completeAggregateChildren(
  parent: RustPlaceRef,
  carrier: RustTypeRef,
  input: RustOwnershipAnalysisInput,
  maximumChildren: number,
):
  | {
      readonly kind: "complete";
      readonly children: readonly {
        readonly place: RustPlaceRef;
        readonly carrier: RustTypeRef;
      }[];
    }
  | { readonly kind: "not-aggregate" }
  | { readonly kind: "budget-exceeded" } {
  const definition = input.projectTypes.definitionForCarrier(carrier);
  if (definition !== undefined) {
    const fields = requireDenseRustOwnershipNodes(
      input.ast.members(definition.declaration),
      "Project declaration contains an undefined member slot during move analysis.",
      definition.declaration,
    ).filter((member) =>
      !input.ast.hasModifierKind(member, "static") &&
      input.ast.kindName(member) === "KindPropertyDeclaration");
    if (fields.length > maximumChildren) return { kind: "budget-exceeded" };
    const children = fields.map((member) => {
      const declared = input.facts.getRuntimeCarrierFact(member)?.carrier;
      const fieldCarrier = declared === undefined
        ? undefined
        : input.projectTypes.instantiateMemberCarrier(member, carrier, declared);
      return fieldCarrier === undefined
        ? undefined
        : Object.freeze({
            place: rustProjectedPlace(
              parent,
              rustProjectFieldProjection(
                member,
                input.ast,
                `field:${requireRustOwnershipSourceIdentity(input.ast, member)}`,
              ),
            ),
            carrier: fieldCarrier,
          });
    });
    return children.some((child) => child === undefined)
      ? { kind: "not-aggregate" }
      : {
          kind: "complete",
          children: Object.freeze(children as readonly {
            readonly place: RustPlaceRef;
            readonly carrier: RustTypeRef;
          }[]),
        };
  }
  if (carrier.kind === "tuple") {
    return carrier.elements.length > maximumChildren
      ? { kind: "budget-exceeded" }
      : {
          kind: "complete",
          children: Object.freeze(carrier.elements.map((element, index) => Object.freeze({
            place: rustProjectedPlace(
              parent,
              Object.freeze({ kind: "tuple-field" as const, index }),
            ),
            carrier: element,
          }))),
        };
  }
  const fixed = rustFixedArrayCarrierValue(carrier);
  return fixed === undefined
    ? { kind: "not-aggregate" }
    : fixed.length > maximumChildren
      ? { kind: "budget-exceeded" }
      : {
          kind: "complete",
          children: Object.freeze(Array.from(
            { length: fixed.length },
            (_unused, index) => Object.freeze({
              place: rustProjectedPlace(
                parent,
                Object.freeze({ kind: "fixed-index" as const, index }),
              ),
              carrier: fixed.element,
            }),
          )),
        };
}

function collectMoveEvents(
  flow: RustSourceFlowGraph,
  inventory: RustOwnershipNodeInventory,
  operations: RustOwnershipOperationInventory,
  input: RustOwnershipAnalysisInput,
): {
  readonly byFlowPoint: ReadonlyMap<number, readonly RustMoveEvent[]>;
  readonly writtenPlacesByCallable: WeakMap<Node, ReadonlyMap<string, readonly RustPlaceRef[]>>;
} {
  const events = new Map<number, RustMoveEvent[]>();
  const mutableWrittenPlacesByCallable = new WeakMap<Node, Map<string, RustPlaceRef[]>>();
  const seen = new Set<string>();
  const appendAtPoint = (point: RustSourceFlowPoint, event: RustMoveEvent): void => {
    const key = `${point.id}\0${event.kind}\0${rustPlaceKey(event.place)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const selected = events.get(point.index) ?? [];
    selected.push(event);
    events.set(point.index, selected);
  };
  const append = (pointNode: Node, event: RustMoveEvent): void => {
    for (const point of flow.pointsFor(pointNode)) {
      appendAtPoint(point, event);
    }
    if (event.kind === "write") {
      const callable = inventory.callableOwnerByNode.get(event.node);
      if (callable !== undefined) {
        let byRoot = mutableWrittenPlacesByCallable.get(callable);
        if (byRoot === undefined) {
          byRoot = new Map();
          mutableWrittenPlacesByCallable.set(callable, byRoot);
        }
        const selected = byRoot.get(event.place.rootId) ?? [];
        selected.push(event.place);
        byRoot.set(event.place.rootId, selected);
      }
    }
  };
  for (const node of inventory.nodes) {
    const place = inventory.places.get(node);
    if (place === undefined) continue;
    const kind = input.ast.kindName(node);
    if (place.projections.length === 0 && isInitializedDeclarationKind(kind)) {
      append(node, {
        kind: "declare",
        place,
        initialized: kind === "KindParameter" || kind === "KindBindingElement" ||
          Node_Initializer(input.ast, node) !== undefined ||
          isIterationBindingDeclaration(node, input) ||
          isCatchBindingDeclaration(node, input),
        node,
      });
    }
    const write = enclosingWrite(node, input);
    if (write !== undefined) append(write, { kind: "write", place, node: write });
  }
  for (const record of operations.records) {
    if (record.operation.kind === "move") {
      for (const point of rustOwnershipOperationFlowPoints(record, flow)) {
        appendAtPoint(point, { kind: "move", place: record.operation.place, node: record.node });
      }
    } else if (record.operation.kind === "store" || record.operation.kind === "replace" ||
      record.operation.kind === "take") {
      append(record.node, { kind: "write", place: record.operation.place, node: record.node });
    }
  }
  const writtenPlacesByCallable = new WeakMap<Node, ReadonlyMap<string, readonly RustPlaceRef[]>>();
  for (const callable of inventory.nodes) {
    const byRoot = mutableWrittenPlacesByCallable.get(callable);
    if (byRoot === undefined) continue;
    writtenPlacesByCallable.set(callable, new Map([...byRoot].map(([rootId, places]) =>
      [rootId, Object.freeze(places)])));
  }
  return Object.freeze({
    byFlowPoint: new Map([...events].map(([index, selected]) => [index, Object.freeze(selected)])),
    writtenPlacesByCallable,
  });
}

function isCatchBindingDeclaration(
  node: Node,
  input: RustOwnershipAnalysisInput,
): boolean {
  const catchClause = input.ast.parent(node);
  return catchClause !== undefined && input.ast.kindName(catchClause) === "KindCatchClause" &&
    CatchClause_VariableDeclaration(input.ast, catchClause) === node;
}

function isIterationBindingDeclaration(
  node: Node,
  input: RustOwnershipAnalysisInput,
): boolean {
  if (input.ast.kindName(node) !== "KindVariableDeclaration") {
    return false;
  }
  const declarationList = input.ast.parent(node);
  const iteration = declarationList === undefined
    ? undefined
    : input.ast.parent(declarationList);
  const iterationKind = input.ast.kindName(iteration);
  return declarationList !== undefined && iteration !== undefined &&
    input.ast.kindName(declarationList) === "KindVariableDeclarationList" &&
    (iterationKind === "KindForInStatement" || iterationKind === "KindForOfStatement") &&
    ForInOrOfStatement_Initializer(input.ast, iteration) === declarationList;
}

function solveMoveStates(
  flow: RustSourceFlowGraph,
  events: ReadonlyMap<number, readonly RustMoveEvent[]>,
  universe: RustPlaceUniverse,
  work: { placeEvaluations: number },
): {
  readonly inStates: readonly (RustMoveState | undefined)[];
  readonly outStates: readonly (RustMoveState | undefined)[];
} {
  const inStates = new Array<RustMoveState | undefined>(flow.points.length);
  const outStates = new Array<RustMoveState | undefined>(flow.points.length);
  const pending = flow.points.filter((point) => point.kind === "entry").map((point) => point.index);
  const queued = new Set(pending);
  const chargedStates = new WeakSet<RustMoveState>();
  let cursor = 0;
  let evaluations = 0;
  let retainedStateMemberships = 0;
  const chargeState = (state: RustMoveState): void => {
    if (chargedStates.has(state)) return;
    chargedStates.add(state);
    retainedStateMemberships += state.unavailable.size + state.moved.size +
      state.possiblyAvailable.size;
    const diagnostic = rustMoveStateMembershipComplexityDiagnostic(retainedStateMemberships);
    if (diagnostic !== undefined) throw new RustMoveComplexityError(diagnostic);
  };
  while (cursor < pending.length) {
    evaluations += 1;
    if (evaluations > maximumMoveDataflowEvaluations) {
      const diagnostic = rustMoveDataflowComplexityDiagnostic(evaluations);
      if (diagnostic !== undefined) throw new RustMoveComplexityError(diagnostic);
    }
    const index = pending[cursor++]!;
    queued.delete(index);
    const point = flow.points[index]!;
    const predecessors = flow.predecessors(point).map((entry) => outStates[entry.index]).filter(
      (entry): entry is RustMoveState => entry !== undefined,
    );
    const incoming = point.kind === "entry"
      ? mergeMoveStates([emptyMoveState(), ...predecessors])
      : predecessors.length === 0
        ? undefined
        : mergeMoveStates(predecessors);
    if (incoming === undefined) continue;
    chargeState(incoming);
    inStates[index] = incoming;
    const outgoing = applyMoveEvents(incoming, events.get(index) ?? [], universe, work);
    chargeState(outgoing);
    if (moveStatesEqual(outStates[index], outgoing)) continue;
    outStates[index] = outgoing;
    for (const successor of flow.successors(point)) {
      if (!queued.has(successor.index)) {
        queued.add(successor.index);
        pending.push(successor.index);
      }
    }
  }
  return { inStates, outStates };
}

function applyMoveEvents(
  state: RustMoveState,
  events: readonly RustMoveEvent[],
  universe: RustPlaceUniverse,
  work: { placeEvaluations: number },
): RustMoveState {
  if (events.length === 0) return state;
  const unavailable = new Set(state.unavailable);
  const moved = new Set(state.moved);
  const possiblyAvailable = new Set(state.possiblyAvailable);
  for (const event of events) {
    const rootPlaces = universe.byRoot.get(event.place.rootId) ?? [];
    chargeMovePlaceEvaluations(work, rootPlaces.length, event.node);
    if (event.kind === "declare") {
      for (const place of rootPlaces) {
        const key = rustPlaceKey(place);
        if (event.initialized) unavailable.delete(key);
        else unavailable.add(key);
        if (event.initialized) possiblyAvailable.add(key);
        else possiblyAvailable.delete(key);
        moved.delete(key);
      }
      continue;
    }
    if (event.kind === "move") {
      for (const place of rootPlaces) {
        if (!rustPlacesOverlap(place, event.place)) continue;
        const key = rustPlaceKey(place);
        unavailable.add(key);
        possiblyAvailable.delete(key);
        moved.add(key);
      }
      continue;
    }
    for (const place of rootPlaces) {
      if (!placeIsEqualOrBelow(place, event.place)) continue;
      const key = rustPlaceKey(place);
      unavailable.delete(key);
      possiblyAvailable.add(key);
      moved.delete(key);
    }
    restoreCompleteAncestors(
      event.place,
      unavailable,
      moved,
      possiblyAvailable,
      universe,
    );
  }
  return Object.freeze({ unavailable, moved, possiblyAvailable });
}

function restoreCompleteAncestors(
  place: RustPlaceRef,
  unavailable: Set<string>,
  moved: Set<string>,
  possiblyAvailable: Set<string>,
  universe: RustPlaceUniverse,
): void {
  for (let length = place.projections.length - 1; length >= 0; length -= 1) {
    const parent: RustPlaceRef = Object.freeze({
      rootId: place.rootId,
      projections: Object.freeze(place.projections.slice(0, length)),
    });
    const parentKey = rustPlaceKey(parent);
    const children = universe.completeChildrenByParent.get(parentKey);
    if (children === undefined || children.some((child) => unavailable.has(child))) continue;
    unavailable.delete(parentKey);
    moved.delete(parentKey);
    possiblyAvailable.add(parentKey);
  }
}

function validateAvailable(
  place: RustPlaceRef,
  node: Node,
  nodeIdentity: string,
  state: RustMoveState,
  universe: RustPlaceUniverse,
  diagnostics: TargetDiagnostic[],
  reported: Set<string>,
  work: { placeEvaluations: number },
): void {
  const key = rustPlaceKey(place);
  if (!state.unavailable.has(key)) return;
  let moved = state.moved.has(key);
  if (!moved) {
    chargeMovePlaceEvaluations(work, state.moved.size, node);
    for (const movedKey of state.moved) {
      const movedPlace = universe.byKey.get(movedKey);
      if (movedPlace !== undefined && rustPlacesOverlap(movedPlace, place)) {
        moved = true;
        break;
      }
    }
  }
  const diagnosticKey = `${moved ? "move" : "init"}\0${key}\0${nodeIdentity}`;
  if (reported.has(diagnosticKey)) return;
  reported.add(diagnosticKey);
  diagnostics.push(rustOwnershipDiagnostic(
    moved ? "RUST_USE_AFTER_MOVE" : "RUST_USE_BEFORE_INITIALIZATION",
    moved
      ? "A Rust place is used after that exact place or an overlapping projection was moved."
      : "A Rust place is used before every required projection is initialized.",
    node,
  ));
}

function collectDropStates(
  flow: RustSourceFlowGraph,
  inventory: RustOwnershipNodeInventory,
  events: ReadonlyMap<number, readonly RustMoveEvent[]>,
  outStates: readonly (RustMoveState | undefined)[],
  universe: RustPlaceUniverse,
  environment: RustOwnershipEnvironment,
  work: { placeEvaluations: number },
  diagnostics: TargetDiagnostic[],
): {
  readonly drops: readonly RustDropState[];
  readonly obligations: readonly RustDropObligation[];
  readonly obligationsByRegion: ReadonlyMap<string, readonly RustDropObligation[]>;
  readonly dropsByNode: WeakMap<Node, readonly RustDropState[]>;
} {
  const drops: RustDropState[] = [];
  const obligations: RustDropObligation[] = [];
  const obligationsByRegion = new Map<string, RustDropObligation[]>();
  const dropsByNode = new WeakMap<Node, readonly RustDropState[]>();
  const rootsByRegion = new Map<string, readonly (readonly [string, readonly RustPlaceRef[]])[]>();
  const mutableRootsByRegion = new Map<string, (readonly [string, readonly RustPlaceRef[]])[]>();
  for (const [rootId, places] of universe.byRoot) {
    const regionId = universe.regionByRoot.get(rootId);
    if (regionId === undefined) continue;
    const selected = mutableRootsByRegion.get(regionId) ?? [];
    selected.push(Object.freeze([rootId, places] as const));
    mutableRootsByRegion.set(regionId, selected);
  }
  for (const [regionId, roots] of mutableRootsByRegion) {
    rootsByRegion.set(regionId, Object.freeze(roots));
  }
  const declarationPointByRoot = new Map<string, number>();
  for (const [pointIndex, selected] of events) {
    for (const event of selected) {
      if (event.kind === "declare" && event.place.projections.length === 0 &&
        !declarationPointByRoot.has(event.place.rootId)) {
        declarationPointByRoot.set(event.place.rootId, pointIndex);
      }
    }
  }
  const orderedRootsByRegion = new Map<string, readonly (readonly [string, readonly RustPlaceRef[]])[]>();
  for (const [regionId, roots] of rootsByRegion) {
    orderedRootsByRegion.set(regionId, Object.freeze([...roots].sort((left, right) => {
      const leftPoint = declarationPointByRoot.get(left[0]) ?? -1;
      const rightPoint = declarationPointByRoot.get(right[0]) ?? -1;
      return rightPoint - leftPoint || compareRustSemanticKeys(right[0], left[0]);
    })));
  }
  let dropProjectionComparisons = 0;
  const append = (
    point: RustSourceFlowPoint,
    place: RustPlaceRef,
    state: RustDropState["state"],
    node?: Node,
    exactRegion?: import("../../target-model/semantics/index.js").RustRegionRef,
  ): void => {
    if (drops.length >= maximumDropStates) {
      const diagnostic = rustDropStateComplexityDiagnostic(drops.length + 1);
      if (diagnostic !== undefined) throw new RustMoveComplexityError(diagnostic);
      return;
    }
    const flowState = outStates[point.index] ?? emptyMoveState();
    const rootPlaces = universe.byRoot.get(place.rootId) ?? [];
    dropProjectionComparisons += rootPlaces.length * 2;
    if (!Number.isSafeInteger(dropProjectionComparisons) ||
      dropProjectionComparisons > maximumDropProjectionComparisons) {
      const diagnostic = rustDropProjectionComplexityDiagnostic(dropProjectionComparisons);
      if (diagnostic !== undefined) throw new RustMoveComplexityError(diagnostic);
      return;
    }
    const selectedNode = node ?? point.node;
    const region = exactRegion ??
      (selectedNode === undefined ? undefined : inventory.regionByNode.get(selectedNode)) ??
      (point.lexicalRegionId === undefined
        ? Object.freeze({ id: point.regionId, kind: "flow" as const })
        : inventory.lexicalRegions.regionById(point.lexicalRegionId) ??
          Object.freeze({ id: point.lexicalRegionId, kind: "lexical" as const }));
    const selected = Object.freeze({
      place,
      state,
      region,
      flowPointId: point.id,
      movedProjections: Object.freeze(rootPlaces.filter((candidate) =>
        candidate.projections.length > 0 && flowState.moved.has(rustPlaceKey(candidate)))),
      initializedProjections: Object.freeze(rootPlaces.filter((candidate) =>
        candidate.projections.length > 0 && !flowState.unavailable.has(rustPlaceKey(candidate)))),
    });
    drops.push(selected);
    if (node !== undefined) {
      dropsByNode.set(node, Object.freeze([...(dropsByNode.get(node) ?? []), selected]));
    }
  };
  for (const point of flow.points) {
    const selectedEvents = events.get(point.index) ?? [];
    const flowState = outStates[point.index];
    if (flowState === undefined) continue;
    for (const event of selectedEvents) {
      const key = rustPlaceKey(event.place);
      const state: RustDropState["state"] = flowState.unavailable.has(key)
        ? flowState.moved.has(key)
          ? event.place.projections.length === 0 ? "moved" : "partially-moved"
          : "uninitialized"
        : "initialized";
      append(point, event.place, state, event.node);
    }
    for (const successor of flow.successors(point)) {
      for (const region of inventory.lexicalRegions.exitedRegions(
        point.lexicalRegionId,
        successor.lexicalRegionId,
      )) {
        const roots = orderedRootsByRegion.get(region.id) ?? [];
        let order = 0;
        for (const [rootId, places] of roots) {
          chargeMovePlaceEvaluations(work, places.length, point.node);
          const root = places.find((place) => place.projections.length === 0);
          if (root === undefined) continue;
          const unavailable = flowState.unavailable.has(rootId);
          const possiblyAvailable = flowState.possiblyAvailable.has(rootId);
          const initializedChildren = places.filter((candidate) =>
            candidate.projections.length > 0 &&
            flowState.possiblyAvailable.has(rustPlaceKey(candidate)));
          const state: RustDropState["state"] = !unavailable
            ? "dropped"
            : possiblyAvailable
              ? "conditionally-initialized"
              : initializedChildren.length > 0
                ? "partially-moved"
                : flowState.moved.has(rootId)
                  ? "moved"
                  : "uninitialized";
          append(point, root, state, undefined, region);
          const carrier = universe.carrierByRoot.get(rootId);
          const action = state === "dropped"
            ? "drop" as const
            : state === "partially-moved"
              ? "drop-remaining-fields" as const
              : state === "conditionally-initialized"
                ? "conditional-drop" as const
                : undefined;
          if (carrier === undefined || action === undefined) continue;
          const dropLifetime = Object.freeze({
            kind: "inferred-region" as const,
            regionId: region.id,
          });
          const customDropProof = environment.customDropProof(carrier);
          if (customDropProof !== undefined &&
            !environment.typeOutlives(carrier, dropLifetime)) {
            diagnostics.push(rustOwnershipDiagnostic(
              "RUST_DROP_CHECK_OUTLIVES_NOT_PROVEN",
              "A value may reach native drop after one of its exact contained lifetimes has ended.",
            ));
            continue;
          }
          const requiredOutlives = collectTypeLifetimes(carrier);
          const obligation = Object.freeze({
            place: root,
            carrier,
            region,
            flowPointId: point.id,
            successorPointId: successor.id,
            order,
            action,
            requiredOutlives,
            ...(customDropProof === undefined ? {} : { customDropProof }),
          });
          order += 1;
          if (obligations.length >= maximumDropObligations) {
            const diagnostic = rustDropObligationComplexityDiagnostic(obligations.length + 1);
            if (diagnostic !== undefined) throw new RustMoveComplexityError(diagnostic);
            break;
          }
          obligations.push(obligation);
          const selected = obligationsByRegion.get(region.id) ?? [];
          selected.push(obligation);
          obligationsByRegion.set(region.id, selected);
        }
      }
    }
  }
  return {
    drops: Object.freeze(drops),
    obligations: Object.freeze(obligations),
    obligationsByRegion: new Map([...obligationsByRegion].map(([region, selected]) =>
      [region, Object.freeze(selected)])),
    dropsByNode,
  };
}

function chargeMovePlaceEvaluations(
  work: { placeEvaluations: number },
  count: number,
  node?: Node,
): void {
  work.placeEvaluations += count;
  if (Number.isSafeInteger(work.placeEvaluations) &&
    work.placeEvaluations <= maximumMovePlaceEvaluations) return;
  const diagnostic = rustMovePlaceEvaluationComplexityDiagnostic(
    work.placeEvaluations,
    node,
  );
  if (diagnostic !== undefined) throw new RustMoveComplexityError(diagnostic);
}

function mergeMoveStates(states: readonly RustMoveState[]): RustMoveState {
  if (states.length === 1) return states[0]!;
  const unavailable = new Set<string>();
  const moved = new Set<string>();
  const possiblyAvailable = new Set<string>();
  for (const state of states) {
    state.unavailable.forEach((key) => unavailable.add(key));
    state.moved.forEach((key) => moved.add(key));
    state.possiblyAvailable.forEach((key) => possiblyAvailable.add(key));
  }
  return Object.freeze({ unavailable, moved, possiblyAvailable });
}

function emptyMoveState(): RustMoveState {
  return Object.freeze({
    unavailable: new Set<string>(),
    moved: new Set<string>(),
    possiblyAvailable: new Set<string>(),
  });
}

function moveStatesEqual(left: RustMoveState | undefined, right: RustMoveState): boolean {
  return left !== undefined && setsEqual(left.unavailable, right.unavailable) &&
    setsEqual(left.moved, right.moved) &&
    setsEqual(left.possiblyAvailable, right.possiblyAvailable);
}

function collectTypeLifetimes(type: RustTypeRef): readonly RustLifetimeRef[] {
  const selected = new Map<string, RustLifetimeRef>();
  const addLifetime = (lifetime: RustLifetimeRef): void => {
    selected.set(rustLifetimeSemanticKey(lifetime), lifetime);
  };
  const visit = (candidate: RustTypeRef): void => {
    switch (candidate.kind) {
      case "reference":
        addLifetime(candidate.lifetime);
        visit(candidate.target);
        return;
      case "path":
        for (const argument of candidate.arguments) {
          if (argument.kind === "lifetime") addLifetime(argument.value);
          else if (argument.kind === "type") visit(argument.value);
        }
        return;
      case "array":
      case "sequence":
      case "slice":
        visit(candidate.element);
        return;
      case "tuple":
        candidate.elements.forEach(visit);
        return;
      case "raw-pointer":
        visit(candidate.target);
        return;
      case "function-pointer":
      case "closure":
        candidate.parameters.forEach(visit);
        visit(candidate.result);
        if (candidate.kind === "closure") {
          for (const capture of candidate.captures) {
            if (capture.kind === "lifetime") addLifetime(capture.value);
          }
        }
        return;
      case "trait-object":
        addLifetime(candidate.lifetime);
        return;
      case "opaque":
        for (const capture of candidate.captures) {
          if (capture.kind === "lifetime") addLifetime(capture.value);
        }
        return;
      case "associated-type":
        visit(candidate.owner);
        for (const argument of candidate.arguments) {
          if (argument.kind === "lifetime") addLifetime(argument.value);
          else if (argument.kind === "type") visit(argument.value);
        }
        return;
      case "source-carrier": {
        if (isRustNullishSourceCarrier(candidate)) return;
        const sourceType = rustSourceTypeCarrierValue(candidate);
        if (sourceType !== undefined) {
          for (const argument of sourceType.genericArguments) {
            if (argument.kind === "lifetime") addLifetime(argument.value);
            else if (argument.kind === "type") visit(argument.value);
          }
          return;
        }
        const structuralObject = rustStructuralObjectCarrierValue(candidate);
        if (structuralObject !== undefined) {
          structuralObject.fields.forEach((field) => visit(field.type));
          return;
        }
        const sourceUnion = rustSourceUnionCarrierValue(candidate);
        sourceUnion?.variants.forEach((variant) => visit(variant.carrier));
        return;
      }
      default:
        return;
    }
  };
  visit(type);
  return Object.freeze([...selected.values()]);
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const entry of left) {
    if (!right.has(entry)) return false;
  }
  return true;
}

function isInitializedDeclarationKind(kind: string): boolean {
  return kind === "KindVariableDeclaration" || kind === "KindBindingElement" ||
    kind === "KindParameter" || kind === "KindPropertyDeclaration";
}

function enclosingWrite(node: Node, input: RustOwnershipAnalysisInput): Node | undefined {
  let current = node;
  for (;;) {
    const parent = input.ast.parent(current);
    if (parent === undefined || isCallableKind(input.ast.kindName(parent))) return undefined;
    const kind = input.ast.kindName(parent);
    if (kind === "KindBinaryExpression" && BinaryExpression_Left(input.ast, parent) === current &&
      isAssignmentOperator(input.ast.operatorKindName(parent))) return parent;
    if ((kind === "KindPrefixUnaryExpression" || kind === "KindPostfixUnaryExpression") &&
      Node_Operand(input.ast, parent) === current) return parent;
    if (isTransparent(kind)) {
      current = parent;
      continue;
    }
    if ((kind === "KindPropertyAccessExpression" || kind === "KindElementAccessExpression") &&
      Node_Expression(input.ast, parent) === current) return undefined;
    return undefined;
  }
}

function isAssignmentOperator(kind: string | undefined): boolean {
  return kind !== undefined && assignmentOperatorKinds.has(kind);
}

const assignmentOperatorKinds = new Set([
  "KindEqualsToken",
  "KindPlusEqualsToken",
  "KindMinusEqualsToken",
  "KindAsteriskEqualsToken",
  "KindAsteriskAsteriskEqualsToken",
  "KindSlashEqualsToken",
  "KindPercentEqualsToken",
  "KindLessThanLessThanEqualsToken",
  "KindGreaterThanGreaterThanEqualsToken",
  "KindGreaterThanGreaterThanGreaterThanEqualsToken",
  "KindAmpersandEqualsToken",
  "KindBarEqualsToken",
  "KindCaretEqualsToken",
  "KindBarBarEqualsToken",
  "KindAmpersandAmpersandEqualsToken",
  "KindQuestionQuestionEqualsToken",
]);

function isTransparent(kind: string): boolean {
  return kind === "KindParenthesizedExpression" || kind === "KindAsExpression" ||
    kind === "KindSatisfiesExpression" || kind === "KindNonNullExpression" ||
    kind === "KindTypeAssertionExpression";
}

function isCallableKind(kind: string): boolean {
  return kind === "KindFunctionDeclaration" || kind === "KindFunctionExpression" ||
    kind === "KindArrowFunction" || kind === "KindMethodDeclaration" ||
    kind === "KindConstructor" || kind === "KindGetAccessor" || kind === "KindSetAccessor";
}

function placeIsEqualOrBelow(candidate: RustPlaceRef, parent: RustPlaceRef): boolean {
  return rustPlaceContains(parent, candidate);
}

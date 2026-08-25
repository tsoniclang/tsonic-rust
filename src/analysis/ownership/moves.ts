import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  BinaryExpression_Left,
  ForInOrOfStatement_Initializer,
  Node_Expression,
  Node_Initializer,
  Node_Operand,
  sourceNodeIdentity,
} from "@tsonic/target-api/source";
import type {
  RustDropObligation,
  RustDropState,
  RustLifetimeRef,
  RustPlaceRef,
  RustTypeRef,
  RustValueReadDisposition,
} from "../../target-model/semantics/index.js";
import { rustLifetimeSemanticKey } from "../../target-model/semantics/index.js";
import {
  isRustNullishSourceCarrier,
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
import {
  rustPlaceKey,
  rustPlaceContains,
  rustPlacesOverlap,
  rustProjectedPlace,
  rustProjectFieldProjection,
} from "./places.js";

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
  readonly dropByNode: WeakMap<Node, RustDropState>;
  readonly unavailableAtNode: WeakMap<Node, ReadonlySet<string>>;
}

export function analyzeRustMovesAndDrops(
  flow: RustSourceFlowGraph,
  inventory: RustOwnershipNodeInventory,
  operations: RustOwnershipOperationInventory,
  reads: WeakMap<Node, RustValueReadDisposition>,
  input: RustOwnershipAnalysisInput,
  environment: RustOwnershipEnvironment,
  diagnostics: TargetDiagnostic[],
): RustMoveAndDropAnalysis {
  const universe = createPlaceUniverse(inventory, operations, input);
  const events = collectMoveEvents(flow, inventory, operations, input);
  const states = solveMoveStates(flow, events, universe);
  const unavailableAtNode = new WeakMap<Node, ReadonlySet<string>>();
  const reported = new Set<string>();
  for (const node of inventory.nodes) {
    const point = flow.pointFor(node);
    if (point === undefined) continue;
    const state = states.inStates[point.index];
    if (state === undefined) continue;
    unavailableAtNode.set(node, state.unavailable);
    const place = inventory.places.get(node);
    if (place === undefined || reads.get(node) === undefined) continue;
    validateAvailable(
      place,
      node,
      sourceNodeIdentity(input.ast, node) ?? `${input.ast.pos(node)}:${input.ast.end(node)}`,
      state,
      universe,
      diagnostics,
      reported,
    );
  }
  for (const record of operations.records) {
    const point = flow.pointFor(record.node);
    const state = point === undefined ? undefined : states.inStates[point.index];
    if (state === undefined || record.operation.kind === "store") continue;
    validateAvailable(
      record.operation.place,
      record.node,
      sourceNodeIdentity(input.ast, record.node) ??
        `${input.ast.pos(record.node)}:${input.ast.end(record.node)}`,
      state,
      universe,
      diagnostics,
      reported,
    );
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
    events,
    states.outStates,
    universe,
    environment,
    diagnostics,
  );
  return Object.freeze({
    drops: dropResult.drops,
    dropObligations: dropResult.obligations,
    dropObligationsByRegion: dropResult.obligationsByRegion,
    dropByNode: dropResult.dropByNode,
    unavailableAtNode,
  });
}

function createPlaceUniverse(
  inventory: RustOwnershipNodeInventory,
  operations: RustOwnershipOperationInventory,
  input: RustOwnershipAnalysisInput,
): RustPlaceUniverse {
  const byKey = new Map<string, RustPlaceRef>();
  const carrierByRoot = new Map<string, import("../../target-model/semantics/index.js").RustTypeRef>();
  const regionByRoot = new Map<string, string>();
  const add = (place: RustPlaceRef, carrier?: import("../../target-model/semantics/index.js").RustTypeRef): void => {
    byKey.set(rustPlaceKey(place), place);
    if (carrier !== undefined && !carrierByRoot.has(place.rootId)) carrierByRoot.set(place.rootId, carrier);
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
  const completeChildrenByParent = new Map<string, readonly string[]>();
  for (const [rootId, carrier] of carrierByRoot) {
    const root = byKey.get(rootId);
    if (root === undefined) continue;
    const definition = input.projectTypes.definitionForCarrier(carrier);
    if (definition !== undefined) {
      const children = input.ast.members(definition.declaration).filter((member): member is Node =>
        member !== undefined && input.ast.kindName(member) === "KindPropertyDeclaration").map((member) => {
          const child = rustProjectedPlace(
            root,
            rustProjectFieldProjection(member, input.ast, `field:${input.ast.pos(member)}`),
          );
          add(child);
          return rustPlaceKey(child);
        });
      if (children.length > 0) completeChildrenByParent.set(rootId, Object.freeze(children));
      continue;
    }
    if (carrier.kind === "tuple") {
      const children = carrier.elements.map((_element, index) => {
        const child = rustProjectedPlace(root, Object.freeze({ kind: "tuple-field" as const, index }));
        add(child);
        return rustPlaceKey(child);
      });
      if (children.length > 0) completeChildrenByParent.set(rootId, Object.freeze(children));
    }
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

function collectMoveEvents(
  flow: RustSourceFlowGraph,
  inventory: RustOwnershipNodeInventory,
  operations: RustOwnershipOperationInventory,
  input: RustOwnershipAnalysisInput,
): ReadonlyMap<number, readonly RustMoveEvent[]> {
  const events = new Map<number, RustMoveEvent[]>();
  const seen = new Set<string>();
  const append = (pointNode: Node, event: RustMoveEvent): void => {
    const point = flow.pointFor(pointNode);
    if (point === undefined) return;
    const key = `${point.id}\0${event.kind}\0${rustPlaceKey(event.place)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const selected = events.get(point.index) ?? [];
    selected.push(event);
    events.set(point.index, selected);
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
          isIterationBindingDeclaration(node, input),
        node,
      });
    }
    const write = enclosingWrite(node, input);
    if (write !== undefined) append(write, { kind: "write", place, node: write });
  }
  for (const record of operations.records) {
    if (record.operation.kind === "move") {
      append(record.node, { kind: "move", place: record.operation.place, node: record.node });
    } else if (record.operation.kind === "store" || record.operation.kind === "replace") {
      append(record.node, { kind: "write", place: record.operation.place, node: record.node });
    }
  }
  return new Map([...events].map(([index, selected]) => [index, Object.freeze(selected)]));
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
): {
  readonly inStates: readonly (RustMoveState | undefined)[];
  readonly outStates: readonly (RustMoveState | undefined)[];
} {
  const inStates = new Array<RustMoveState | undefined>(flow.points.length);
  const outStates = new Array<RustMoveState | undefined>(flow.points.length);
  const pending = flow.points.filter((point) => point.kind === "entry").map((point) => point.index);
  const queued = new Set(pending);
  while (pending.length > 0) {
    const index = pending.shift()!;
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
    inStates[index] = incoming;
    const outgoing = applyMoveEvents(incoming, events.get(index) ?? [], universe);
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
): RustMoveState {
  const unavailable = new Set(state.unavailable);
  const moved = new Set(state.moved);
  const possiblyAvailable = new Set(state.possiblyAvailable);
  for (const event of events) {
    const rootPlaces = universe.byRoot.get(event.place.rootId) ?? [];
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
): void {
  const key = rustPlaceKey(place);
  if (!state.unavailable.has(key)) return;
  const moved = state.moved.has(key) || [...state.moved].some((movedKey) => {
    const movedPlace = universe.byKey.get(movedKey);
    return movedPlace !== undefined && rustPlacesOverlap(movedPlace, place);
  });
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
  diagnostics: TargetDiagnostic[],
): {
  readonly drops: readonly RustDropState[];
  readonly obligations: readonly RustDropObligation[];
  readonly obligationsByRegion: ReadonlyMap<string, readonly RustDropObligation[]>;
  readonly dropByNode: WeakMap<Node, RustDropState>;
} {
  const drops: RustDropState[] = [];
  const obligations: RustDropObligation[] = [];
  const obligationsByRegion = new Map<string, RustDropObligation[]>();
  const dropByNode = new WeakMap<Node, RustDropState>();
  const append = (
    point: RustSourceFlowPoint,
    place: RustPlaceRef,
    state: RustDropState["state"],
    node?: Node,
    exactRegion?: import("../../target-model/semantics/index.js").RustRegionRef,
  ): void => {
    const flowState = outStates[point.index] ?? emptyMoveState();
    const rootPlaces = universe.byRoot.get(place.rootId) ?? [];
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
    if (node !== undefined) dropByNode.set(node, selected);
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
        const roots = [...universe.byRoot].filter(([rootId]) =>
          universe.regionByRoot.get(rootId) === region.id).sort((left, right) => {
          const leftPoint = declarationPointIndex(left[0], events);
          const rightPoint = declarationPointIndex(right[0], events);
          return rightPoint - leftPoint || right[0].localeCompare(left[0]);
        });
        let order = 0;
        for (const [rootId, places] of roots) {
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
    dropByNode,
  };
}

function mergeMoveStates(states: readonly RustMoveState[]): RustMoveState {
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

function declarationPointIndex(
  rootId: string,
  events: ReadonlyMap<number, readonly RustMoveEvent[]>,
): number {
  for (const [pointIndex, selected] of events) {
    if (selected.some((event) => event.kind === "declare" &&
      event.place.rootId === rootId && event.place.projections.length === 0)) {
      return pointIndex;
    }
  }
  return -1;
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
  return left.size === right.size && [...left].every((entry) => right.has(entry));
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

import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type {
  RustPinState,
  RustPlaceRef,
  RustTypeRef,
} from "../../target-model/semantics/index.js";
import { rustUnpinTrait } from "../../target-model/types/index.js";
import type { RustSourceFlowGraph } from "./control-flow.js";
import type {
  RustOwnershipAnalysisInput,
  RustOwnershipEnvironment,
} from "./context.js";
import { rustOwnershipDiagnostic } from "./diagnostics.js";
import type { RustOwnershipNodeInventory } from "./inventory.js";
import type { RustOwnershipOperationInventory } from "./operations.js";
import {
  rustOwnershipOperationFlowPoints,
  rustOwnershipTraitProof,
} from "./operations.js";
import { requireRustOwnershipSourceIdentity } from "./identity.js";

export interface RustPinAnalysis {
  readonly pins: readonly RustPinState[];
  readonly pinsByNode: WeakMap<Node, readonly RustPinState[]>;
}

export function analyzeRustPinning(
  flow: RustSourceFlowGraph,
  inventory: RustOwnershipNodeInventory,
  operations: RustOwnershipOperationInventory,
  input: RustOwnershipAnalysisInput,
  environment: RustOwnershipEnvironment,
  diagnostics: TargetDiagnostic[],
): RustPinAnalysis {
  const byRoot = new Map<string, {
    readonly node: Node;
    readonly place: RustPlaceRef;
    readonly carrier: RustTypeRef;
    readonly pointee: RustTypeRef;
    readonly pointIndex: number;
  }[]>();
  for (const node of inventory.nodes) {
    const place = inventory.places.get(node);
    const carrier = input.facts.getRuntimeCarrierFact(node)?.carrier ??
      input.facts.getRuntimeCarrierFact(input.navigation.sourceReferenceFor(node)?.declaration)?.carrier;
    const pointer = carrier === undefined ? undefined : environment.pinPointerCarrier(carrier);
    const points = flow.pointsFor(node);
    if (place === undefined || carrier === undefined || pointer === undefined || points.length === 0) continue;
    const pointee = pointer.kind === "reference" || pointer.kind === "raw-pointer"
      ? pointer.target
      : pointer;
    const candidates = byRoot.get(place.rootId) ?? [];
    for (const point of points) {
      candidates.push({ node, place, carrier, pointee, pointIndex: point.index });
    }
    byRoot.set(place.rootId, candidates);
  }
  const pins: RustPinState[] = [];
  const pinsByNode = new WeakMap<Node, readonly RustPinState[]>();
  const pinsByRoot = new Map<string, readonly RustPinState[]>();
  const pointById = new Map(flow.points.map((point) => [point.id, point] as const));
  for (const entries of byRoot.values()) {
    const initialEntries = entries.filter((entry) => {
      const point = flow.points[entry.pointIndex]!;
      return !entries.some((candidate) => {
        if (candidate === entry) return false;
        const candidatePoint = flow.points[candidate.pointIndex]!;
        if (!flow.reaches(candidatePoint, point)) return false;
        return !flow.reaches(point, candidatePoint) || candidate.pointIndex < entry.pointIndex;
      });
    });
    const rootPins: RustPinState[] = [];
    for (const entry of initialEntries) {
      const point = flow.points[entry.pointIndex]!;
      const evidenceId = requireRustOwnershipSourceIdentity(input.ast, entry.node);
      const movementProof = environment.supportsTrait(entry.pointee, rustUnpinTrait)
        ? rustOwnershipTraitProof(rustUnpinTrait, entry.pointee, evidenceId)
        : undefined;
      const pin = Object.freeze({
        place: entry.place,
        carrier: entry.carrier,
        pointee: entry.pointee,
        pinnedAtPointId: point.id,
        ...(movementProof === undefined ? {} : { movementProof }),
      });
      pins.push(pin);
      rootPins.push(pin);
      for (const node of inventory.nodesByRoot.get(entry.place.rootId) ?? Object.freeze([])) {
        const selectedPoints = flow.pointsFor(node);
        if (selectedPoints.some((selectedPoint) =>
          selectedPoint.index === point.index || flow.reaches(point, selectedPoint))) {
          const selected = pinsByNode.get(node) ?? [];
          if (!selected.some((existing) => existing.pinnedAtPointId === pin.pinnedAtPointId)) {
            pinsByNode.set(node, Object.freeze([...selected, pin]));
          }
        }
      }
    }
    if (rootPins.length > 0) pinsByRoot.set(entries[0]!.place.rootId, Object.freeze(rootPins));
  }
  for (const record of operations.records) {
    if (record.operation.kind !== "move" ||
      !movesBehindPinnedPointer(record.operation.place)) continue;
    const selectedPins = pinsByRoot.get(record.operation.place.rootId) ?? [];
    const movePoints = rustOwnershipOperationFlowPoints(record, flow);
    if (selectedPins.some((pin) => {
      const pinPoint = pointById.get(pin.pinnedAtPointId);
      return pin.movementProof === undefined && pinPoint !== undefined &&
        movePoints.some((movePoint) =>
          pinPoint.index === movePoint.index || flow.reaches(pinPoint, movePoint));
    })) {
      diagnostics.push(rustOwnershipDiagnostic(
        "RUST_MOVE_BEHIND_PIN_REQUIRES_UNPIN",
        "Moving a projected value behind Pin requires exact Unpin evidence for the pinned pointee.",
        record.node,
      ));
    }
  }
  return Object.freeze({ pins: Object.freeze(pins), pinsByNode });
}

function movesBehindPinnedPointer(place: RustPlaceRef): boolean {
  return place.projections.some((projection) => projection.kind === "dereference");
}

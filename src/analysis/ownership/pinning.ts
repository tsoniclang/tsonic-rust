import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
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
import { rustOwnershipTraitProof } from "./operations.js";

export interface RustPinAnalysis {
  readonly pins: readonly RustPinState[];
  readonly pinByNode: WeakMap<Node, RustPinState>;
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
  }>();
  for (const node of inventory.nodes) {
    const place = inventory.places.get(node);
    const carrier = input.facts.getRuntimeCarrierFact(node)?.carrier ??
      input.facts.getRuntimeCarrierFact(input.navigation.sourceReferenceFor(node)?.declaration)?.carrier;
    const pointer = carrier === undefined ? undefined : environment.pinPointerCarrier(carrier);
    const point = flow.pointFor(node);
    if (place === undefined || carrier === undefined || pointer === undefined || point === undefined) continue;
    const pointee = pointer.kind === "reference" || pointer.kind === "raw-pointer"
      ? pointer.target
      : pointer;
    const existing = byRoot.get(place.rootId);
    if (existing === undefined || point.index < existing.pointIndex) {
      byRoot.set(place.rootId, { node, place, carrier, pointee, pointIndex: point.index });
    }
  }
  const pins: RustPinState[] = [];
  const pinByNode = new WeakMap<Node, RustPinState>();
  for (const entry of byRoot.values()) {
    const point = flow.points[entry.pointIndex]!;
    const evidenceId = sourceNodeIdentity(input.ast, entry.node) ?? point.id;
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
    pinByNode.set(entry.node, pin);
    for (const node of inventory.nodes) {
      const selectedPoint = flow.pointFor(node);
      if (inventory.places.get(node)?.rootId === entry.place.rootId &&
        selectedPoint !== undefined &&
        (selectedPoint.index === point.index || flow.reaches(point, selectedPoint))) {
        pinByNode.set(node, pin);
      }
    }
  }
  for (const record of operations.records) {
    if (record.operation.kind !== "move" ||
      !movesBehindPinnedPointer(record.operation.place)) continue;
    const pin = pins.find((candidate) => candidate.place.rootId === record.operation.place.rootId);
    const pinPoint = pin === undefined
      ? undefined
      : flow.points.find((point) => point.id === pin.pinnedAtPointId);
    const movePoint = flow.pointFor(record.node);
    if (pin !== undefined && pin.movementProof === undefined &&
      pinPoint !== undefined && movePoint !== undefined &&
      (pinPoint.index === movePoint.index || flow.reaches(pinPoint, movePoint))) {
      diagnostics.push(rustOwnershipDiagnostic(
        "RUST_MOVE_BEHIND_PIN_REQUIRES_UNPIN",
        "Moving a projected value behind Pin requires exact Unpin evidence for the pinned pointee.",
        record.node,
      ));
    }
  }
  return Object.freeze({ pins: Object.freeze(pins), pinByNode });
}

function movesBehindPinnedPointer(place: RustPlaceRef): boolean {
  return place.projections.some((projection) => projection.kind === "dereference");
}

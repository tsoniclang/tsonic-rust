import type { Node, SourceFile } from "@tsonic/tsts";
import {
  maximumFlowQuerySteps,
  maximumFlowReachabilityCacheEntries,
  rustFlowEdgeComplexityDiagnostic,
  rustFlowPointComplexityDiagnostic,
} from "./complexity.js";
import {
  FlowLimitError,
  RustSourceFlowQueryLimitError,
} from "./control-flow-errors.js";
import type {
  RustSourceFlowGraph,
  RustSourceFlowPoint,
} from "./control-flow.js";

interface RustSourceFlowRegionRecord {
  readonly owner: SourceFile | Node;
  readonly regionId: string;
  readonly entry: number;
  readonly exit: number;
}

export class RustSourceFlowGraphDraft {
  readonly #points: RustSourceFlowPoint[] = [];
  readonly #pointsByNode = new WeakMap<Node, number[]>();
  readonly #successors: number[][] = [];
  readonly #predecessors: number[][] = [];
  readonly #regionByNode = new WeakMap<Node, string>();
  readonly #regionByOwner = new WeakMap<Node, RustSourceFlowRegionRecord>();
  #edgeCount = 0;

  get pointCount(): number {
    return this.#points.length;
  }

  pointOccurrenceCount(node: Node): number {
    return this.#pointsByNode.get(node)?.length ?? 0;
  }

  recordPointForNode(node: Node, point: number, regionId: string): void {
    const points = this.#pointsByNode.get(node) ?? [];
    points.push(point);
    this.#pointsByNode.set(node, points);
    this.#regionByNode.set(node, regionId);
  }

  setRegionForNode(node: Node, regionId: string): void {
    this.#regionByNode.set(node, regionId);
  }

  registerRegion(record: RustSourceFlowRegionRecord): void {
    this.#regionByOwner.set(record.owner, record);
  }

  appendPoint(point: Omit<RustSourceFlowPoint, "index">): number {
    const pointDiagnostic = rustFlowPointComplexityDiagnostic(this.#points.length + 1);
    if (pointDiagnostic !== undefined) {
      throw new FlowLimitError(pointDiagnostic.code, pointDiagnostic.message);
    }
    const index = this.#points.length;
    this.#points.push(Object.freeze({ ...point, index }));
    this.#successors.push([]);
    this.#predecessors.push([]);
    return index;
  }

  connect(from: number, to: number): void {
    const successors = this.#successors[from]!;
    if (successors.includes(to)) return;
    const edgeDiagnostic = rustFlowEdgeComplexityDiagnostic(this.#edgeCount + 1);
    if (edgeDiagnostic !== undefined) {
      throw new FlowLimitError(edgeDiagnostic.code, edgeDiagnostic.message);
    }
    successors.push(to);
    this.#predecessors[to]!.push(from);
    this.#edgeCount += 1;
  }

  seal(): RustSourceFlowGraph {
    const points = Object.freeze([...this.#points]);
    const pointIndexes = new WeakMap<object, number>();
    points.forEach((point) => pointIndexes.set(point, point.index));
    const successors = Object.freeze(this.#successors.map((entries) => Object.freeze([...entries])));
    const predecessors = Object.freeze(this.#predecessors.map((entries) => Object.freeze([...entries])));
    const cyclic = computeCyclicPoints(successors, predecessors);
    const reachability = new Map<string, boolean>();
    let querySteps = 0;
    const chargeQuerySteps = (count: number): void => {
      querySteps += count;
      if (!Number.isSafeInteger(querySteps) || querySteps > maximumFlowQuerySteps) {
        throw new RustSourceFlowQueryLimitError(querySteps);
      }
    };
    const cacheReachability = (key: string, value: boolean): void => {
      if (reachability.size < maximumFlowReachabilityCacheEntries) {
        reachability.set(key, value);
      }
    };
    const pointIndices = (value: Node | RustSourceFlowPoint): readonly number[] => {
      const exact = pointIndexes.get(value);
      if (exact !== undefined) return Object.freeze([exact]);
      return Object.freeze([...(this.#pointsByNode.get(value as Node) ?? [])]);
    };
    const reachesIndex = (from: number, to: number): boolean => {
      const key = `${from}:${to}`;
      const cached = reachability.get(key);
      if (cached !== undefined) return cached;
      if (from === to) {
        const result = cyclic.has(from);
        cacheReachability(key, result);
        return result;
      }
      const pending = [...successors[from]!];
      const seen = new Set<number>([from]);
      while (pending.length > 0) {
        chargeQuerySteps(1);
        const current = pending.pop()!;
        if (current === to) {
          cacheReachability(key, true);
          return true;
        }
        if (seen.has(current)) continue;
        seen.add(current);
        pending.push(...successors[current]!);
      }
      cacheReachability(key, false);
      return false;
    };
    const graph: RustSourceFlowGraph = Object.freeze({
      points,
      edgeCount: this.#edgeCount,
      pointsFor: (node: Node | undefined) => Object.freeze(
        (node === undefined ? [] : this.#pointsByNode.get(node) ?? [])
          .map((index) => points[index]!),
      ),
      successors: (point: RustSourceFlowPoint) =>
        Object.freeze(successors[point.index]!.map((index) => points[index]!)),
      predecessors: (point: RustSourceFlowPoint) =>
        Object.freeze(predecessors[point.index]!.map((index) => points[index]!)),
      reaches: (from: Node | RustSourceFlowPoint, to: Node | RustSourceFlowPoint) => {
        const fromIndices = pointIndices(from);
        const toIndices = pointIndices(to);
        return fromIndices.some((fromIndex) => toIndices.some((toIndex) =>
          points[fromIndex]!.regionId === points[toIndex]!.regionId &&
          reachesIndex(fromIndex, toIndex)));
      },
      repeats: (node: Node | RustSourceFlowPoint) =>
        pointIndices(node).some((index) => cyclic.has(index)),
      pointsOnPaths: (
        from: Node | RustSourceFlowPoint,
        targets: readonly (Node | RustSourceFlowPoint)[],
      ) => {
        const selected = new Set<number>();
        const targetIndexes = targets.flatMap((target) => [...pointIndices(target)]);
        for (const fromIndex of pointIndices(from)) {
          const sameRegionTargets = targetIndexes.filter((index) =>
            points[index]!.regionId === points[fromIndex]!.regionId);
          if (sameRegionTargets.length === 0) continue;
          const forward = reachableSet(fromIndex, successors, true, chargeQuerySteps);
          const backward = new Set<number>();
          for (const target of sameRegionTargets) {
            for (const index of reachableSet(target, predecessors, true, chargeQuerySteps)) {
              backward.add(index);
            }
          }
          chargeQuerySteps(points.length);
          for (const point of points) {
            if (point.regionId === points[fromIndex]!.regionId &&
              forward.has(point.index) && backward.has(point.index)) {
              selected.add(point.index);
            }
          }
        }
        return Object.freeze([...selected].sort((left, right) => left - right)
          .map((index) => points[index]!));
      },
      regionFor: (node: Node | undefined) => node === undefined
        ? undefined
        : this.#regionByNode.get(node),
      exitsFor: (owner: SourceFile | Node) => {
        const record = this.#regionByOwner.get(owner);
        return record === undefined ? Object.freeze([]) : Object.freeze([points[record.exit]!]);
      },
    });
    return graph;
  }
}

function reachableSet(
  start: number,
  edges: readonly (readonly number[])[],
  includeStart: boolean,
  charge: (count: number) => void,
): ReadonlySet<number> {
  const seen = new Set<number>(includeStart ? [start] : []);
  const pending = [...edges[start]!];
  while (pending.length > 0) {
    charge(1);
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    pending.push(...edges[current]!);
  }
  return seen;
}

function computeCyclicPoints(
  successors: readonly (readonly number[])[],
  predecessors: readonly (readonly number[])[],
): ReadonlySet<number> {
  const visited = new Uint8Array(successors.length);
  const finishOrder: number[] = [];
  for (let start = 0; start < successors.length; start += 1) {
    if (visited[start] !== 0) continue;
    visited[start] = 1;
    const stack: { readonly point: number; next: number }[] = [{ point: start, next: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const adjacent = successors[frame.point]!;
      const successor = adjacent[frame.next];
      if (successor === undefined) {
        finishOrder.push(frame.point);
        stack.pop();
        continue;
      }
      frame.next += 1;
      if (visited[successor] !== 0) continue;
      visited[successor] = 1;
      stack.push({ point: successor, next: 0 });
    }
  }

  const assigned = new Uint8Array(successors.length);
  const cyclic = new Set<number>();
  for (let orderIndex = finishOrder.length - 1; orderIndex >= 0; orderIndex -= 1) {
    const start = finishOrder[orderIndex]!;
    if (assigned[start] !== 0) continue;
    const component: number[] = [];
    const pending = [start];
    assigned[start] = 1;
    while (pending.length > 0) {
      const point = pending.pop()!;
      component.push(point);
      for (const predecessor of predecessors[point]!) {
        if (assigned[predecessor] !== 0) continue;
        assigned[predecessor] = 1;
        pending.push(predecessor);
      }
    }
    if (component.length > 1 || successors[start]!.includes(start)) {
      component.forEach((selected) => cyclic.add(selected));
    }
  }
  return cyclic;
}

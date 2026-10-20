import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { Node } from "@tsonic/tsts";
import { targetStronglyConnectedComponents } from "@tsonic/target-api/analysis";

export function projectStandaloneItemEdges(
  itemUnits: ReadonlySet<Node>,
  graphUnits: ReadonlySet<Node>,
  edges: ReadonlyMap<Node, ReadonlySet<Node>>,
): ReadonlyMap<Node, ReadonlySet<Node>> {
  const projected = new Map<Node, Set<Node>>();
  for (const owner of itemUnits) {
    const targets = new Set<Node>();
    const visited = new Set<Node>();
    const pending = [...(edges.get(owner) ?? [])];
    while (pending.length > 0) {
      const target = pending.pop()!;
      if (!graphUnits.has(target) || visited.has(target)) continue;
      visited.add(target);
      if (itemUnits.has(target)) {
        targets.add(target);
        continue;
      }
      for (const dependency of edges.get(target) ?? []) pending.push(dependency);
    }
    if (targets.size > 0) projected.set(owner, targets);
  }
  return projected;
}

export function transitivelyReachable(
  roots: ReadonlySet<Node>,
  edges: ReadonlyMap<Node, ReadonlySet<Node>>,
): ReadonlySet<Node> {
  const reachable = new Set<Node>();
  const pending = [...roots];
  while (pending.length > 0) {
    const declaration = pending.pop()!;
    if (reachable.has(declaration)) continue;
    reachable.add(declaration);
    for (const dependency of edges.get(declaration) ?? []) {
      if (!reachable.has(dependency)) pending.push(dependency);
    }
  }
  return reachable;
}

export function deadComponentRoots(
  units: ReadonlySet<Node>,
  reachable: ReadonlySet<Node>,
  edges: ReadonlyMap<Node, ReadonlySet<Node>>,
  order: ReadonlyMap<Node, number>,
): ReadonlySet<Node> {
  const position = (node: Node): number => {
    const selected = order.get(node);
    if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "A standalone source declaration requires its sealed source order.");
    return selected;
  };
  const dead = new Set([...units].filter(declaration => !reachable.has(declaration))
    .sort((left, right) => position(left) - position(right)));
  const edgeCount = [...dead].reduce((total, owner) => total + (edges.get(owner)?.size ?? 0), 0);
  const selection = targetStronglyConnectedComponents(dead, owner => edges.get(owner) ?? [], 1 + 4 * dead.size + 6 * edgeCount);
  if (selection.kind === "unresolved") failTargetAnalysisInvariant("tsonic-rust", selection.reason);
  const componentByNode = new Map<Node, number>();
  for (const [index, component] of selection.components.entries()) {
    for (const node of component) componentByNode.set(node, index);
  }
  const incoming = new Set<number>();
  for (const owner of dead) {
    const ownerComponent = componentByNode.get(owner);
    for (const target of edges.get(owner) ?? []) {
      const targetComponent = componentByNode.get(target);
      if (targetComponent !== undefined && targetComponent !== ownerComponent) incoming.add(targetComponent);
    }
  }
  const roots = new Set<Node>();
  for (const [index, component] of selection.components.entries()) {
    if (incoming.has(index)) continue;
    const representative = component.reduce<Node | undefined>((selected, node) => {
      const selectedPosition = position(node);
      return selected === undefined || selectedPosition < position(selected) ? node : selected;
    }, undefined);
    if (representative !== undefined) roots.add(representative);
  }
  return roots;
}

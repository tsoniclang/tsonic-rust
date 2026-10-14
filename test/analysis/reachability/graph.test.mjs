import assert from "node:assert/strict";
import test from "node:test";
import { deadComponentRoots, projectStandaloneItemEdges, transitivelyReachable } from "../../../dist/analysis/reachability/graph.js";

test("declaration reachability follows exact roots and projects through non-item declarations", () => {
  const [root, field, method, leaf, foreign] = Array.from({ length: 5 }, () => ({}));
  const units = new Set([root, method, leaf]);
  const graph = new Set([root, field, method, leaf]);
  const edges = new Map([[root, new Set([field])], [field, new Set([field, method, foreign])],
    [method, new Set([leaf])], [foreign, new Set([root])]]);
  const projected = projectStandaloneItemEdges(units, graph, edges);
  assert.equal(projected.get(root)?.size, 1);
  assert.equal(projected.get(root)?.has(method), true);
  assert.equal(projected.get(root)?.has(leaf), false, "a standalone item retains its own outgoing edge");
  assert.equal(projected.get(root)?.has(foreign), false, "an unadmitted declaration is not followed");
  assert.equal(projected.get(method)?.has(leaf), true);
  const reachable = transitivelyReachable(new Set([root]), projected);
  assert.equal(reachable.size, 3);
  for (const node of units) assert.equal(reachable.has(node), true);
});

test("dead-component representatives match every three-node graph and root set", () => {
  const nodes = Array.from({ length: 3 }, () => ({}));
  const order = new Map(nodes.map((node, index) => [node, index]));
  for (let graphBits = 0; graphBits < 512; graphBits += 1) {
    const edges = new Map(nodes.map((node, owner) => [node, new Set(nodes.filter((_target, target) =>
      (graphBits & (1 << (owner * 3 + target))) !== 0))]));
    const closure = nodes.map((_node, owner) => nodes.map((_target, target) =>
      owner === target || edges.get(nodes[owner]).has(nodes[target])));
    for (let middle = 0; middle < 3; middle += 1) for (let owner = 0; owner < 3; owner += 1)
      for (let target = 0; target < 3; target += 1)
        closure[owner][target] ||= closure[owner][middle] && closure[middle][target];
    for (let rootBits = 0; rootBits < 8; rootBits += 1) {
      const label = `graph=${graphBits}, roots=${rootBits}`;
      const roots = new Set(nodes.filter((_node, index) => (rootBits & (1 << index)) !== 0));
      const expectedReachable = nodes.map((_node, target) => nodes.some((ownerNode, owner) =>
        roots.has(ownerNode) && closure[owner][target]));
      const reached = transitivelyReachable(roots, edges);
      for (const [index, node] of nodes.entries()) assert.equal(reached.has(node), expectedReachable[index], label);
      const representatives = nodes.flatMap((node, index) => {
        if (expectedReachable[index]) return [];
        const members = nodes.map((_candidate, candidate) => candidate).filter(candidate =>
          !expectedReachable[candidate] && closure[index][candidate] && closure[candidate][index]);
        if (members[0] !== index) return [];
        const incoming = nodes.some((ownerNode, owner) => !expectedReachable[owner] && !members.includes(owner) &&
          members.some(target => edges.get(ownerNode).has(nodes[target])));
        return incoming ? [] : [node];
      });
      const actual = deadComponentRoots(new Set(nodes), reached, edges, order);
      assert.equal(actual.size, representatives.length, label);
      for (const node of nodes) assert.equal(actual.has(node), representatives.includes(node), label);
    }
  }
});

test("iterative shared components handle a long cycle and deterministic source ordering", () => {
  const nodes = Array.from({ length: 12_000 }, () => ({}));
  const edges = new Map(nodes.map((node, index) => [node, new Set([nodes[(index + 1) % nodes.length]])]));
  const order = new Map(nodes.map((node, index) => [node, nodes.length - index]));
  const selected = deadComponentRoots(new Set(nodes), new Set(), edges, order);
  assert.equal(selected.size, 1);
  assert.equal(selected.has(nodes.at(-1)), true, "the source-order minimum wins, not SCC traversal order");
  assert.equal(deadComponentRoots(new Set(), new Set(), new Map(), new Map()).size, 0);
});

test("a missing native declaration order is an analysis invariant, not an invented first position", () => {
  const node = {};
  assert.throws(() => deadComponentRoots(new Set([node]), new Set(), new Map(), new Map()),
    /requires its sealed source order/u);
});

test("the SCC work bound covers dense cyclic and acyclic graphs, duplicate uses and outside targets", () => {
  const nodes = Array.from({ length: 128 }, () => ({}));
  const outside = {};
  const order = new Map(nodes.map((node, index) => [node, index]));
  for (const cyclic of [false, true]) {
    const edges = new Map(nodes.map((node, owner) => [node, new Set([
      outside, outside, ...nodes.flatMap((target, index) => cyclic || index > owner ? [target, target] : []),
    ])]));
    const edgeCount = [...edges.values()].reduce((total, targets) => total + targets.size, 0);
    assert.equal(edgeCount, cyclic ? 128 * 129 : 128 * 129 / 2);
    const selected = deadComponentRoots(new Set(nodes), new Set(), edges, order);
    assert.equal(selected.size, 1);
    assert.equal(selected.has(nodes[0]), true, `cyclic=${cyclic}`);
    assert.equal(selected.has(outside), false);
  }
});

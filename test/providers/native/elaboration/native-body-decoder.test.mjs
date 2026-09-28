import assert from "node:assert/strict";
import test from "node:test";
import { decodeNativeEvidence } from "../../../../dist/providers/native/elaboration/decode-evidence.js";
import { defaultRustNativeSourceLimits as limits } from "../../../../dist/providers/native/elaboration/limits.js";
import { createRustNativeBodyQueries } from "../../../../dist/providers/native/elaboration/body-queries.js";
import { nativeDefinition, nativeEvidenceFixture, nativeIdentity } from "./native-evidence-fixture.mjs";

const node = local => ({ owner: nativeIdentity(1), local });
const expression = (local, parent) => ({ kind: "expression", id: node(local), parent, source: null,
  type: 0, adjustedType: 0, resolution: null, arguments: null, adjustments: [] });
const pattern = (local, parent) => ({ kind: "pattern", id: node(local), parent, source: null,
  type: 0, resolution: { kind: "binding", id: node(local) }, binding: { mutable: false, reference: null }, adjustments: [] });

function evidence() {
  return { ...nativeEvidenceFixture(), phase: "checked", effects: [], flows: [], items: [0, 1].map(nativeIdentity),
    definitions: [nativeDefinition(0, "module"), nativeDefinition(1, "function")],
    types: [{ id: 0, value: { kind: "primitive", name: "u64" } }],
    occurrences: [expression(1, null), pattern(2, null), pattern(3, node(1)), expression(4, node(1)),
      expression(6, node(4)), expression(7, node(4))],
    bodies: [{ owner: nativeIdentity(1), parameters: [node(2)], value: node(1),
      locals: [{ id: node(5), pattern: node(3), initializer: node(4) }] }],
  };
}

test("native body queries select exact roots, patterns and initializers without span or spelling lookups", () => {
  const decoded = decodeNativeEvidence(evidence(), limits);
  const queries = createRustNativeBodyQueries(decoded);
  const body = decoded.bodies[0];
  const local = body.locals[0];
  assert.equal(queries.result(body), decoded.occurrences[0]);
  assert.deepEqual(queries.parameters(body), [decoded.occurrences[1]]);
  assert.equal(queries.pattern(local), decoded.occurrences[2]);
  assert.equal(queries.initializer(local), decoded.occurrences[3]);
  assert.equal(queries.parent(decoded.occurrences[3]), decoded.occurrences[0]);
  assert.equal(queries.parent(decoded.occurrences[0]), undefined);
  assert.deepEqual(queries.children(decoded.occurrences[3]), decoded.occurrences.slice(4));
  assert.deepEqual(queries.children(decoded.occurrences[4]), []);
  for (const value of [decoded.bodies, body, body.value, body.parameters, body.locals, local,
    queries, queries.parameters(body), queries.children(decoded.occurrences[3])]) assert.ok(Object.isFrozen(value));
});

test("native body queries reject equal-looking subjects from another snapshot", () => {
  const first = decodeNativeEvidence(evidence(), limits);
  const second = decodeNativeEvidence(evidence(), limits);
  const queries = createRustNativeBodyQueries(first);
  for (const operation of [
    () => queries.result(second.bodies[0]),
    () => queries.parameters(second.bodies[0]),
    () => queries.pattern(second.bodies[0].locals[0]),
    () => queries.initializer(second.bodies[0].locals[0]),
    () => queries.parent(second.occurrences[3]),
    () => queries.children(second.occurrences[3]),
  ]) assert.throws(operation, /another evidence snapshot/u);
});

test("a native local without an initializer remains absent rather than acquiring an invented value", () => {
  const input = evidence();
  input.bodies[0].locals[0].initializer = null;
  const decoded = decodeNativeEvidence(input, limits);
  assert.equal(createRustNativeBodyQueries(decoded).initializer(decoded.bodies[0].locals[0]), undefined);
});

test("nested bodies sharing a HIR owner retain separate roots and declaration membership", () => {
  const input = evidence();
  const closure = nativeDefinition(2, "closure");
  closure.parent = nativeIdentity(1);
  input.definitions.push(closure);
  input.occurrences.push(expression(8, null));
  input.bodies.push({ owner: closure.id, parameters: [], value: node(8), locals: [] });
  const decoded = decodeNativeEvidence(input, limits);
  const queries = createRustNativeBodyQueries(decoded);
  assert.equal(queries.result(decoded.bodies[1]), decoded.occurrences.at(-1));
  assert.deepEqual(decoded.bodies[0].value.owner, decoded.bodies[1].value.owner);
  input.bodies[1].locals = input.bodies[0].locals;
  input.bodies[0].locals = [];
  assert.throws(() => decodeNativeEvidence(input, limits), /Native Rust local declarations/u);
});

test("native body graphs reject missing, duplicate, cyclic and cross-owner relationships", () => {
  const mutations = [
    input => { delete input.bodies; },
    input => { input.bodies = []; },
    input => { input.bodies.push(input.bodies[0]); },
    input => { input.bodies[0].owner = nativeIdentity(9); },
    input => { input.bodies[0].value = node(9); },
    input => { input.bodies[0].value = node(2); },
    input => { input.bodies[0].parameters.push(node(2)); },
    input => { input.bodies[0].parameters[0] = node(1); },
    input => { input.bodies[0].parameters[0] = node(9); },
    input => { input.bodies[0].locals.push(input.bodies[0].locals[0]); },
    input => { input.bodies[0].locals[0].id = node(4); },
    input => { input.bodies[0].locals[0].id = { owner: nativeIdentity(0), local: 5 }; },
    input => { input.bodies[0].locals[0].pattern = node(9); },
    input => { input.bodies[0].locals[0].pattern = node(4); },
    input => { input.bodies[0].locals[0].pattern = node(2); },
    input => { input.bodies[0].locals[0].initializer = node(3); },
    input => { input.bodies[0].locals[0].initializer = node(9); },
    input => { input.bodies[0].locals[0].initializer = node(1); },
    input => { input.bodies[0].locals[0].initializer = node(6); },
    input => { input.occurrences[0].parent = node(4); },
    input => { input.occurrences[1].parent = node(1); },
    input => { input.occurrences[4].parent = node(7); input.occurrences[5].parent = node(6); },
    input => { input.occurrences[4].parent = node(9); },
    input => { input.occurrences[4].parent = null; },
    input => { input.occurrences[4].id.owner = nativeIdentity(0); },
    input => { input.occurrences[4].parent.owner = nativeIdentity(0); },
    input => { delete input.occurrences[0].parent; },
  ];
  for (const mutate of mutations) {
    const input = evidence();
    mutate(input);
    assert.throws(() => decodeNativeEvidence(input, limits), /Native Rust/u);
  }
});

test("native body wire records reject extra fields, getters and sparse arrays without executing them", () => {
  let reads = 0;
  for (const mutate of [
    input => { input.bodies[0].guessed = true; },
    input => { input.bodies[0].locals[0].guessed = true; },
    input => { delete input.bodies[0].locals[0].initializer; },
    input => { delete input.bodies[0]; },
    input => { delete input.bodies[0].parameters[0]; },
    input => { delete input.bodies[0].locals[0]; },
    input => { Object.defineProperty(input.bodies[0], "value", { get() { reads += 1; return node(1); } }); },
    input => { Object.defineProperty(input.bodies[0].locals[0], "initializer", { get() { reads += 1; return node(4); } }); },
  ]) {
    const input = evidence();
    mutate(input);
    assert.throws(() => decodeNativeEvidence(input, limits), /Native Rust/u);
  }
  assert.equal(reads, 0);
});

test("native body and parameter rows share the finite evidence budget", () => {
  const input = evidence();
  for (let index = 0; index < 32; index += 1) {
    input.occurrences.push(pattern(100 + index, null));
    input.bodies[0].parameters.push(node(100 + index));
  }
  assert.equal(decodeNativeEvidence(input, limits).bodies[0].parameters.length, 33);
  assert.throws(() => decodeNativeEvidence(input, { ...limits, maximumRows: 64 }), /row limit/u);
});

test("native containment depth is bounded independently of row order and row capacity", () => {
  const input = evidence();
  for (let index = 0; index < 32; index += 1) {
    input.occurrences.push(expression(100 + index, node(index === 0 ? 7 : 99 + index)));
  }
  for (const occurrences of [input.occurrences, [...input.occurrences].reverse()]) {
    assert.equal(decodeNativeEvidence({ ...input, occurrences }, { ...limits, maximumDepth: 34 }).bodies.length, 1);
    assert.throws(() => decodeNativeEvidence({ ...input, occurrences }, { ...limits, maximumDepth: 33 }), /depth limit/u);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { decodeNativeEvidence } from "../../../../dist/providers/native/elaboration/decode-evidence.js";
import { defaultRustNativeSourceLimits as limits } from "../../../../dist/providers/native/elaboration/limits.js";
import { nativeDefinition, nativeEvidenceFixture, nativeIdentity } from "./native-evidence-fixture.mjs";

const node = local => ({ owner: nativeIdentity(1), local });

function evidence(access = {}) {
  return { ...nativeEvidenceFixture(), phase: "checked", flows: [], items: [0, 1].map(nativeIdentity),
    definitions: [nativeDefinition(0, "module"), nativeDefinition(1, "function"), nativeDefinition(2, "closure")],
    types: [{ id: 0, value: { kind: "primitive", name: "u64" } }],
    occurrences: [
      { kind: "pattern", id: node(1), parent: null, source: null, type: 0, resolution: { kind: "binding", id: node(1) },
        binding: { mutable: true, reference: null }, adjustments: [] },
      { kind: "expression", id: node(2), parent: null, source: null, type: 0, adjustedType: 0,
        resolution: { kind: "binding", id: node(1) }, arguments: null, adjustments: [] },
      { kind: "pattern", id: node(3), parent: null, source: null, type: 0, resolution: { kind: "binding", id: node(1) },
        binding: { mutable: true, reference: null }, adjustments: [] },
    ],
    bodies: [{ owner: nativeIdentity(1), parameters: [node(1), node(3)], value: node(2), locals: [] }],
    effects: [{ owner: nativeIdentity(1), accesses: [{ kind: "mutate", place: node(2), diagnostic: node(2),
      source: null, base: { kind: "local", binding: node(1) }, projections: [], fakeRead: null, ...access }] }],
  };
}

test("native effects preserve binding identity, captures, projection order and immutable snapshots", () => {
  const bases = [{ kind: "temporary" }, { kind: "static" }, { kind: "local", binding: node(1) },
    { kind: "capture", binding: node(1), closure: nativeIdentity(2) }];
  const projections = [{ kind: "field", field: 4, variant: 2 }, ...[
    "dereference", "index", "subslice", "opaque-cast", "unwrap-unsafe-binder",
  ].map(kind => ({ kind }))];
  for (const kind of ["move", "use-cloned", "copy", "borrow-shared", "borrow-unique-shared", "borrow-mutable", "mutate", "bind"]) {
    for (const base of bases) {
      const input = evidence({ kind, base, projections });
      const decoded = decodeNativeEvidence(input, limits);
      assert.deepEqual(decoded.effects, input.effects);
      assert.deepEqual(decoded.occurrences, input.occurrences);
      const access = decoded.effects[0].accesses[0];
      for (const part of [decoded.effects, decoded.effects[0], decoded.effects[0].accesses, access, access.base,
        access.place, access.place.owner, access.diagnostic, access.projections, ...access.projections]) {
        assert.ok(Object.isFrozen(part));
      }
      input.effects[0].accesses[0].kind = "fake-read";
      assert.equal(access.kind, kind);
    }
  }
});

test("native fake reads retain their exact reason and optional closure identity", () => {
  for (const reason of ["match-guard", "matched-place", "guard-binding", "let", "index"]) {
    for (const closure of reason === "matched-place" || reason === "let" ? [null, nativeIdentity(2)] : [null]) {
      const input = evidence({ kind: "fake-read", fakeRead: { reason, closure } });
      const decoded = decodeNativeEvidence(input, limits);
      assert.deepEqual(decoded.effects, input.effects);
      assert.ok(Object.isFrozen(decoded.effects[0].accesses[0].fakeRead));
    }
  }
});

test("native bindings cannot be an expression, nonbinding pattern, alias cycle or absent row", () => {
  const mutations = [
    input => { input.occurrences[1].resolution.id = node(2); },
    input => { input.occurrences[1].resolution.id = node(3); },
    input => { input.occurrences[1].resolution.id = node(4); },
    input => { input.occurrences[0].binding = null; input.occurrences[0].resolution = null; },
    input => { input.occurrences[0].resolution.id = node(3); },
    input => { input.effects[0].accesses[0].base.binding = node(2); },
    input => { input.effects[0].accesses[0].base.binding = node(3); },
    input => { input.effects[0].accesses[0].base.binding = node(4); },
    input => { input.effects[0].accesses[0].base = { kind: "capture", binding: node(2), closure: nativeIdentity(2) }; },
  ];
  for (const mutate of mutations) {
    const input = evidence();
    mutate(input);
    assert.throws(() => decodeNativeEvidence(input, limits), /canonical binding/u);
  }
});

test("native effect variants reject contradictory, incomplete and additional fields", () => {
  const mutations = [
    input => { input.effects[0].extra = true; },
    input => { input.effects[0].accesses[0].extra = true; },
    input => { delete input.effects[0].accesses[0].source; },
    input => { input.effects[0].accesses[0].base.extra = true; },
    input => { input.effects[0].accesses[0].base = { kind: "temporary", binding: node(1) }; },
    input => { input.effects[0].accesses[0].base = { kind: "capture", binding: node(1) }; },
    input => { input.effects[0].accesses[0].base = { kind: "capture", binding: node(1), closure: nativeIdentity(1) }; },
    input => { input.effects[0].accesses[0].base = { kind: "capture", binding: node(1), closure: nativeIdentity(8) }; },
    input => { input.effects[0].accesses[0].projections = [{ kind: "index", field: 1 }]; },
    input => { input.effects[0].accesses[0].projections = [{ kind: "field", field: 1 }]; },
    input => { input.effects[0].accesses[0].projections = [{ kind: "field", field: 1, variant: 0, extra: true }]; },
    input => { input.effects[0].accesses[0].kind = "fake-read"; },
    input => { input.effects[0].accesses[0].fakeRead = { reason: "index", closure: null }; },
    input => { Object.assign(input.effects[0].accesses[0], { kind: "fake-read",
      fakeRead: { reason: "index", closure: null, extra: true } }); },
    input => { Object.assign(input.effects[0].accesses[0], { kind: "fake-read",
      fakeRead: { reason: "index", closure: nativeIdentity(1) } }); },
    input => { Object.assign(input.effects[0].accesses[0], { kind: "fake-read",
      fakeRead: { reason: "index", closure: nativeIdentity(2) } }); },
    input => { Object.assign(input.effects[0].accesses[0], { kind: "fake-read",
      fakeRead: { reason: "let", closure: nativeIdentity(1) } }); },
  ];
  for (const mutate of mutations) {
    const input = evidence();
    mutate(input);
    assert.throws(() => decodeNativeEvidence(input, limits), /Native Rust/u);
  }
});

test("native expansion records reject extra fields instead of silently dropping evidence", () => {
  const input = evidence();
  input.expansions.push({ id: nativeIdentity(0), parent: nativeIdentity(0), kind: "root", name: "root",
    definition: null, callSite: null, definitionSite: null });
  assert.equal(decodeNativeEvidence(input, limits).expansions.length, 1);
  input.expansions[0].extra = true;
  assert.throws(() => decodeNativeEvidence(input, limits), /shape/u);
});

test("every native effect projection participates in the common finite row budget", () => {
  const input = evidence({ projections: Array.from({ length: 32 }, () => ({ kind: "index" })) });
  assert.equal(decodeNativeEvidence(input, limits).effects[0].accesses[0].projections.length, 32);
  assert.throws(() => decodeNativeEvidence(input, { ...limits, maximumRows: 32 }), /row limit/u);
});

test("native wire readers never execute record or array getters", () => {
  let reads = 0;
  const mutations = [
    input => { Object.defineProperty(input, "phase", { get() { reads += 1; return "checked"; } }); },
    input => { Object.defineProperty(input.effects[0].accesses[0].base, "binding", { get() { reads += 1; return node(1); } }); },
    input => { Object.defineProperty(input.effects, "0", { get() { reads += 1; return {}; } }); },
    input => { delete input.effects[0]; },
    input => { input.effects.extra = true; },
    input => { Object.setPrototypeOf(input.effects[0], { inherited: true }); },
    input => { input.effects[0][Symbol("extra")] = true; },
    input => { Object.defineProperty(input.effects[0], "extra", { value: true }); },
  ];
  for (const mutate of mutations) {
    const input = evidence();
    mutate(input);
    assert.throws(() => decodeNativeEvidence(input, limits), /Native Rust/u);
  }
  assert.equal(reads, 0);
});

test("native evidence arrays do not invoke inherited collection behavior", () => {
  let calls = 0;
  class ForeignArray extends Array {
    map() { calls += 1; throw new Error("Foreign map must not execute."); }
    [Symbol.iterator]() { calls += 1; throw new Error("Foreign iterator must not execute."); }
  }
  const input = evidence();
  const effects = new ForeignArray();
  effects.push(input.effects[0]);
  input.effects = effects;
  assert.equal(decodeNativeEvidence(input, limits).effects.length, 1);
  assert.equal(calls, 0);
});

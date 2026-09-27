import assert from "node:assert/strict";
import test from "node:test";
import { decodeNativeEvidence } from "../../../../dist/providers/native/elaboration/decode-evidence.js";
import { defaultRustNativeSourceLimits as limits } from "../../../../dist/providers/native/elaboration/limits.js";
import { nativeDefinition, nativeEvidenceFixture, nativeIdentity } from "./native-evidence-fixture.mjs";

const node = local => ({ owner: nativeIdentity(1), local });
const origin = () => ({ node: node(0), source: null });
const local = () => ({ origin: origin(), binding: null, guardTarget: null });
const step = () => ({ origin: origin(), accesses: [] });
const block = (control, cleanup = false) => ({ cleanup, statements: [], terminator: { ...step(), control } });
const access = () => ({ kind: "move", local: 1, projections: [] });

function evidence(control = { kind: "return" }) {
  return { ...nativeEvidenceFixture(), phase: "checked", items: [0, 1].map(nativeIdentity),
    definitions: [nativeDefinition(0, "module"), nativeDefinition(1, "function")],
    types: [{ id: 0, value: { kind: "primitive", name: "u64" } }],
    occurrences: [{ kind: "pattern", id: node(1), source: null, type: 0, resolution: { kind: "binding", id: node(1) },
      binding: { mutable: true, reference: null }, adjustments: [] }], effects: [],
    flows: [{ owner: nativeIdentity(1), argumentCount: 1,
      locals: [local(), { ...local(), binding: node(1) }, { ...local(), guardTarget: 1 }],
      blocks: [block(control), block({ kind: "return" }), block({ kind: "unwind-resume" }, true)] }],
  };
}

const controls = [
  { kind: "goto", target: 0 },
  { kind: "switch", branches: [{ value: "0", target: 0 }, { value: "340282366920938463463374607431768211455", target: 1 }], otherwise: 1 },
  ...["return", "unreachable", "unwind-resume", "tail-call", "coroutine-drop"].map(kind => ({ kind })),
  ...["abi", "in-cleanup"].map(reason => ({ kind: "unwind-terminate", reason })),
  { kind: "yield", resume: 1, drop: 2 },
  { kind: "yield", resume: 1, drop: null },
  { kind: "false-edge", real: 0, imaginary: 1 },
  ...[{ kind: "continue" }, { kind: "unreachable" }, { kind: "cleanup", target: 2 },
    ...["abi", "in-cleanup"].map(reason => ({ kind: "terminate", reason }))].flatMap(unwind => [
    { kind: "drop", target: 1, unwind, drop: 2 }, { kind: "drop", target: 1, unwind, drop: null },
    { kind: "call", target: 1, unwind }, { kind: "call", target: null, unwind },
    { kind: "assert", target: 1, unwind }, { kind: "false-unwind", real: 1, unwind },
    { kind: "inline-assembly", targets: [0, 1], unwind }, { kind: "inline-assembly", targets: [], unwind },
  ]),
];

test("native control relations preserve normal, imaginary, cleanup, suspension and diverging edges", () => {
  for (const control of controls) {
    const input = evidence(control);
    const result = decodeNativeEvidence(input, limits);
    assert.deepEqual(result.flows, input.flows);
    assert.ok(Object.isFrozen(result.flows));
    assert.ok(Object.isFrozen(result.flows[0]));
    assert.ok(Object.isFrozen(result.flows[0].blocks));
    assert.ok(Object.isFrozen(result.flows[0].blocks[0].terminator.control));
    for (const field of Object.keys(control)) {
      const missing = evidence({ ...control });
      delete missing.flows[0].blocks[0].terminator.control[field];
      assert.throws(() => decodeNativeEvidence(missing, limits), /Native Rust/u);
    }
    input.flows[0].blocks[0].terminator.control = { kind: "return" };
    assert.deepEqual(result.flows[0].blocks[0].terminator.control, control);
  }
});

test("native place classifications retain storage, projection and call-result distinctions", () => {
  const projections = [
    ...["dereference", "opaque-cast", "unwrap-unsafe-binder"].map(kind => ({ kind })),
    { kind: "field", field: 0xffff_ffff }, { kind: "downcast", variant: 2 }, { kind: "index", local: 1 },
    { kind: "constant-index", offset: "9007199254740993", minimumLength: "18446744073709551615", fromEnd: false },
    { kind: "constant-index", offset: "18446744073709551615", minimumLength: "18446744073709551615", fromEnd: true },
    { kind: "subslice", from: "9007199254740993", to: "18446744073709551615", fromEnd: false },
    { kind: "subslice", from: "9007199254740993", to: "1", fromEnd: true },
  ];
  const input = evidence({ kind: "call", target: 1, unwind: { kind: "cleanup", target: 2 } });
  for (const kind of ["inspect", "copy", "move", "borrow-shared", "borrow-fake", "address-shared", "place-mention",
    "projection-read", "store", "set-discriminant", "assembly-output", "call-result", "yield-result", "drop",
    "borrow-mutable", "address-mutable", "projection-write", "retag", "storage-live", "storage-dead", "ascribe-type",
    "debug-info", "drop-hint"]) {
    input.flows[0].blocks[0].terminator.accesses = [{ ...access(), kind, projections }];
    const result = decodeNativeEvidence(input, limits);
    const output = result.flows[0].blocks[0].terminator.accesses[0];
    assert.deepEqual(output, input.flows[0].blocks[0].terminator.accesses[0]);
    for (const part of [output, output.projections, ...output.projections]) assert.ok(Object.isFrozen(part));
  }
});

test("native flow rejects missing identities, malformed topology and noncanonical bindings", () => {
  const mutations = [
    input => { delete input.flows; },
    input => input.flows.push(input.flows[0]),
    input => { input.flows[0].owner = nativeIdentity(9); },
    input => { input.flows[0].locals = []; },
    input => { input.flows[0].argumentCount = 3; },
    input => { input.flows[0].blocks = []; },
    input => { input.flows[0].blocks[0].cleanup = true; },
    input => { input.flows[0].locals[1].binding = node(2); },
    input => { input.flows[0].locals[1].origin.node.owner = nativeIdentity(9); },
    input => { input.flows[0].locals[2].guardTarget = 2; },
    input => { input.flows[0].locals[2].guardTarget = 3; },
    input => { input.flows[0].locals[1].guardTarget = 2; },
    input => { input.flows[0].blocks[0].terminator.accesses = [{ ...access(), local: 3 }]; },
    input => { input.flows[0].blocks[0].statements = [{ ...step(), accesses: [{ ...access(), projections: [{ kind: "index", local: 3 }] }] }]; },
    input => { input.flows[0].blocks[0].terminator.origin.node.owner = nativeIdentity(9); },
    input => { input.flows[0].blocks[0].terminator.origin.source = {
      file: "source.rs", start: 0, end: 1, context: [], expansion: nativeIdentity(9) }; },
  ];
  const invalidControls = [
    { kind: "goto", target: 3 }, { kind: "switch", branches: [{ value: "1", target: 3 }], otherwise: 0 },
    { kind: "switch", branches: [{ value: "1", target: 0 }, { value: "1", target: 1 }], otherwise: 0 },
    { kind: "switch", branches: [], otherwise: 3 },
    { kind: "call", target: 3, unwind: { kind: "continue" } },
    { kind: "call", target: 0, unwind: { kind: "cleanup", target: 3 } },
    { kind: "call", target: 0, unwind: { kind: "cleanup", target: 1 } },
    { kind: "drop", target: 0, drop: 3, unwind: { kind: "continue" } },
    { kind: "yield", resume: 3, drop: null }, { kind: "yield", resume: 0, drop: 3 },
    { kind: "false-edge", real: 0, imaginary: 3 }, { kind: "false-edge", real: 3, imaginary: 0 },
    { kind: "false-unwind", real: 3, unwind: { kind: "continue" } },
    { kind: "inline-assembly", targets: [0, 3], unwind: { kind: "continue" } },
  ];
  for (const control of invalidControls) mutations.push(input => { input.flows[0].blocks[0].terminator.control = control; });
  for (const mutate of mutations) {
    const input = evidence();
    mutate(input);
    assert.throws(() => decodeNativeEvidence(input, limits), /Native Rust/u);
  }
});

test("native flow rejects lossy integers and inconsistent fixed projections", () => {
  const badProjections = [
    ...["-1", "01", "1.0", "1e3", "18446744073709551616", 1, null].map(offset =>
      ({ kind: "constant-index", offset, minimumLength: "18446744073709551615", fromEnd: true })),
    { kind: "constant-index", offset: "0", minimumLength: "4", fromEnd: true },
    { kind: "constant-index", offset: "4", minimumLength: "4", fromEnd: false },
    { kind: "constant-index", offset: "5", minimumLength: "4", fromEnd: true },
    { kind: "subslice", from: "4", to: "3", fromEnd: false },
    { kind: "field", field: -1 }, { kind: "index", local: 1.5 }, { kind: "downcast", variant: 0x1_0000_0000 },
  ];
  for (const projection of badProjections) {
    const input = evidence();
    input.flows[0].blocks[0].terminator.accesses = [{ ...access(), projections: [projection] }];
    assert.throws(() => decodeNativeEvidence(input, limits), /Native Rust/u);
  }
  for (const value of ["-1", "00", "340282366920938463463374607431768211456", "1".repeat(40), 9007199254740992]) {
    assert.throws(() => decodeNativeEvidence(evidence({ kind: "switch", branches: [{ value, target: 0 }], otherwise: 1 }), limits), /integer/u);
  }
});

test("native flow wire decoding rejects extras, sparse arrays and getters without executing them", () => {
  let calls = 0;
  const mutations = [
    input => { input.flows[0].extra = true; },
    input => { input.flows[0].locals[0].extra = true; },
    input => { input.flows[0].locals[0].origin.extra = true; },
    input => { input.flows[0].blocks[0].extra = true; },
    input => { input.flows[0].blocks[0].terminator.extra = true; },
    input => { input.flows[0].blocks[0].terminator.control.extra = true; },
    input => { input.flows[0].blocks[0].terminator.accesses = [{ ...access(), extra: true }]; },
    input => { input.flows[0].blocks[0].terminator.accesses = [{ ...access(), projections: [{ kind: "dereference", extra: true }] }]; },
    input => { delete input.flows[0].locals[0]; },
    input => { delete input.flows[0].blocks[0]; },
    input => { Object.defineProperty(input.flows[0], "blocks", { get() { calls += 1; return []; } }); },
    input => { Object.defineProperty(input.flows[0].blocks, "0", { get() { calls += 1; return block({ kind: "return" }); } }); },
  ];
  for (const mutate of mutations) {
    const input = evidence();
    mutate(input);
    assert.throws(() => decodeNativeEvidence(input, limits), /Native Rust/u);
  }
  assert.equal(calls, 0);
  for (const control of controls.filter(control => "unwind" in control)) {
    assert.throws(() => decodeNativeEvidence(evidence({ ...control, unwind: { ...control.unwind, extra: true } }), limits), /shape/u);
  }
  const declarations = { ...nativeEvidenceFixture(), flows: [] };
  assert.throws(() => decodeNativeEvidence(declarations, limits), /cannot claim checked/u);
});

test("native flow locals, statements, branches, projections and assembly targets use the shared finite budget", () => {
  for (const mutate of [
    input => { input.flows[0].locals = Array.from({ length: 80 }, local); },
    input => { input.flows[0].blocks[0].statements = Array.from({ length: 80 }, step); },
    input => { input.flows[0].blocks[0].terminator.accesses = Array.from({ length: 80 }, access); },
    input => { input.flows[0].blocks[0].terminator.accesses = [{ ...access(), projections: Array.from({ length: 80 }, () => ({ kind: "dereference" })) }]; },
    input => { input.flows[0].blocks[0].terminator.control = { kind: "switch", branches: Array.from({ length: 80 }, (_, value) => ({ value: String(value), target: 1 })), otherwise: 1 }; },
    input => { input.flows[0].blocks[0].terminator.control = { kind: "inline-assembly", targets: Array(80).fill(1), unwind: { kind: "continue" } }; },
  ]) {
    const input = evidence();
    mutate(input);
    assert.equal(decodeNativeEvidence(input, limits).flows.length, 1);
    assert.throws(() => decodeNativeEvidence(input, { ...limits, maximumRows: 80 }), /row limit/u);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { decodeNativeEvidence } from "../../../../dist/providers/native/elaboration/decode-evidence.js";
import { nativeDefinition, nativeEvidenceFixture } from "./native-evidence-fixture.mjs";

const limits = { maximumRows: 10_000, maximumDepth: 16, maximumOutputBytes: 1_048_576, timeoutMilliseconds: 1_000 };
const identity = index => ({ krate: 0, index });

function evidence(occurrence) {
  const root = occurrence.kind === "expression" ? occurrence : { ...expression(), id: { owner: identity(1), local: 10 } };
  const associated = { ...nativeDefinition(2, "associated-function"), type: 1 };
  return { ...nativeEvidenceFixture(), phase: "checked", effects: [], flows: [], items: [0, 1, 2].map(identity),
    definitions: [nativeDefinition(0, "module"), nativeDefinition(1, "function"), associated],
    types: [{ id: 0, value: { kind: "primitive", name: "u64" } },
      { id: 1, value: { kind: "function", definition: identity(2), arguments: [],
        signature: { variables: [], value: { inputs: [], output: 0, variadic: false, unsafeCall: false, abi: "Rust" } } } }],
    constants: [{ id: 0, value: { kind: "scalar", type: 0, bytes: 8, bits: "9007199254740993" } }],
    occurrences: occurrence === root ? [occurrence] : [occurrence, root],
    bodies: [{ owner: identity(1), parameters: occurrence.kind === "pattern" ? [occurrence.id] : [],
      value: root.id, locals: [] }],
  };
}

function expression(adjustments = []) {
  return { kind: "expression", id: { owner: identity(1), local: 1 }, parent: null, source: null,
    type: 0, adjustedType: 0, resolution: null, arguments: null, adjustments };
}

test("native occurrence decoding covers every compiler adjustment operation", () => {
  const operations = [
    ...["never-to-any", "builtin-deref", "pin-deref", "unsafe-function-pointer",
      "mutable-to-const-pointer", "array-to-pointer", "unsize"].map(kind => ({ kind })),
    ...[false, true].map(mutable => ({ kind: "overloaded-deref", mutable, method: identity(2) })),
    ...[false, true].flatMap(mutable => ["borrow-raw-pointer", "borrow-pin", "generic-reborrow"].map(kind => ({ kind, mutable }))),
    ...[false, true].flatMap(unsafe => ["reify-function-pointer", "closure-function-pointer"].map(kind => ({ kind, unsafe }))),
    { kind: "borrow-reference", mutable: false, twoPhase: false },
    { kind: "borrow-reference", mutable: true, twoPhase: false },
    { kind: "borrow-reference", mutable: true, twoPhase: true },
  ];
  for (const operation of operations) {
    const occurrence = expression([{ target: 0, operation }]);
    const decoded = decodeNativeEvidence(evidence(occurrence), limits);
    assert.deepEqual(decoded.occurrences[0], occurrence);
    assert.ok(Object.isFrozen(decoded.occurrences[0].adjustments[0].operation));
  }
});

test("exact native substitutions retain type, lifetime and large constant arguments", () => {
  const occurrence = { ...expression(), arguments: [
    { kind: "type", id: 0 }, { kind: "constant", id: 0 }, { kind: "lifetime", region: { kind: "static" } },
  ], resolution: { kind: "declaration", id: identity(1) } };
  const result = decodeNativeEvidence(evidence(occurrence), limits);
  assert.deepEqual(result.occurrences[0], occurrence);
  assert.equal(result.constants[0].value.bits, "9007199254740993");
  assert.ok(Object.isFrozen(result.occurrences[0].arguments));
});

test("native pattern binding and reference mutability remain independent", () => {
  const id = { owner: identity(1), local: 1 };
  for (const mutable of [false, true]) {
    for (const reference of [null, ...[false, true].flatMap(mutable =>
      [false, true].map(pinned => ({ mutable, pinned })))]) {
      const occurrence = { kind: "pattern", id, parent: null, source: null, type: 0,
        resolution: { kind: "binding", id }, binding: { mutable, reference },
        adjustments: ["builtin-deref", "overloaded-deref", "pin-deref"].map(kind => ({ kind, source: 0 })) };
      assert.deepEqual(decodeNativeEvidence(evidence(occurrence), limits).occurrences[0], occurrence);
    }
  }
});

test("malformed or contradictory native occurrence evidence is rejected", () => {
  const binding = { owner: identity(1), local: 1 };
  const pattern = { kind: "pattern", id: binding, parent: null, source: null, type: 0,
    resolution: { kind: "binding", id: binding }, binding: { mutable: false, reference: null }, adjustments: [] };
  const cases = [
    { ...expression(), adjustedType: 4 },
    { ...expression(), arguments: [{ kind: "type", id: 8 }] },
    { ...expression(), arguments: [{ kind: "constant", id: 8 }] },
    expression([{ target: 0, operation: { kind: "borrow-reference", mutable: false, twoPhase: true } }]),
    expression([{ target: 0, operation: { kind: "borrow-reference", mutable: true } }]),
    expression([{ target: 0, operation: { kind: "overloaded-deref", mutable: false, method: identity(0) } }]),
    expression([{ target: 0, operation: { kind: "overloaded-deref", mutable: false, method: identity(4) } }]),
    expression([{ target: 0, operation: { kind: "unsize", guessed: true } }]),
    expression([{ target: 0, operation: { kind: "unknown-adjustment" } }]),
    { ...pattern, binding: null },
    { ...pattern, resolution: null },
    { ...pattern, binding: { mutable: false, reference: { mutable: true } } },
    { ...pattern, adjustments: [{ kind: "builtin-deref", source: 8 }] },
    { ...pattern, adjustments: [{ kind: "guessed-deref", source: 0 }] },
    { ...pattern, adjustedType: 0 },
    { ...expression(), binding: null },
    { ...expression(), id: { ...binding, guess: 0 } },
  ];
  for (const occurrence of cases) assert.throws(() => decodeNativeEvidence(evidence(occurrence), limits));
  for (const field of ["arguments", "adjustments", "adjustedType", "parent"]) {
    const occurrence = expression();
    delete occurrence[field];
    assert.throws(() => decodeNativeEvidence(evidence(occurrence), limits), /shape/u);
  }
});

test("native adjustment rows consume the same finite evidence budget", () => {
  const input = evidence(expression(Array.from({ length: 64 }, () => ({ target: 0, operation: { kind: "builtin-deref" } }))));
  assert.throws(() => decodeNativeEvidence(input, { ...limits, maximumRows: 64 }), /row limit/u);
  assert.equal(decodeNativeEvidence(input, limits).occurrences[0].adjustments.length, 64);
});

import assert from "node:assert/strict";
import test from "node:test";
import { decodeNativeEvidence } from "../../../../dist/providers/native/elaboration/decode-evidence.js";
import { nativeDefinition, nativeEvidenceFixture } from "./native-evidence-fixture.mjs";

const limits = { maximumRows: 10_000, maximumDepth: 16, maximumOutputBytes: 1_048_576, timeoutMilliseconds: 1_000 };
const identity = index => ({ krate: 0, index });
const kinds = ["module", "struct", "function", "trait", "associated-type", "type-parameter", "lifetime-parameter", "closure",
  "opaque-type", "type-alias", "constant", "const-parameter", "associated-constant", "anonymous-constant", "foreign-type"];
const region = { kind: "static" };
const boundType = { kind: "named", definition: identity(5) };
const boundRegion = { kind: "named", definition: identity(6) };
const binder = value => ({ variables: [], value });
const typeArgument = { kind: "type", id: 0 };
const constantArgument = { kind: "constant", id: 0 };
const signature = { inputs: [0], output: 0, variadic: false, unsafeCall: true, abi: "C-unwind" };

function graph() {
  return {
    ...nativeEvidenceFixture(),
    items: [0, 1, 2, 3, 4, 9, 10, 12, 14].map(identity),
    scopes: [0, 3].map(index => ({ kind: "named", owner: identity(index), bindings: [], ambiguities: [] })),
    definitions: kinds.map((kind, index) => nativeDefinition(index, kind)),
    types: [{ id: 0, value: { kind: "primitive", name: "u64" } }],
    constants: [{ id: 0, value: { kind: "scalar", type: 0, bytes: 8, bits: "9007199254740993" } }],
  };
}

test("the native type decoder has an exact shape for every compiler type category", () => {
  const values = [
    ...["bool", "char", "str", "never", "i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize", "f16", "f32", "f64", "f128"]
      .map(name => ({ kind: "primitive", name })),
    { kind: "adt", definition: identity(1), arguments: [typeArgument, constantArgument, { kind: "lifetime", region }] },
    { kind: "foreign", definition: identity(14) },
    { kind: "array", element: 0, length: 0 },
    { kind: "pattern", base: 0, pattern: { kind: "or", patterns: [{ kind: "range", start: 0, end: 0 }, { kind: "not-null" }] } },
    { kind: "slice", element: 0 },
    { kind: "raw-pointer", pointee: 0, mutable: true },
    { kind: "reference", region, pointee: 0, mutable: false },
    { kind: "function", definition: identity(2), arguments: [], signature: binder(signature) },
    { kind: "function-pointer", signature: binder(signature) },
    { kind: "unsafe-binder", binder: { variables: [{ kind: "type", declaration: boundType }], value: 0 } },
    { kind: "dynamic", region, predicates: [binder({ kind: "trait", definition: identity(3), arguments: [typeArgument] }),
      binder({ kind: "projection", definition: identity(4), arguments: [], term: typeArgument }), binder({ kind: "auto-trait", definition: identity(3) })] },
    ...["closure", "coroutine-closure", "coroutine", "coroutine-witness"].map(kind => ({ kind, definition: identity(7), arguments: [typeArgument] })),
    { kind: "tuple", elements: [0, 0] },
    { kind: "alias", alias: { sort: "type", category: "projection", definition: identity(4), arguments: [typeArgument] }, rigid: true },
    { kind: "parameter", index: 0, name: "Value" },
    { kind: "bound", binder: { kind: "bound", depth: 0 }, variable: 0, declaration: boundType },
    { kind: "bound", binder: { kind: "canonical" }, variable: 0, declaration: { kind: "anonymous" } },
    { kind: "placeholder", universe: 3, variable: 1, declaration: boundType },
    ...["type", "integer", "float", "fresh-type", "fresh-integer", "fresh-float"].map(category => ({ kind: "inference", category, index: 0 })),
  ];
  for (const value of values) {
    const input = graph();
    input.types.push({ id: 1, value });
    const decoded = decodeNativeEvidence(input, limits);
    assert.deepEqual(decoded.types[1].value, value);
    assert.ok(Object.isFrozen(decoded.types[1].value));
    const malformed = structuredClone(input);
    malformed.types[1].value.unexpected = true;
    assert.throws(() => decodeNativeEvidence(malformed, limits), /invalid record shape/u);
  }
});

test("native region categories preserve bound indices, universes and declaration identities", () => {
  const declarations = [{ kind: "anonymous" }, { kind: "printed", name: "'scope" }, boundRegion, { kind: "closure-environment" }];
  const regions = [
    { kind: "early", index: 2, name: "'scope" }, { kind: "static" }, { kind: "erased" }, { kind: "inference", index: 4 },
    ...declarations.map(declaration => ({ kind: "bound", binder: { kind: "bound", depth: 2 }, variable: 1, declaration })),
    ...declarations.map(declaration => ({ kind: "placeholder", universe: 7, variable: 1, declaration })),
    ...[{ kind: "anonymous", index: 0 }, { kind: "printed", index: 0, name: "'scope" }, boundRegion, { kind: "closure-environment" }]
      .map(declaration => ({ kind: "late", scope: identity(2), declaration })),
  ];
  for (const region of regions) {
    const input = graph();
    input.types.push({ id: 1, value: { kind: "reference", region, pointee: 0, mutable: false } });
    assert.deepEqual(decodeNativeEvidence(input, limits).types[1].value.region, region);
  }
});

test("native constant categories preserve exact bits and reject rounded or malformed values", () => {
  const values = [
    { kind: "parameter", index: 1, name: "COUNT" },
    { kind: "bound", binder: { kind: "bound", depth: 0 }, variable: 1 },
    { kind: "placeholder", universe: 4, variable: 2 },
    { kind: "inference", category: "constant", index: 7 },
    { kind: "inference", category: "fresh-constant", index: 7 },
    { kind: "alias", alias: { sort: "constant", category: "free", definition: identity(10), arguments: [] }, rigid: false },
    { kind: "scalar", type: 0, bytes: 16, bits: "340282366920938463463374607431768211455" },
    { kind: "aggregate", type: 0, fields: [0, 0] },
    { kind: "expression", operation: "add", arguments: [typeArgument, typeArgument, constantArgument, constantArgument] },
    { kind: "expression", operation: "neg", arguments: [typeArgument, constantArgument] },
    { kind: "expression", operation: "as", arguments: [typeArgument, constantArgument, typeArgument] },
    { kind: "expression", operation: "call", arguments: [typeArgument, constantArgument, constantArgument] },
  ];
  for (const value of values) {
    const input = graph();
    input.constants.push({ id: 1, value });
    assert.deepEqual(decodeNativeEvidence(input, limits).constants[1].value, value);
  }
  for (const bits of ["-1", "+1", "01", "1.5", "1e3", "", "340282366920938463463374607431768211456", 9007199254740993n, 9007199254740992]) {
    const input = graph();
    input.constants[0].value = { kind: "scalar", type: 0, bytes: 16, bits };
    assert.throws(() => decodeNativeEvidence(input, limits), /invalid (exact scalar bits|string)/u);
  }
  for (const bytes of [0, -1, 17, Infinity, 1.5]) {
    const input = graph();
    input.constants[0].value.bytes = bytes;
    assert.throws(() => decodeNativeEvidence(input, limits), /invalid/u);
  }
});

test("all native clause categories retain their own binder and exact generic references", () => {
  const predicates = [
    { kind: "trait", definition: identity(3), arguments: [typeArgument], polarity: "positive" },
    { kind: "trait", definition: identity(3), arguments: [typeArgument], polarity: "negative" },
    { kind: "region-outlives", longer: region, shorter: { kind: "early", index: 0, name: "'a" } },
    { kind: "type-outlives", type: 0, region },
    { kind: "projection", alias: { sort: "type", category: "projection", definition: identity(4), arguments: [typeArgument] }, term: typeArgument },
    { kind: "constant-type", constant: 0, type: 0 },
    { kind: "well-formed", term: typeArgument }, { kind: "constant-evaluatable", constant: 0 },
    { kind: "host-effect", definition: identity(3), arguments: [typeArgument], constness: "maybe" },
    { kind: "unstable-feature", name: "native_feature" },
  ];
  const input = graph();
  input.definitions[1].generics = { parent: null, parentCount: 0, hasSelf: false, parameters: [
    { definition: identity(6), index: 0, name: "'a", pureWrtDrop: false, value: { kind: "lifetime" } },
    { definition: identity(5), index: 1, name: "Value", pureWrtDrop: true, value: { kind: "type", synthetic: false, default: 0 } },
    { definition: identity(11), index: 2, name: "COUNT", pureWrtDrop: false, value: { kind: "constant", type: 0, default: 0 } },
  ], predicatesParent: null, predicates: predicates.map(value => ({ variables: [{ kind: "lifetime", declaration: boundRegion }], value })) };
  const decoded = decodeNativeEvidence(input, limits);
  assert.deepEqual(decoded.definitions[1].generics, input.definitions[1].generics);
  for (const mutate of [
    value => { value.definitions[1].generics.predicates[0].value.definition = identity(2); },
    value => { value.definitions[1].generics.predicates[4].value.term = constantArgument; },
    value => { value.definitions[1].generics.predicates[6].value.term = { kind: "lifetime", region }; },
    value => { value.definitions[1].generics.parameters[2].value.default = 999; },
    value => { value.definitions[1].generics.parameters.push(value.definitions[1].generics.parameters[0]); },
  ]) {
    const corrupted = structuredClone(input);
    mutate(corrupted);
    assert.throws(() => decodeNativeEvidence(corrupted, limits), /Native Rust/u);
  }
});

test("graph recursion remains bounded without rejecting legitimate type references", () => {
  const input = graph();
  input.types.push({ id: 1, value: { kind: "adt", definition: identity(1), arguments: [] } });
  input.types.push({ id: 2, value: { kind: "raw-pointer", pointee: 1, mutable: true } });
  input.definitions[1].type = 1;
  input.definitions.push({ ...nativeDefinition(15, "field"), parent: identity(1), path: "crate::item1::next", name: "next", type: 2 });
  assert.equal(decodeNativeEvidence(input, limits).types.length, 3);
  for (const mutate of [
    value => { value.definitions[1].parent = identity(1); },
    value => { value.definitions[1].parent = identity(2); value.definitions[2].parent = identity(1); },
    value => { value.types[2].value.pointee = 999; },
    value => { value.constants[0].value.type = 999; },
  ]) {
    const corrupted = structuredClone(input);
    mutate(corrupted);
    assert.throws(() => decodeNativeEvidence(corrupted, limits), /Native Rust/u);
  }
  const shallow = graph();
  let pattern = { kind: "not-null" };
  for (let depth = 0; depth < 8; depth += 1) pattern = { kind: "or", patterns: [pattern] };
  shallow.types.push({ id: 1, value: { kind: "pattern", base: 0, pattern } });
  assert.equal(decodeNativeEvidence(shallow, limits).types.length, 2);
  assert.throws(() => decodeNativeEvidence(shallow, { ...limits, maximumDepth: 4 }), /depth limit/u);
  assert.throws(() => decodeNativeEvidence(shallow, { ...limits, maximumRows: 4 }), /row limit/u);
});

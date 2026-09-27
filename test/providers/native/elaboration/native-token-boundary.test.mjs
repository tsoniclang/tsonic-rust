import assert from "node:assert/strict";
import test from "node:test";
import { decodeNativeTokenResponse } from "../../../../dist/providers/native/elaboration/tokens.js";
import { defaultRustNativeSourceLimits as limits } from "../../../../dist/providers/native/elaboration/limits.js";

const range = { start: 0, end: 5 };
const leaves = [
  { kind: "identifier", text: "value", raw: false, source: range },
  { kind: "literal", text: '"é"', source: { start: 0, end: 4 } },
  { kind: "punctuation", text: "::", joint: true, source: { start: 0, end: 2 } },
];
const group = { kind: "group", delimiter: "parentheses", tokens: leaves, source: range };
const response = tokens => ({ kind: "tokens", protocolVersion: 1, tokens });
const decode = tokens => decodeNativeTokenResponse(response(tokens), 5, limits);

test("native token boundary preserves every exact variant in an immutable snapshot", () => {
  const input = structuredClone([group]);
  const output = decode(input);
  assert.deepEqual(output, input);
  assert.ok(Object.isFrozen(output));
  assert.ok(Object.isFrozen(output[0]));
  assert.ok(Object.isFrozen(output[0].source));
  assert.ok(Object.isFrozen(output[0].tokens));
  for (const token of output[0].tokens) {
    assert.ok(Object.isFrozen(token));
    assert.ok(Object.isFrozen(token.source));
  }
  input[0].tokens[0].text = "changed";
  input[0].source.end = 1;
  assert.equal(output[0].tokens[0].text, "value");
  assert.equal(output[0].source.end, 5);
});

test("native token boundary rejects missing, extra and wrong-variant fields", () => {
  for (const token of [...leaves, group]) {
    for (const field of Object.keys(token)) {
      const missing = { ...token };
      delete missing[field];
      assert.throws(() => decode([missing]), /Native Rust/u, `${token.kind}.${field}`);
    }
    for (const extra of [{ extra: 1 }, { unchecked: true }, { fragment: {} }]) {
      assert.throws(() => decode([{ ...token, ...extra }]), /record shape/u);
    }
    assert.throws(() => decode([{ ...token, source: { ...token.source, extra: 1 } }]), /record shape/u);
  }
  for (const kind of [undefined, null, false, "unknown", "fragment"]) {
    assert.throws(() => decode([{ ...leaves[0], kind }]), /invalid/u);
  }
  for (const token of [
    { ...leaves[0], raw: 1 },
    { ...leaves[2], joint: "true" },
    { ...group, delimiter: "invisible" },
  ]) assert.throws(() => decode([token]), /invalid/u);
  for (const token of leaves) {
    for (const text of ["", null, 1, undefined, {}]) {
      assert.throws(() => decode([{ ...token, text }]), /invalid/u);
    }
  }
});

test("native token boundary never invokes untrusted object or array accessors", () => {
  let reads = 0;
  const getter = { get() { reads += 1; return "identifier"; }, enumerable: true };
  const malformedRecords = value => {
    const accessor = { ...value };
    Object.defineProperty(accessor, Object.keys(value)[0], getter);
    const hidden = { ...value };
    Object.defineProperty(hidden, "hidden", { value: true });
    return [accessor, hidden, { ...value, [Symbol("extra")]: true },
      Object.assign(Object.create({ inherited: true }), value)];
  };
  for (const token of malformedRecords(leaves[0])) {
    assert.throws(() => decode([token]), /structured|shape/u);
  }
  for (const source of malformedRecords(range)) {
    assert.throws(() => decode([{ ...leaves[0], source }]), /record shape/u);
  }
  for (const envelope of malformedRecords(response([]))) {
    assert.throws(() => decodeNativeTokenResponse(envelope, 5, limits), /record shape/u);
  }
  const accessorArray = [leaves[0]];
  Object.defineProperty(accessorArray, "0", getter);
  const hiddenArray = [leaves[0]];
  Object.defineProperty(hiddenArray, "hidden", { value: true });
  for (const tokens of [new Array(1), accessorArray, hiddenArray, { 0: leaves[0], length: 1 }]) {
    assert.throws(() => decode(tokens), /dense data array/u);
    assert.throws(() => decode([{ ...group, tokens }]), /dense data array/u);
  }
  assert.equal(reads, 0);
});

test("native token source ranges are bounded by the exact request byte length", () => {
  const unicode = '"é"';
  assert.equal(unicode.length, 3);
  assert.equal(Buffer.byteLength(unicode, "utf8"), 4);
  assert.deepEqual(decodeNativeTokenResponse(response([leaves[1]]), 4, limits), [leaves[1]]);
  assert.throws(() => decodeNativeTokenResponse(response([leaves[1]]), 3, limits), /source range/u);
  for (const source of [{ start: -1, end: 1 }, { start: 3, end: 2 }, { start: 0, end: 6 },
    { start: 0.5, end: 1 }, { start: 0, end: Infinity }, { start: 0, end: 0x1_0000_0000 }]) {
    assert.throws(() => decode([{ ...leaves[0], source }]), /invalid/u);
  }
  for (const size of [-1, 0.5, NaN, Infinity, 0x1_0000_0000, "5", null]) {
    assert.throws(() => decodeNativeTokenResponse(response([]), size, limits), /invalid/u);
  }
  assert.deepEqual(decodeNativeTokenResponse(response([]), 0, limits), []);
  assert.deepEqual(decodeNativeTokenResponse(response([]), 0xffff_ffff, limits), []);
});

test("native token boundary retains overlapping documentation-expansion spans", () => {
  const tokens = [
    { kind: "punctuation", text: "#", joint: false, source: range },
    { kind: "group", delimiter: "brackets", source: range, tokens: [
      { kind: "identifier", text: "doc", raw: false, source: range },
      { kind: "punctuation", text: "=", joint: false, source: range },
      { kind: "literal", text: '"text"', source: range },
    ] },
  ];
  assert.deepEqual(decode(tokens), tokens);
});

test("native token boundary rejects cycles through its finite depth budget", () => {
  const cyclic = { ...group, tokens: [] };
  cyclic.tokens.push(cyclic);
  assert.throws(() => decodeNativeTokenResponse(response([cyclic]), 5,
    { ...limits, maximumDepth: 2 }), /depth limit/u);
});
